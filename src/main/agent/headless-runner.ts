// Reusable headless autonomous single-task loop — the coordinator's team-mode
// task mechanics (safe agent, tool dispatcher, iterate-until-complete) exposed
// as a standalone runner so other features (business autopilot) can run one
// tool-using agent task without a chat UI attached.

import { AgentRuntime } from './agent-runtime';
import { ToolDispatcher } from './tool-dispatcher';
import { loadConstitution } from './constitution';
import { FileTools } from '@main/tools';
import { getToolSpecsForAgent } from './tool-specs';
import type { LLMProvider } from './llm-provider';
import type { ApprovalGate } from './approval-gate';
import type { ChatRepository, AgentRow } from '@main/repos/chat-repository';
import type { McpManager } from '@main/services/mcp-manager';
import type { SecondBrain } from '@main/services/second-brain';
import type { AuditLogger } from '@main/services/audit-logger';
import type { SnapshotService } from '@main/services/snapshot-service';
import type { AgentEvent } from './types';

const MAX_ITERATIONS = 6;
const COMPLETION_TOKEN = '<<TASK_COMPLETE>>';

const AUTONOMY_FRAMING = `

You are working AUTONOMOUSLY. Use tools as needed. Be thorough — don't ask
clarifying questions, make reasonable assumptions and state them. When you
have fully completed the task, end your response with the literal token
${COMPLETION_TOKEN} on its own line.`;

function currentContextBlock(): string {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const human = now.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `\n\n## Current context\nToday's date is ${iso} (${human}). The current year is ${now.getFullYear()}. When asked for "latest" / "recent" information, use real web_search results — do NOT fabricate dates from your training data.`;
}

export interface HeadlessRunnerOpts {
  provider: LLMProvider;
  repo: ChatRepository;
  approvalGate: ApprovalGate;
  mcpManager?: McpManager;
  brain?: SecondBrain;
  audit?: AuditLogger;
  snapshots?: SnapshotService;
}

export class HeadlessRunner {
  constructor(private readonly opts: HeadlessRunnerOpts) {}

  private agent(agentId: string): AgentRow {
    const agent = this.opts.repo.listAgents().find((a) => a.id === agentId);
    if (!agent) throw new Error(`headless run: unknown agent ${agentId}`);
    return agent;
  }

  /** Single non-streaming completion with the agent's model + system prompt. */
  async once(agentId: string, prompt: string, json?: boolean): Promise<string> {
    const agent = this.agent(agentId);
    const res = await this.opts.provider.chatOnce({
      model: agent.model,
      ...(json ? { format: 'json' as const } : {}),
      messages: [
        { role: 'system', content: agent.systemPrompt },
        { role: 'user', content: prompt },
      ],
    });
    return res.text;
  }

  /** Autonomous tool-using loop, mirroring the coordinator's team-task run. */
  async run(
    agentId: string,
    instruction: string,
    onEvent?: (e: { type: 'text' | 'tool'; text?: string; tool?: string }) => void,
  ): Promise<string> {
    const agent = this.agent(agentId);
    const streamId = `headless:${agent.id}:${Date.now()}`;
    const fakeChat = {
      id: streamId,
      agentId: agent.id,
      title: 'headless-run',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Force-disable shell + delete: approval prompts have no UI surface in a
    // headless run (would hang and auto-deny). Read/write file tools remain.
    const safeAgent: AgentRow = {
      ...agent,
      toolPerms: { shell_enabled: false, delete_enabled: false },
      approvalPolicy: 'yolo',
    };
    const constitution = await loadConstitution(agent.workspacePath);
    const dispatcher = new ToolDispatcher({
      fileTools: new FileTools(agent.workspacePath),
      workspaceRoot: agent.workspacePath,
      approvalGate: this.opts.approvalGate,
      agent: safeAgent,
      chat: fakeChat,
      streamId,
      ...(this.opts.mcpManager ? { mcpManager: this.opts.mcpManager } : {}),
      ...(this.opts.brain ? { brain: this.opts.brain } : {}),
      ...(this.opts.audit ? { audit: this.opts.audit } : {}),
      ...(constitution.length ? { constitution } : {}),
      ...(this.opts.snapshots ? { snapshots: this.opts.snapshots } : {}),
    });
    const mcpSpecs = this.opts.mcpManager?.toolSpecs() ?? [];
    const runtime = new AgentRuntime({
      provider: this.opts.provider,
      model: agent.model,
      systemPrompt: agent.systemPrompt + AUTONOMY_FRAMING + currentContextBlock(),
      tools: getToolSpecsForAgent(safeAgent.toolPerms, mcpSpecs),
      dispatcher,
    });

    let collected = '';
    let nextMessage = instruction;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      let turnText = '';
      for await (const event of runtime.send(nextMessage) as AsyncIterable<AgentEvent>) {
        if (event.type === 'text-delta') {
          turnText += event.text;
          collected += event.text;
          onEvent?.({ type: 'text', text: event.text });
        } else if (event.type === 'tool-call') {
          onEvent?.({ type: 'tool', tool: event.call.name });
        } else if (event.type === 'turn-done') {
          if (event.reason === 'error') throw new Error(event.error ?? 'headless task failed');
        }
      }

      if (turnText.includes(COMPLETION_TOKEN)) {
        return collected.split(COMPLETION_TOKEN).join('').trim();
      }
      if (iteration >= MAX_ITERATIONS - 1) break;
      nextMessage =
        'Are you done? If yes, end with ' + COMPLETION_TOKEN + '. Otherwise continue the work.';
    }

    return collected.trim();
  }
}
