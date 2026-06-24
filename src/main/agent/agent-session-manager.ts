import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider } from './llm-provider';
import type { ChatRepository } from '@main/repos/chat-repository';
import { AgentSession } from './agent-session';
import { getToolSpecsForAgent } from './tool-specs';
import { CHANNELS } from '@shared/ipc-channels';
import { ToolDispatcher } from './tool-dispatcher';
import { loadConstitution } from './constitution';
import { FileTools } from '@main/tools';
import type { ApprovalGate } from './approval-gate';
import type { McpManager } from '@main/services/mcp-manager';
import type { SecondBrain } from '@main/services/second-brain';
import type { AuditLogger } from '@main/services/audit-logger';
import type { SnapshotService } from '@main/services/snapshot-service';
import type { SkillRegistry } from '@main/services/skill-registry';
import type { HookRunner } from './hook-runner';
import { buildCliContext, type DetectedCli } from '@main/services/cli-catalog';

export interface AgentSessionManagerOpts {
  provider: LLMProvider;
  repo: ChatRepository;
  approvalGate: ApprovalGate;
  send: (channel: string, payload: unknown) => void;
  mcpManager?: McpManager;
  brain?: SecondBrain;
  audit?: AuditLogger;
  snapshots?: SnapshotService;
  skillRegistry?: SkillRegistry;
  hooks?: HookRunner;
  /** Optional per-chat model override lookup. Returning a non-empty string
   *  swaps the agent's default model for this run. */
  getModelOverride?: (chatId: string) => string | null;
  /** Optional per-chat workspace override. Useful when the same agent
   *  needs to operate on different repos depending on the chat. */
  getWorkspaceOverride?: (chatId: string) => string | null;
  /** Ordered fallback model ids to try if the primary fails before output. */
  getFallbackModels?: () => string[];
  /** Installed CLIs the user connected — advertised to shell-enabled agents so
   *  they know which command-line tools they can invoke via run_shell. */
  getConnectedClis?: () => DetectedCli[];
}

interface ActiveEntry {
  streamId: string;
  agentId: string;
  chatId: string;
  session: AgentSession;
}

export class AgentSessionManager {
  private readonly active = new Map<string, ActiveEntry>();

  constructor(private readonly opts: AgentSessionManagerOpts) {}

  async start(chatId: string): Promise<{ streamId: string; session: AgentSession }> {
    const chat = this.opts.repo.getChat(chatId);
    if (!chat) throw new Error(`unknown chat: ${chatId}`);
    const agent = this.opts.repo.getAgent(chat.agentId);
    if (!agent) throw new Error(`unknown agent: ${chat.agentId}`);

    const history = this.opts.repo.toConversation(this.opts.repo.getMessages(chatId));
    const streamId = randomUUID();

    // Universal workflow framing — every agent follows
    // gather → plan → act → verify so behavior is consistent across roles.
    const workflowFraming = `\n\n## Workflow\nFor any non-trivial task, follow this loop:\n\n1. **Gather context** — use read_file, list_dir, search_files, web_search, or brain_search to ground yourself BEFORE writing or running anything.\n2. **Plan** — outline the steps in a numbered list. Surface assumptions. If the user said /plan, STOP here and wait for confirmation.\n3. **Act** — execute the plan with tools. Take small steps.\n4. **Verify** — read back what you wrote, run the test/build command, or otherwise confirm the change works. Do not declare done without verification.\n\nIf a step fails, read the error, adjust, and retry. Self-correct without asking the user unless truly blocked.`;

    // Inject real-time context so the model never invents dates. Without
    // this, model training cutoffs cause "latest news 2024" answers in 2026.
    const dateContext = buildDateContext();

    // Project rules: CLAUDE.md / .flowstaterules / .cursorrules — first one
    // found wins. Prepended to the agent's system prompt for this session.
    const projectRules = await readProjectRules(agent.workspacePath);
    const projectRulesBlock = projectRules
      ? `\n\n## Project rules (from CLAUDE.md)\n${projectRules}`
      : '';

    // Skills available to this agent (from installed plugins + standalone).
    // The model sees name+description here and loads full instructions via the
    // `skill` tool when one applies.
    const skills = this.opts.skillRegistry?.descriptions(agent.id) ?? [];
    const skillsBlock =
      skills.length > 0
        ? `\n\n## Available skills\nYou have skills you can load on demand. When a task matches one, call the \`skill\` tool with its name FIRST, then follow the instructions it returns.\n${skills
            .map((s) => `- **${s.name}** — ${s.description}`)
            .join('\n')}`
        : '';
    // Connected CLIs — only meaningful to agents that can shell out, since they
    // invoke these via run_shell.
    const cliBlock = agent.toolPerms.shell_enabled
      ? buildCliContext(this.opts.getConnectedClis?.() ?? [])
      : '';

    const override = this.opts.getModelOverride?.(chatId)?.trim();
    const wsOverride = this.opts.getWorkspaceOverride?.(chatId)?.trim();
    const workspacePath = wsOverride && wsOverride.length > 0 ? wsOverride : agent.workspacePath;
    const effectiveAgent = {
      ...agent,
      workspacePath,
      model: override && override.length > 0 ? override : agent.model,
      systemPrompt:
        agent.systemPrompt +
        workflowFraming +
        projectRulesBlock +
        skillsBlock +
        cliBlock +
        dateContext,
    };
    const constitution = await loadConstitution(workspacePath);
    const dispatcher = new ToolDispatcher({
      fileTools: new FileTools(workspacePath),
      workspaceRoot: workspacePath,
      approvalGate: this.opts.approvalGate,
      agent: effectiveAgent,
      chat,
      streamId,
      ...(this.opts.mcpManager ? { mcpManager: this.opts.mcpManager } : {}),
      ...(this.opts.brain ? { brain: this.opts.brain } : {}),
      ...(this.opts.audit ? { audit: this.opts.audit } : {}),
      ...(constitution.length ? { constitution } : {}),
      ...(this.opts.snapshots ? { snapshots: this.opts.snapshots } : {}),
      ...(this.opts.skillRegistry ? { skillRegistry: this.opts.skillRegistry } : {}),
      ...(this.opts.hooks ? { hooks: this.opts.hooks } : {}),
    });
    const mcpSpecs = this.opts.mcpManager?.toolSpecs() ?? [];
    const toolSpecs = getToolSpecsForAgent(agent.toolPerms, mcpSpecs, skills);

    const session = new AgentSession({
      streamId,
      agent: effectiveAgent,
      chat,
      history,
      provider: this.opts.provider,
      dispatcher,
      repo: this.opts.repo,
      send: this.opts.send,
      toolSpecs,
      fallbackModels: this.opts.getFallbackModels?.() ?? [],
      onComplete: () => {
        this.active.delete(streamId);
        this.broadcast();
      },
    });
    this.active.set(streamId, {
      streamId,
      agentId: agent.id,
      chatId: chat.id,
      session,
    });
    this.broadcast();
    return { streamId, session };
  }

  abort(streamId: string): boolean {
    const entry = this.active.get(streamId);
    if (!entry) return false;
    entry.session.abort();
    return true;
  }

  has(streamId: string): boolean {
    return this.active.has(streamId);
  }

  resolveApproval(
    streamId: string,
    toolCallId: string,
    decision: 'allow-once' | 'allow-rest' | 'deny',
    reason?: string,
  ): boolean {
    return this.opts.approvalGate.resolve(streamId, toolCallId, decision, reason);
  }

  private broadcast(): void {
    const activeList = Array.from(this.active.values()).map((e) => ({
      streamId: e.streamId,
      agentId: e.agentId,
      chatId: e.chatId,
    }));
    this.opts.send(CHANNELS.CHAT_ACTIVE_STREAMS, { active: activeList });
  }
}

const RULES_FILENAMES = ['CLAUDE.md', '.flowstaterules', '.cursorrules', 'AGENTS.md'];
const MAX_RULES_BYTES = 16 * 1024;

/** Build a small "current context" block appended to every agent's system
 *  prompt so the model has real-time grounding. Without this, frozen
 *  training data leaks through as confidently-wrong dates. */
function buildDateContext(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const human = now.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  return `\n\n## Current context\nToday's date is ${iso} (${human}). User timezone: ${tz}. Treat any information dated before today as historical; the current year is ${now.getFullYear()}. When the user asks for "latest" / "recent" news, use real web_search results from ${now.getFullYear()} — do NOT invent dates from your training data.`;
}

async function readProjectRules(workspacePath: string): Promise<string | null> {
  for (const name of RULES_FILENAMES) {
    try {
      const buf = await fs.readFile(join(workspacePath, name), 'utf8');
      if (buf.trim().length === 0) continue;
      return buf.length > MAX_RULES_BYTES ? buf.slice(0, MAX_RULES_BYTES) + '\n\n[truncated]' : buf;
    } catch {
      // file missing — try next
    }
  }
  return null;
}
