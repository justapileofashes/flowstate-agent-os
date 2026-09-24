// Episodic memory: cycles (one CEO plan-and-execute pass), agent runs (one
// role loop), and run_steps (the append-only, redacted trace every run
// writes). Steps are never mutated — they are the audit + replay source.

import type { Database } from 'better-sqlite3';
import type {
  CycleDto,
  CycleKind,
  CyclePlan,
  CycleStatus,
  RoleKey,
  RunDto,
  RunStatus,
  StepDto,
  StepKind,
  StepPhase,
  StopReason,
  TriggerType,
} from '@shared/business/types';
import { buildUpdate, parseJson, uid, type Row } from './util';

function mapCycle(r: Row): CycleDto {
  return {
    id: r.id,
    companyId: r.company_id,
    kind: r.kind as CycleKind,
    triggerType: r.trigger_type as TriggerType,
    status: r.status as CycleStatus,
    role: (r.role as RoleKey | null) ?? null,
    plan: parseJson<CyclePlan | null>(r.plan, null),
    summary: r.summary ?? null,
    stopReason: r.stop_reason ?? null,
    creditsCap: r.credits_cap,
    usdCap: r.usd_cap,
    creditsSpent: r.credits_spent,
    costUsd: r.cost_usd,
    configVersion: r.config_version,
    error: r.error ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
  };
}

function mapRun(r: Row): RunDto {
  return {
    id: r.id,
    companyId: r.company_id,
    cycleId: r.cycle_id ?? null,
    taskId: r.task_id ?? null,
    role: r.role as RoleKey,
    triggerType: r.trigger_type,
    status: r.status as RunStatus,
    stopReason: (r.stop_reason as StopReason | null) ?? null,
    goal: r.goal,
    output: r.output ?? null,
    iterationCount: r.iteration_count,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    credits: r.credits,
    errorMessage: r.error_message ?? null,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? null,
  };
}

function mapStep(r: Row): StepDto {
  return {
    id: r.id,
    runId: r.run_id,
    seqNo: r.seq_no,
    phase: r.phase as StepPhase,
    stepKind: r.step_kind as StepKind,
    iteration: r.iteration,
    promptSnippet: r.prompt_snippet ?? null,
    content: r.content ?? null,
    toolName: r.tool_name ?? null,
    toolArgsRedacted: r.tool_args_redacted ?? null,
    toolResultRedacted: r.tool_result_redacted ?? null,
    ok: r.ok === null || r.ok === undefined ? null : r.ok === 1,
    model: r.model ?? null,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    costUsd: r.cost_usd,
    credits: r.credits,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

const CYCLE_COLUMNS: Record<string, string> = {
  status: 'status',
  plan: 'plan',
  summary: 'summary',
  stopReason: 'stop_reason',
  creditsSpent: 'credits_spent',
  costUsd: 'cost_usd',
  error: 'error',
  endedAt: 'ended_at',
};

const RUN_COLUMNS: Record<string, string> = {
  status: 'status',
  stopReason: 'stop_reason',
  output: 'output',
  iterationCount: 'iteration_count',
  errorMessage: 'error_message',
  endedAt: 'ended_at',
  taskId: 'task_id',
};

export interface NewStep {
  phase: StepPhase;
  stepKind: StepKind;
  iteration?: number;
  promptSnippet?: string | null;
  content?: string | null;
  toolName?: string | null;
  toolArgsRedacted?: string | null;
  toolResultRedacted?: string | null;
  ok?: boolean | null;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  credits?: number;
  durationMs?: number;
}

export class RunsRepo {
  constructor(private readonly db: Database) {}

  // ── cycles ──────────────────────────────────────────────────────────────

  createCycle(input: {
    companyId: string;
    kind: CycleKind;
    triggerType: TriggerType;
    role?: RoleKey | null;
    creditsCap: number;
    usdCap: number;
    configVersion: number;
    status?: CycleStatus;
    now?: number;
  }): CycleDto {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO biz_cycles (id, company_id, kind, trigger_type, status, role, credits_cap, usd_cap,
           config_version, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.kind,
        input.triggerType,
        input.status ?? 'running',
        input.role ?? null,
        input.creditsCap,
        input.usdCap,
        input.configVersion,
        input.now ?? Date.now(),
      );
    return this.getCycle(id)!;
  }

  updateCycle(
    id: string,
    patch: Partial<Pick<CycleDto, 'status' | 'plan' | 'summary' | 'stopReason' | 'error' | 'endedAt'>>,
  ): void {
    const upd = buildUpdate('biz_cycles', 'id = ?', patch, CYCLE_COLUMNS);
    if (upd) this.db.prepare(upd.sql).run(...upd.values, id);
  }

  addCycleSpend(id: string, credits: number, usd: number): void {
    this.db
      .prepare(
        'UPDATE biz_cycles SET credits_spent = credits_spent + ?, cost_usd = cost_usd + ? WHERE id = ?',
      )
      .run(credits, usd, id);
  }

  getCycle(id: string, companyId?: string): CycleDto | null {
    const r = (
      companyId
        ? this.db.prepare('SELECT * FROM biz_cycles WHERE id = ? AND company_id = ?').get(id, companyId)
        : this.db.prepare('SELECT * FROM biz_cycles WHERE id = ?').get(id)
    ) as Row | undefined;
    return r ? mapCycle(r) : null;
  }

  listCycles(companyId: string, limit = 50): CycleDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_cycles WHERE company_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?')
        .all(companyId, limit) as Row[]
    ).map(mapCycle);
  }

  runningCycle(companyId: string): CycleDto | null {
    const r = this.db
      .prepare(
        "SELECT * FROM biz_cycles WHERE company_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1",
      )
      .get(companyId) as Row | undefined;
    return r ? mapCycle(r) : null;
  }

  lastCycle(companyId: string, opts: { withSummary?: boolean; kinds?: CycleKind[] } = {}): CycleDto | null {
    const where = ['company_id = ?', "status != 'running'"];
    const args: unknown[] = [companyId];
    if (opts.withSummary) where.push("summary IS NOT NULL AND summary != ''");
    if (opts.kinds?.length) {
      where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
      args.push(...opts.kinds);
    }
    const r = this.db
      .prepare(`SELECT * FROM biz_cycles WHERE ${where.join(' AND ')} ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(...args) as Row | undefined;
    return r ? mapCycle(r) : null;
  }

  cyclesSince(companyId: string, since: number): CycleDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_cycles WHERE company_id = ? AND started_at >= ? ORDER BY started_at')
        .all(companyId, since) as Row[]
    ).map(mapCycle);
  }

  // ── runs ────────────────────────────────────────────────────────────────

  createRun(input: {
    companyId: string;
    cycleId: string | null;
    taskId?: string | null;
    role: RoleKey;
    triggerType: RunDto['triggerType'];
    goal: string;
    now?: number;
  }): RunDto {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO biz_agent_runs (id, company_id, cycle_id, task_id, role, trigger_type, status, goal, started_at)
         VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.cycleId,
        input.taskId ?? null,
        input.role,
        input.triggerType,
        input.goal.slice(0, 4_000),
        input.now ?? Date.now(),
      );
    return this.getRun(id)!;
  }

  updateRun(
    id: string,
    patch: Partial<
      Pick<RunDto, 'status' | 'stopReason' | 'output' | 'iterationCount' | 'errorMessage' | 'endedAt' | 'taskId'>
    >,
  ): void {
    const upd = buildUpdate('biz_agent_runs', 'id = ?', patch, RUN_COLUMNS);
    if (upd) this.db.prepare(upd.sql).run(...upd.values, id);
  }

  addRunUsage(id: string, u: { tokensIn: number; tokensOut: number; costUsd: number; credits: number }): void {
    this.db
      .prepare(
        `UPDATE biz_agent_runs SET tokens_in = tokens_in + ?, tokens_out = tokens_out + ?,
           cost_usd = cost_usd + ?, credits = credits + ? WHERE id = ?`,
      )
      .run(u.tokensIn, u.tokensOut, u.costUsd, u.credits, id);
  }

  getRun(id: string, companyId?: string): RunDto | null {
    const r = (
      companyId
        ? this.db.prepare('SELECT * FROM biz_agent_runs WHERE id = ? AND company_id = ?').get(id, companyId)
        : this.db.prepare('SELECT * FROM biz_agent_runs WHERE id = ?').get(id)
    ) as Row | undefined;
    return r ? mapRun(r) : null;
  }

  listRuns(filter: {
    companyId: string;
    role?: RoleKey;
    status?: RunStatus;
    cycleId?: string;
    since?: number;
    limit?: number;
  }): RunDto[] {
    const where = ['company_id = ?'];
    const args: unknown[] = [filter.companyId];
    if (filter.role) {
      where.push('role = ?');
      args.push(filter.role);
    }
    if (filter.status) {
      where.push('status = ?');
      args.push(filter.status);
    }
    if (filter.cycleId) {
      where.push('cycle_id = ?');
      args.push(filter.cycleId);
    }
    if (filter.since) {
      where.push('started_at >= ?');
      args.push(filter.since);
    }
    args.push(filter.limit ?? 100);
    return (
      this.db
        .prepare(
          `SELECT * FROM biz_agent_runs WHERE ${where.join(' AND ')} ORDER BY started_at DESC, rowid DESC LIMIT ?`,
        )
        .all(...args) as Row[]
    ).map(mapRun);
  }

  runsForCycle(cycleId: string): RunDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_agent_runs WHERE cycle_id = ? ORDER BY started_at, rowid')
        .all(cycleId) as Row[]
    ).map(mapRun);
  }

  // ── steps ───────────────────────────────────────────────────────────────

  appendStep(runId: string, step: NewStep, now = Date.now()): StepDto {
    const id = uid();
    this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT COALESCE(MAX(seq_no), 0) AS s FROM biz_run_steps WHERE run_id = ?')
        .get(runId) as { s: number };
      this.db
        .prepare(
          `INSERT INTO biz_run_steps (id, run_id, seq_no, phase, step_kind, iteration, prompt_snippet, content,
             tool_name, tool_args_redacted, tool_result_redacted, ok, model, tokens_in, tokens_out, cost_usd,
             credits, duration_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          runId,
          row.s + 1,
          step.phase,
          step.stepKind,
          step.iteration ?? 0,
          step.promptSnippet ?? null,
          step.content ?? null,
          step.toolName ?? null,
          step.toolArgsRedacted ?? null,
          step.toolResultRedacted ?? null,
          step.ok === undefined || step.ok === null ? null : step.ok ? 1 : 0,
          step.model ?? null,
          step.tokensIn ?? 0,
          step.tokensOut ?? 0,
          step.costUsd ?? 0,
          step.credits ?? 0,
          step.durationMs ?? 0,
          now,
        );
    })();
    return mapStep(this.db.prepare('SELECT * FROM biz_run_steps WHERE id = ?').get(id) as Row);
  }

  steps(runId: string): StepDto[] {
    return (
      this.db.prepare('SELECT * FROM biz_run_steps WHERE run_id = ? ORDER BY seq_no').all(runId) as Row[]
    ).map(mapStep);
  }

  /** Crash recovery: anything left 'running' at startup was interrupted. */
  recoverInterrupted(now = Date.now()): { cycles: number; runs: number } {
    const cycles = this.db
      .prepare(
        "UPDATE biz_cycles SET status = 'failed', error = 'interrupted (app closed mid-cycle)', stop_reason = 'aborted', ended_at = ? WHERE status = 'running'",
      )
      .run(now).changes;
    const runs = this.db
      .prepare(
        "UPDATE biz_agent_runs SET status = 'stopped', stop_reason = 'aborted', error_message = 'interrupted', ended_at = ? WHERE status = 'running'",
      )
      .run(now).changes;
    return { cycles, runs };
  }
}
