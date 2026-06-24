// Multi-agent coordinator. Decomposes a user task into parallel subtasks,
// runs them on selected agents headlessly in an AUTONOMOUS loop (each agent
// can iterate up to MAX_ITERATIONS times — using tools, then asked to either
// continue or signal completion). The user can NUDGE any in-flight task with
// new instructions; nudges are queued and applied between iterations, with
// optional interrupt to cancel the current turn immediately.
//
// Once every task settles, a synthesizer agent reads all outputs and writes
// the final answer for the user.

import { randomUUID } from 'node:crypto';
import type { LLMProvider } from './llm-provider';
import { AgentRuntime } from './agent-runtime';
import { ToolDispatcher } from './tool-dispatcher';
import { loadConstitution } from './constitution';
import { FileTools } from '@main/tools';
import { getToolSpecsForAgent } from './tool-specs';
import type { ApprovalGate } from './approval-gate';
import type { ChatRepository, AgentRow } from '@main/repos/chat-repository';
import type { McpManager } from '@main/services/mcp-manager';
import type { SecondBrain } from '@main/services/second-brain';
import type { AuditLogger } from '@main/services/audit-logger';
import type { SnapshotService } from '@main/services/snapshot-service';
import type { AgentEvent } from './types';

export interface CoordinatorTaskPlan {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  instruction: string;
}

export interface CoordinatorPlan {
  summary: string;
  tasks: CoordinatorTaskPlan[];
  synthesizerAgentId: string;
  synthesizerAgentName: string;
  synthesizerAgentColor: string;
}

export type TeamEvent =
  | { type: 'plan'; runId: string; plan: CoordinatorPlan }
  | { type: 'task-start'; taskId: string }
  | { type: 'task-iteration'; taskId: string; iteration: number }
  | { type: 'task-text'; taskId: string; delta: string }
  | { type: 'task-tool'; taskId: string; toolName: string }
  | { type: 'task-nudge-applied'; taskId: string; nudge: string; interrupted: boolean }
  | { type: 'task-done'; taskId: string; output: string; ok: boolean; error?: string }
  | { type: 'synthesis-start'; agentId: string }
  | { type: 'synthesis-text'; delta: string }
  | {
      type: 'run-end';
      reason: 'ok' | 'aborted' | 'error';
      error?: string;
      chatId?: string;
      agentId?: string;
    };

const PLANNER_SYSTEM = `You are a multi-agent task planner.

Given the user request and the available specialist agents, break the work
into 2 to 5 PARALLEL subtasks (no inter-task dependencies). Then choose ONE
agent to be the SYNTHESIZER who will read all subtask outputs and write the
final answer for the user.

Output FORMAT — read carefully:
- Reply with ONE JSON object. No prose before or after. No markdown fences.
- Use exactly these field names: "summary", "tasks", "synthesizer_agent_id".
- Each task entry uses exactly: "agent_id", "instruction".
- "agent_id" must be one of the IDs listed under "Available agents" below
  (copy-paste exact). Never invent an ID.

Example shape (do not copy values — use the real agent IDs supplied):
{"summary":"Research X then write summary.","tasks":[{"agent_id":"abc-123","instruction":"Search the web for ..."},{"agent_id":"def-456","instruction":"Draft a one-paragraph summary using ..."}],"synthesizer_agent_id":"def-456"}

Rules:
- Each instruction must be self-contained (no "see other task").
- Pick agents whose specialty matches the subtask. For "research" / "latest
  news" / "look up" tasks prefer a Researcher / Web-Scraper / Doc-Writer type.
- If the request is trivial (one agent could do it alone), still return one
  task and a synthesizer (which can be the same agent).
- Maximum 5 tasks.

Available agents:`;

const MAX_TASKS = 5;
const MAX_TEXT_PER_OUTPUT = 8_000;
const MAX_ITERATIONS = 6;
const COMPLETION_TOKEN = '<<TASK_COMPLETE>>';

const AUTONOMY_FRAMING = `

You are working AUTONOMOUSLY as part of a team. Use tools as needed. Be
thorough — don't ask clarifying questions, make reasonable assumptions and
state them. When you have fully completed the task, end your response with
the literal token ${COMPLETION_TOKEN} on its own line.

## Your workflow
The orchestrator has decomposed the user's request into parallel subtasks.
Your subtask is yours alone — you plan + execute it independently while
the team works in parallel. Follow this loop:

1. **Gather context** — use read_file, list_dir, search_files, web_search,
   or brain_search to ground yourself in the workspace and the topic.
2. **Plan your subtask** — outline numbered steps under a heading
   '## My plan' at the start of your reply. This shows in the Plan view.
3. **Act** — execute with tools. Small steps.
4. **Verify** — read back, run a check, confirm.

Stay in your subtask lane. Do not duplicate work the orchestrator gave
to other agents.`;

function buildPlannerPrompt(agents: AgentRow[]): string {
  const lines = agents.map(
    (a) =>
      `- id: ${a.id}, name: ${a.name}, description: ${a.description || '(none)'}, specialty: ${a.specialtyTags.join(', ') || '(none)'}`,
  );
  return `${PLANNER_SYSTEM}\n${lines.join('\n')}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export interface CoordinatorOpts {
  provider: LLMProvider;
  plannerModel: string;
  repo: ChatRepository;
  approvalGate: ApprovalGate;
  mcpManager?: McpManager;
  brain?: SecondBrain;
  audit?: AuditLogger;
  snapshots?: SnapshotService;
}

export interface CoordinatorRunHandle {
  runId: string;
  abort: () => void;
  nudge: (taskId: string, text: string, interrupt: boolean) => boolean;
}

interface TaskController {
  nudges: string[];
  currentTurnAborter: AbortController;
  done: boolean;
}

interface RunState {
  signal: AbortSignal;
  emit: (e: TeamEvent) => void;
  controllers: Map<string, TaskController>;
}

export class Coordinator {
  private readonly runs = new Map<string, RunState>();

  constructor(private readonly opts: CoordinatorOpts) {}

  start(
    userText: string,
    onEvent: (e: TeamEvent) => void,
  ): { handle: CoordinatorRunHandle; done: Promise<void> } {
    const runId = randomUUID();
    const aborter = new AbortController();
    const state: RunState = {
      signal: aborter.signal,
      emit: onEvent,
      controllers: new Map(),
    };
    this.runs.set(runId, state);

    const handle: CoordinatorRunHandle = {
      runId,
      abort: () => {
        aborter.abort();
        // Also abort any in-flight task turns so they exit promptly.
        for (const c of state.controllers.values()) {
          try {
            c.currentTurnAborter.abort();
          } catch {
            // best-effort
          }
        }
      },
      nudge: (taskId, text, interrupt) => this.nudge(runId, taskId, text, interrupt),
    };

    const done = this.execute(runId, userText, state).finally(() => {
      this.runs.delete(runId);
    });
    return { handle, done };
  }

  /**
   * Inject a mid-run instruction into a specific task. Returns true if the
   * task was found + still running. If `interrupt` is true the in-flight LLM
   * turn is aborted so the loop picks up the nudge immediately; otherwise the
   * nudge is applied at the next natural iteration boundary.
   */
  nudge(runId: string, taskId: string, text: string, interrupt: boolean): boolean {
    const state = this.runs.get(runId);
    if (!state) return false;
    const ctrl = state.controllers.get(taskId);
    if (!ctrl || ctrl.done) return false;
    ctrl.nudges.push(text.trim());
    if (interrupt) {
      try {
        ctrl.currentTurnAborter.abort();
      } catch {
        // best-effort
      }
    }
    return true;
  }

  private async execute(runId: string, userText: string, state: RunState): Promise<void> {
    const { signal, emit } = state;
    try {
      const agents = this.opts.repo.listAgents();
      if (agents.length === 0) {
        emit({ type: 'run-end', reason: 'error', error: 'No agents available.' });
        return;
      }

      // 1. PLAN
      let planRaw: { text: string };
      try {
        planRaw = await this.opts.provider.chatOnce({
          model: this.opts.plannerModel,
          format: 'json',
          messages: [
            { role: 'system', content: buildPlannerPrompt(agents) },
            { role: 'user', content: userText },
          ],
        });
      } catch (err) {
        emit({
          type: 'run-end',
          reason: 'error',
          error: `Planner failed: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      if (signal.aborted) {
        emit({ type: 'run-end', reason: 'aborted' });
        return;
      }

      const plan = parsePlan(planRaw.text, agents) ?? buildFallbackPlan(userText, agents);
      emit({ type: 'plan', runId, plan });

      // Pre-create task controllers so nudges that arrive between `plan` and
      // `task-start` are not dropped.
      for (const t of plan.tasks) {
        state.controllers.set(t.id, {
          nudges: [],
          currentTurnAborter: new AbortController(),
          done: false,
        });
      }

      await this.runTasksAndSynthesize(plan, userText, state, agents);
    } catch (err) {
      if (signal.aborted) {
        emit({ type: 'run-end', reason: 'aborted' });
      } else {
        emit({
          type: 'run-end',
          reason: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async runTasksAndSynthesize(
    plan: CoordinatorPlan,
    userText: string,
    state: RunState,
    allAgents: AgentRow[],
  ): Promise<void> {
    const { signal, emit } = state;
    const agentMap = new Map(allAgents.map((a) => [a.id, a]));

    // 2. RUN TASKS IN PARALLEL — each in autonomous loop
    const taskOutputs = await Promise.all(
      plan.tasks.map(async (task) => {
        const ctrl = state.controllers.get(task.id)!;
        const agent = agentMap.get(task.agentId);
        if (!agent) {
          ctrl.done = true;
          emit({
            type: 'task-done',
            taskId: task.id,
            output: '',
            ok: false,
            error: `Agent ${task.agentId} not found.`,
          });
          return { task, output: '', ok: false };
        }
        emit({ type: 'task-start', taskId: task.id });
        try {
          const text = await this.runHeadlessTaskAutonomous(agent, task, ctrl, signal, emit);
          ctrl.done = true;
          const truncated = truncate(text, MAX_TEXT_PER_OUTPUT);
          emit({ type: 'task-done', taskId: task.id, output: truncated, ok: true });
          return { task, output: truncated, ok: true };
        } catch (err) {
          ctrl.done = true;
          if (signal.aborted) return { task, output: '', ok: false };
          const msg = err instanceof Error ? err.message : String(err);
          emit({ type: 'task-done', taskId: task.id, output: '', ok: false, error: msg });
          return { task, output: '', ok: false };
        }
      }),
    );

    if (signal.aborted) {
      emit({ type: 'run-end', reason: 'aborted' });
      return;
    }

    // 3. SYNTHESIZE
    const synth = agentMap.get(plan.synthesizerAgentId);
    if (!synth) {
      emit({
        type: 'run-end',
        reason: 'error',
        error: `Synthesizer agent ${plan.synthesizerAgentId} not found.`,
      });
      return;
    }
    emit({ type: 'synthesis-start', agentId: synth.id });

    const synthesisPrompt = buildSynthesisPrompt(userText, taskOutputs);
    let synthesisBuffer = '';
    try {
      const runtime = new AgentRuntime({
        provider: this.opts.provider,
        model: synth.model,
        systemPrompt: synth.systemPrompt + currentContextBlock(),
        tools: [],
        dispatcher: makeNoopDispatcher(),
      });
      for await (const event of runtime.send(synthesisPrompt, signal) as AsyncIterable<AgentEvent>) {
        if (signal.aborted) {
          emit({ type: 'run-end', reason: 'aborted' });
          return;
        }
        if (event.type === 'text-delta') {
          synthesisBuffer += event.text;
          emit({ type: 'synthesis-text', delta: event.text });
        } else if (event.type === 'turn-done' && event.reason === 'error') {
          emit({
            type: 'run-end',
            reason: 'error',
            error: event.error ?? 'synthesis failed',
          });
          return;
        }
      }

      // Persist as a chat under the synthesizer agent so the team run
      // shows up in the sidebar session list.
      let persistedChatId: string | undefined;
      try {
        persistedChatId = this.persistTeamRun(
          synth.id,
          userText,
          plan,
          taskOutputs,
          synthesisBuffer,
        );
      } catch (err) {
        console.warn('[flowstate] team-run persist failed:', err);
      }

      emit({
        type: 'run-end',
        reason: 'ok',
        ...(persistedChatId ? { chatId: persistedChatId } : {}),
        agentId: synth.id,
      });
    } catch (err) {
      if (signal.aborted) {
        emit({ type: 'run-end', reason: 'aborted' });
      } else {
        emit({
          type: 'run-end',
          reason: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Write a team run as a chat under the synthesizer agent so it appears
   * in the sidebar session list. One user message (original prompt) plus
   * an assistant message that holds the synthesis output, with the plan
   * summary + per-task outputs appended for traceability.
   */
  private persistTeamRun(
    synthAgentId: string,
    userText: string,
    plan: CoordinatorPlan,
    taskOutputs: Array<{ task: CoordinatorTaskPlan; output: string; ok: boolean }>,
    synthesis: string,
  ): string {
    const title = `Team · ${truncate(userText, 60)}`;
    const chat = this.opts.repo.createChat(synthAgentId, title);
    this.opts.repo.appendMessage(chat.id, { role: 'user', content: userText });

    const planMd = `## Plan\n${plan.summary}\n\n` +
      plan.tasks.map((t, i) => `${i + 1}. **${t.agentName}** — ${t.instruction}`).join('\n');
    const taskMd = taskOutputs
      .map(
        (r, i) =>
          `### Subtask ${i + 1} — ${r.task.agentName}${r.ok ? '' : ' (failed)'}\n\n${
            r.output || '_(no output)_'
          }`,
      )
      .join('\n\n');
    const body = `${synthesis.trim()}\n\n---\n\n${planMd}\n\n${taskMd}`;
    this.opts.repo.appendMessage(chat.id, { role: 'assistant', content: body });
    return chat.id;
  }

  private async runHeadlessTaskAutonomous(
    agent: AgentRow,
    task: CoordinatorTaskPlan,
    ctrl: TaskController,
    runSignal: AbortSignal,
    emit: (e: TeamEvent) => void,
  ): Promise<string> {
    const streamId = `team:${task.id}`;
    const fakeChat = {
      id: streamId,
      agentId: agent.id,
      title: 'team-run',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    // Team mode: force-disable shell + delete to avoid approval prompts that
    // have no UI surface during a team run (would hang for 5min auto-deny).
    // Read-only file tools + write_file remain available.
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
    let nextMessage: string = task.instruction;

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      if (runSignal.aborted) throw new Error('aborted');

      // Fresh per-turn aborter (nudge w/ interrupt flips this).
      ctrl.currentTurnAborter = new AbortController();
      const turnSignal = mergeSignals(runSignal, ctrl.currentTurnAborter.signal);

      emit({ type: 'task-iteration', taskId: task.id, iteration });

      let turnText = '';
      try {
        for await (const event of runtime.send(nextMessage, turnSignal) as AsyncIterable<AgentEvent>) {
          if (runSignal.aborted) throw new Error('aborted');
          if (event.type === 'text-delta') {
            turnText += event.text;
            collected += event.text;
            emit({ type: 'task-text', taskId: task.id, delta: event.text });
          } else if (event.type === 'tool-call') {
            emit({ type: 'task-tool', taskId: task.id, toolName: event.call.name });
          } else if (event.type === 'turn-done') {
            // 'aborted' here likely means a nudge interrupt; loop will handle.
            if (event.reason === 'error') {
              throw new Error(event.error ?? 'task failed');
            }
          }
        }
      } catch (err) {
        if (runSignal.aborted) throw new Error('aborted');
        // Nudge-driven turn abort: only re-throw if there are no nudges to
        // apply (genuinely something else went wrong).
        if (ctrl.nudges.length === 0) throw err;
      }

      if (runSignal.aborted) throw new Error('aborted');

      // 1) Drain nudges first — user override beats autonomous loop.
      if (ctrl.nudges.length > 0) {
        const queued = ctrl.nudges.splice(0);
        const interrupted = ctrl.currentTurnAborter.signal.aborted;
        for (const n of queued) {
          emit({ type: 'task-nudge-applied', taskId: task.id, nudge: n, interrupted });
        }
        nextMessage = formatNudgeMessage(queued);
        continue;
      }

      // 2) Self-reported completion — strip the marker and finish.
      if (turnText.includes(COMPLETION_TOKEN)) {
        return collected.replace(new RegExp(COMPLETION_TOKEN, 'g'), '').trim();
      }

      // 3) Auto-continue once or twice to give the agent a chance to keep
      //    going, then bail. Cap by MAX_ITERATIONS in the for-loop.
      if (iteration >= MAX_ITERATIONS - 1) break;
      nextMessage =
        'Are you done? If yes, end with ' +
        COMPLETION_TOKEN +
        '. Otherwise continue the work.';
    }

    return collected.trim();
  }
}

/** Pick the agent whose specialty + description best matches the request text. */
function scoreAgent(agent: AgentRow, text: string): number {
  const t = text.toLowerCase();
  let score = 0;
  for (const tag of agent.specialtyTags) {
    if (tag && t.includes(tag.toLowerCase())) score += 4;
  }
  const desc = (agent.description || '').toLowerCase();
  if (desc.length > 0) {
    const words = desc
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 4)
      .slice(0, 12);
    for (const w of words) {
      if (t.includes(w)) score += 1;
    }
  }
  // Light intent buckets — boost agents whose name suggests the verb.
  const name = agent.name.toLowerCase();
  if (/research|news|latest|find out|look up/.test(t) && /research|search|finder/.test(name)) score += 6;
  if (/write|draft|doc|blog|article|copy/.test(t) && /writer|doc|copy/.test(name)) score += 6;
  if (/code|implement|refactor|bug|fix/.test(t) && /code|bug|review/.test(name)) score += 6;
  if (/test|spec/.test(t) && /test/.test(name)) score += 6;
  if (/design|ui|ux|mockup|landing/.test(t) && /design|component|theme|landing/.test(name)) score += 6;
  if (/plan|roadmap|okr/.test(t) && /plan/.test(name)) score += 6;
  if (/security|auth|token|password/.test(t) && /security|auth/.test(name)) score += 6;
  return score;
}

function buildFallbackPlan(userText: string, agents: AgentRow[]): CoordinatorPlan {
  // Rank agents by relevance to the user text; pick top one as runner and
  // synthesizer. Avoids the previous behavior of always grabbing agents[0],
  // which surfaced an unrelated agent (e.g. "AI Chain Builder") for a simple
  // research question.
  const ranked = [...agents]
    .map((a) => ({ a, s: scoreAgent(a, userText) }))
    .sort((x, y) => y.s - x.s);
  const pick = ranked[0]!.a;
  return {
    summary: 'Single-agent fallback — best-fit specialist running solo.',
    tasks: [
      {
        id: randomUUID(),
        agentId: pick.id,
        agentName: pick.name,
        agentColor: pick.avatarColor,
        instruction: userText,
      },
    ],
    synthesizerAgentId: pick.id,
    synthesizerAgentName: pick.name,
    synthesizerAgentColor: pick.avatarColor,
  };
}

function formatNudgeMessage(nudges: string[]): string {
  const list = nudges.map((n) => `- ${n}`).join('\n');
  return `The user has sent updates while you were working. Apply them immediately and continue:

${list}

When the (updated) task is fully complete, end with ${COMPLETION_TOKEN}.`;
}

interface RawPlan {
  summary?: unknown;
  tasks?: unknown;
  synthesizer_agent_id?: unknown;
}

/**
 * Pull the most plausible JSON object out of a model reply.
 *  - Strips markdown ```json fences.
 *  - If raw JSON.parse fails, falls back to the substring from the first `{`
 *    to the matching last `}`.
 *  - As a last resort, attempts brace-balanced scan for the largest valid
 *    object.
 */
function extractJsonObject(raw: string): unknown {
  const s = raw.trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1]! : s).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    // fall through
  }
  const first = candidate.indexOf('{');
  const last = candidate.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(candidate.slice(first, last + 1));
    } catch {
      // fall through
    }
  }
  // Brace-balanced scan from first `{`.
  if (first >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = first; i < candidate.length; i++) {
      const ch = candidate[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(first, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Map flexible field names (snake_case + camelCase + a few synonyms) so a
 * model that emits `agentId` / `synthesizerId` / `synthesizer` / etc. still
 * parses cleanly.
 */
function pickField<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k] as T;
  }
  return undefined;
}

function parsePlan(raw: string, agents: AgentRow[]): CoordinatorPlan | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const summary =
    typeof obj['summary'] === 'string'
      ? (obj['summary'] as string)
      : typeof obj['plan_summary'] === 'string'
        ? (obj['plan_summary'] as string)
        : 'Multi-agent plan';

  // Synthesizer can be: synthesizer_agent_id / synthesizerAgentId / synthesizer_id
  // / synthesizer (by id OR by name).
  const synthRaw = pickField<unknown>(obj, [
    'synthesizer_agent_id',
    'synthesizerAgentId',
    'synthesizer_id',
    'synthesizerId',
    'synthesizer',
    'synth',
  ]);
  let synth: AgentRow | undefined;
  if (typeof synthRaw === 'string') {
    synth =
      agents.find((a) => a.id === synthRaw) ??
      agents.find((a) => a.name.toLowerCase() === synthRaw.toLowerCase());
  }

  const rawTasks = pickField<unknown>(obj, ['tasks', 'subtasks', 'plan']);
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) return null;

  const tasks: CoordinatorTaskPlan[] = [];
  for (const t of rawTasks.slice(0, MAX_TASKS)) {
    if (!t || typeof t !== 'object') continue;
    const tt = t as Record<string, unknown>;
    const agentRef = pickField<unknown>(tt, ['agent_id', 'agentId', 'agent', 'name', 'agent_name']);
    const instrRaw = pickField<unknown>(tt, ['instruction', 'task', 'description', 'prompt']);
    if (typeof agentRef !== 'string' || typeof instrRaw !== 'string') continue;
    const instruction = instrRaw.trim();
    if (instruction.length === 0) continue;
    const agent =
      agents.find((a) => a.id === agentRef) ??
      agents.find((a) => a.name.toLowerCase() === agentRef.toLowerCase());
    if (!agent) continue;
    tasks.push({
      id: randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      agentColor: agent.avatarColor,
      instruction,
    });
  }
  if (tasks.length === 0) return null;

  // Default synthesizer to the first task's agent if planner omitted/misnamed.
  if (!synth) synth = agents.find((a) => a.id === tasks[0]!.agentId) ?? agents[0]!;

  return {
    summary: summary.slice(0, 240),
    tasks,
    synthesizerAgentId: synth.id,
    synthesizerAgentName: synth.name,
    synthesizerAgentColor: synth.avatarColor,
  };
}

function buildSynthesisPrompt(
  userText: string,
  results: { task: CoordinatorTaskPlan; output: string; ok: boolean }[],
): string {
  const sections = results
    .map((r, i) => {
      const status = r.ok ? '' : ' (FAILED)';
      return `### Subtask ${i + 1} — ${r.task.agentName}${status}\nInstruction: ${r.task.instruction}\n\nOutput:\n${r.output || '(no output)'}`;
    })
    .join('\n\n---\n\n');
  return `You are synthesizing the work of a team of specialist agents.

Original user request:
"""
${userText}
"""

Each teammate produced output below. Read all of them and write a single,
unified, well-structured final answer for the user. Cite which teammate
contributed which insight by name when useful. Do NOT just concatenate —
integrate. If outputs disagree, reconcile or call out the disagreement.

${sections}

Now write the final answer.`;
}

function makeNoopDispatcher(): ToolDispatcher {
  return {
    async call(): Promise<never> {
      throw new Error('synthesis runtime should not invoke tools');
    },
  } as unknown as ToolDispatcher;
}

/**
 * Combine multiple AbortSignals into one. Aborts when any input aborts.
 * Removes listeners eagerly when the merged signal aborts to avoid
 * accumulating listeners on long-lived parent signals across iterations.
 */
function mergeSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const cleanup = (): void => {
    for (const s of signals) {
      s.removeEventListener('abort', onAbort);
    }
  };
  const onAbort = (): void => {
    controller.abort();
    cleanup();
  };
  for (const s of signals) {
    if (s.aborted) {
      controller.abort();
      cleanup();
      return controller.signal;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
}

/** Current-context block appended to every team-mode agent's system prompt
 *  so they get a real date instead of inventing one from training data. */
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
