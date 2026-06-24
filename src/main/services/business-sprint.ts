// Business autopilot sprint engine. Pure logic — no electron imports — so the
// whole plan/execute/wrap lifecycle is unit-testable. Strategy plans via a
// single LLM call (strict JSON), marketing/ops tasks run through an injected
// tool-using agent runner, outward actions only ever land in the approval
// queue (TASK_GUARDRAIL), and the wrap phase writes a briefing + memory.

import { randomUUID } from 'node:crypto';
import type {
  BusinessFeedEvent,
  BusinessProfile,
  BusinessSprint,
  BusinessStore,
  ProposedAction,
  SprintTask,
} from './business-store';

export interface LlmOnce {
  (req: { agentId: string; system?: string; prompt: string; json?: boolean }): Promise<string>;
}

export interface AgentTaskRunner {
  run(
    agentId: string,
    instruction: string,
    onEvent?: (e: { type: 'text' | 'tool'; text?: string; tool?: string }) => void,
  ): Promise<string>;
}

export interface BusinessSprintDeps {
  store: BusinessStore;
  llmOnce: LlmOnce; // plan + wrap phases (strategy agent, no tools)
  tasks: AgentTaskRunner; // execute phase + approval execution (tools)
  emit: (e: BusinessFeedEvent) => void; // store.pushFeed + IPC broadcast
  now?: () => number;
}

const FENCE_RE = /```proposed-action\s*\n([\s\S]*?)```/g;

export function parseProposedActions(
  text: string,
  sprintId: string,
  role: ProposedAction['role'],
  now: number,
): ProposedAction[] {
  const out: ProposedAction[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    try {
      const raw = JSON.parse(m[1] ?? '') as Record<string, unknown>;
      const kind = ['email', 'post', 'code'].includes(String(raw['kind']))
        ? (String(raw['kind']) as ProposedAction['kind'])
        : 'other';
      const title = String(raw['title'] ?? '').trim();
      const body = String(raw['body'] ?? '').trim();
      if (!title || !body) continue;
      out.push({
        id: randomUUID(),
        sprintId,
        role,
        kind,
        title,
        body,
        status: 'proposed',
        createdAt: now,
        updatedAt: now,
      });
    } catch {
      // junk block — skip
    }
  }
  return out;
}

export const TASK_GUARDRAIL = `
You are executing one sprint task for the business autopilot. NEVER send,
post, publish, deploy, or spend during this run. For every outward action you
want taken, emit it as a fenced block instead:
\`\`\`proposed-action
{"kind":"email|post|code|other","title":"...","body":"..."}
\`\`\`
Do research and produce artifacts; the user approves outward actions later.`;

export function dueToday(
  profile: BusinessProfile,
  lastStartedAt: number | null,
  now: number,
): boolean {
  if (!profile.schedule.enabled) return false;
  const d = new Date(now);
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (hhmm < profile.schedule.time) return false;
  if (lastStartedAt) {
    const last = new Date(lastStartedAt);
    if (
      last.getFullYear() === d.getFullYear() &&
      last.getMonth() === d.getMonth() &&
      last.getDate() === d.getDate()
    ) {
      return false;
    }
  }
  return true;
}

export function buildPlannerPrompt(
  profile: BusinessProfile,
  memory: string,
  lastBriefing: string | null,
  openActions: ProposedAction[],
): string {
  const lines = [
    `You are the strategy chief for "${profile.name}" — ${profile.product}, for ${profile.audience}.`,
    `Company goals: ${profile.goals.join('; ')}`,
    profile.links.site ? `Site: ${profile.links.site}` : '',
    profile.links.repo ? `Repo: ${profile.links.repo}` : '',
    '',
    'Business memory:',
    memory.slice(0, 8_000),
    '',
    lastBriefing ? `Yesterday's briefing:\n${lastBriefing.slice(0, 2_000)}\n` : '',
    openActions.length
      ? `Open proposed actions awaiting the owner: ${openActions
          .map((a) => a.title)
          .slice(0, 10)
          .join('; ')}`
      : '',
    '',
    'Plan today\'s sprint. Reply with a single JSON object, nothing else:',
    '{"goals": ["..."], "tasks": [{"role": "marketing"|"ops", "instruction": "..."}]}',
    'At most 4 tasks. Each instruction must be self-contained and concrete.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export function buildWrapPrompt(goals: string[], tasks: SprintTask[]): string {
  const outputs = tasks
    .map(
      (t) =>
        `### [${t.role}] ${t.instruction} — ${t.status}\n${(t.output ?? t.error ?? '').slice(0, 3_000)}`,
    )
    .join('\n\n');
  return (
    `Today's sprint goals were: ${goals.join('; ')}.\n\n` +
    `Task results:\n${outputs}\n\n` +
    'Write the daily briefing for the owner in markdown: "## Daily briefing" header, ' +
    'then sections **Shipped today**, **Needs you** (pending approvals), and ' +
    '**Tomorrow** (what to do next and why). Keep it under 250 words.'
  );
}

export function buildApprovalPrompt(action: ProposedAction): string {
  return (
    'Execute exactly this approved artifact via your available tools. Do not ' +
    'rewrite it. If no suitable tool is connected, reply with the final ' +
    'ready-to-use artifact and state that manual execution is needed.\n\n' +
    `Title: ${action.title}\nKind: ${action.kind}\nBody:\n${action.body}`
  );
}

interface PlannedTask {
  role: 'marketing' | 'ops';
  instruction: string;
}

function parsePlan(text: string): { goals: string[]; tasks: PlannedTask[] } | null {
  try {
    // tolerate surrounding prose by grabbing the outermost object
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const goals = Array.isArray(raw['goals'])
      ? raw['goals'].map((g) => String(g)).filter((g) => g.trim())
      : [];
    const tasksRaw = Array.isArray(raw['tasks']) ? raw['tasks'] : [];
    const tasks: PlannedTask[] = [];
    for (const t of tasksRaw.slice(0, 4)) {
      const o = t as Record<string, unknown>;
      const role = o['role'] === 'marketing' || o['role'] === 'ops' ? o['role'] : null;
      const instruction = String(o['instruction'] ?? '').trim();
      if (role && instruction) tasks.push({ role, instruction });
    }
    if (!goals.length || !tasks.length) return null;
    return { goals, tasks };
  } catch {
    return null;
  }
}

export class BusinessSprintRunner {
  private active = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: BusinessSprintDeps) {
    // A sprint left non-terminal means the app died mid-run.
    for (const s of this.deps.store.sprints()) {
      if (s.status === 'planning' || s.status === 'running' || s.status === 'wrapping') {
        this.deps.store.upsertSprint({
          ...s,
          status: 'error',
          error: 'interrupted',
          finishedAt: this.nowMs(),
        });
      }
    }
  }

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private feed(
    kind: BusinessFeedEvent['kind'],
    text: string,
    extra: { sprintId?: string; role?: string } = {},
  ): void {
    this.deps.emit({ id: randomUUID(), ts: this.nowMs(), kind, text, ...extra });
  }

  async runSprint(): Promise<{ sprintId?: string; error?: string }> {
    if (this.active) return { error: 'sprint already running' };
    const profile = this.deps.store.loadProfile();
    if (!profile) return { error: 'no business profile' };
    this.active = true;
    const sprint: BusinessSprint = {
      id: randomUUID(),
      status: 'planning',
      goals: [],
      tasks: [],
      startedAt: this.nowMs(),
    };
    try {
      this.deps.store.upsertSprint(sprint);
      this.feed('sprint-start', `Sprint started · ${sprint.id}`, { sprintId: sprint.id });
      this.feed('phase', 'Planning goals from profile + memory', {
        sprintId: sprint.id,
        role: 'strategy',
      });

      // ── plan ────────────────────────────────────────────────────────────
      const memory = this.deps.store.readMemory();
      const lastBriefing =
        this.deps.store
          .sprints()
          .filter((s) => s.id !== sprint.id && s.briefing)
          .map((s) => s.briefing as string)
          .pop() ?? null;
      const openActions = this.deps.store.actions().filter((a) => a.status === 'proposed');
      const plannerPrompt = buildPlannerPrompt(profile, memory, lastBriefing, openActions);

      let plan = parsePlan(
        await this.deps.llmOnce({
          agentId: profile.roleAgentIds.strategy,
          prompt: plannerPrompt,
          json: true,
        }),
      );
      if (!plan) {
        plan = parsePlan(
          await this.deps.llmOnce({
            agentId: profile.roleAgentIds.strategy,
            prompt: `${plannerPrompt}\n\nReply with ONLY the JSON object.`,
            json: true,
          }),
        );
      }
      if (!plan) {
        sprint.status = 'error';
        sprint.error = 'planner returned invalid JSON';
        sprint.finishedAt = this.nowMs();
        this.deps.store.upsertSprint(sprint);
        this.feed('error', 'Planner returned invalid JSON — sprint aborted', {
          sprintId: sprint.id,
          role: 'strategy',
        });
        this.feed('sprint-end', `Sprint failed · ${sprint.id}`, { sprintId: sprint.id });
        return { sprintId: sprint.id, error: sprint.error };
      }

      sprint.goals = plan.goals;
      sprint.tasks = plan.tasks.map((t) => ({
        id: randomUUID(),
        role: t.role,
        instruction: t.instruction,
        status: 'pending' as const,
      }));
      sprint.status = 'running';
      this.deps.store.upsertSprint(sprint);
      this.feed(
        'phase',
        `${plan.goals.length} goals → ${sprint.tasks.length} tasks dispatched`,
        { sprintId: sprint.id, role: 'strategy' },
      );

      // ── execute ─────────────────────────────────────────────────────────
      await Promise.all(
        sprint.tasks.map(async (task) => {
          const agentId =
            task.role === 'marketing'
              ? profile.roleAgentIds.marketing
              : profile.roleAgentIds.ops;
          task.status = 'running';
          this.deps.store.upsertSprint(sprint);
          this.feed('task-start', task.instruction, { sprintId: sprint.id, role: task.role });
          try {
            const output = await this.deps.tasks.run(
              agentId,
              `${task.instruction}\n${TASK_GUARDRAIL}`,
              (e) => {
                if (e.type === 'tool' && e.tool) {
                  this.feed('task-tool', `tool: ${e.tool}`, {
                    sprintId: sprint.id,
                    role: task.role,
                  });
                }
              },
            );
            task.output = output;
            task.status = 'done';
            this.feed('task-done', task.instruction, { sprintId: sprint.id, role: task.role });
            for (const action of parseProposedActions(
              output,
              sprint.id,
              task.role,
              this.nowMs(),
            )) {
              this.deps.store.upsertAction(action);
              this.feed('action-proposed', `Proposed: ${action.title}`, {
                sprintId: sprint.id,
                role: task.role,
              });
            }
          } catch (err) {
            task.status = 'error';
            task.error = err instanceof Error ? err.message : String(err);
            this.feed('error', `Task failed: ${task.instruction} — ${task.error}`, {
              sprintId: sprint.id,
              role: task.role,
            });
          }
          this.deps.store.upsertSprint(sprint);
        }),
      );

      // ── wrap ────────────────────────────────────────────────────────────
      sprint.status = 'wrapping';
      this.deps.store.upsertSprint(sprint);
      this.feed('phase', 'Wrapping: writing briefing + memory', {
        sprintId: sprint.id,
        role: 'strategy',
      });
      const briefing = await this.deps.llmOnce({
        agentId: profile.roleAgentIds.strategy,
        prompt: buildWrapPrompt(sprint.goals, sprint.tasks),
      });
      sprint.briefing = briefing;
      const date = new Date(this.nowMs()).toISOString().slice(0, 10);
      this.deps.store.appendMemory(`## Learnings — ${date}\n${briefing.trim()}`);
      this.feed('briefing', 'Daily briefing ready', { sprintId: sprint.id, role: 'strategy' });

      sprint.status = 'done';
      sprint.finishedAt = this.nowMs();
      this.deps.store.upsertSprint(sprint);
      this.feed('sprint-end', `Sprint complete · ${sprint.id}`, { sprintId: sprint.id });
      return { sprintId: sprint.id };
    } catch (err) {
      sprint.status = 'error';
      sprint.error = err instanceof Error ? err.message : String(err);
      sprint.finishedAt = this.nowMs();
      this.deps.store.upsertSprint(sprint);
      this.feed('error', `Sprint failed: ${sprint.error}`, { sprintId: sprint.id });
      this.feed('sprint-end', `Sprint failed · ${sprint.id}`, { sprintId: sprint.id });
      return { sprintId: sprint.id, error: sprint.error };
    } finally {
      this.active = false;
    }
  }

  async approve(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const action = this.deps.store.actions().find((a) => a.id === actionId);
    if (!action) return { ok: false, error: 'unknown action' };
    const profile = this.deps.store.loadProfile();
    if (!profile) return { ok: false, error: 'no business profile' };
    const agentId =
      action.role === 'marketing'
        ? profile.roleAgentIds.marketing
        : action.role === 'ops'
          ? profile.roleAgentIds.ops
          : profile.roleAgentIds.strategy;

    const patch = (p: Partial<ProposedAction>): ProposedAction => {
      const next = { ...action, ...p, updatedAt: this.nowMs() };
      this.deps.store.upsertAction(next);
      return next;
    };
    patch({ status: 'approved' });
    patch({ status: 'executing' });
    try {
      const result = await this.deps.tasks.run(agentId, buildApprovalPrompt(action));
      patch({ status: 'done', result });
      this.feed('action-executed', `Executed: ${action.title}`, {
        sprintId: action.sprintId,
        role: action.role,
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      patch({ status: 'failed', result: msg });
      this.feed('action-failed', `Failed: ${action.title} — ${msg}`, {
        sprintId: action.sprintId,
        role: action.role,
      });
      return { ok: true };
    }
  }

  async reject(actionId: string): Promise<{ ok: boolean; error?: string }> {
    const action = this.deps.store.actions().find((a) => a.id === actionId);
    if (!action) return { ok: false, error: 'unknown action' };
    this.deps.store.upsertAction({ ...action, status: 'rejected', updatedAt: this.nowMs() });
    return { ok: true };
  }

  startScheduler(intervalMs = 30_000): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const profile = this.deps.store.loadProfile();
      if (!profile) return;
      const newest = this.deps.store.sprints().slice(-1)[0];
      if (dueToday(profile, newest?.startedAt ?? null, this.nowMs())) {
        void this.runSprint();
      }
    }, intervalMs);
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
