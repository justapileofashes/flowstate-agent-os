// Approval queue (pending_actions) + the idempotency ledger. Status moves
// are compare-and-set UPDATEs so a double-click or a retry can never claim
// the same action twice; skill_executions records one result per
// idempotency key so re-execution returns the recorded outcome.

import type { Database } from 'better-sqlite3';
import type {
  ActionCategory,
  PendingActionDto,
  PendingStatus,
  RiskLevel,
  RoleKey,
} from '@shared/business/types';
import { uid, type Row } from './util';

export interface PendingRow extends PendingActionDto {
  argsEnc: string;
  idempotencyKey: string;
}

function mapPending(r: Row): PendingRow {
  return {
    id: r.id,
    companyId: r.company_id,
    cycleId: r.cycle_id ?? null,
    runId: r.run_id ?? null,
    taskId: r.task_id ?? null,
    role: r.role as RoleKey,
    skillKey: r.skill_key,
    category: r.category as ActionCategory,
    riskLevel: r.risk_level as RiskLevel,
    title: r.title,
    summary: r.summary,
    reason: r.reason,
    gate: r.gate,
    credits: r.credits,
    status: r.status as PendingStatus,
    executeAfter: r.execute_after ?? null,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ?? null,
    decisionNote: r.decision_note ?? null,
    result: r.result ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    argsEnc: r.args_enc,
    idempotencyKey: r.idempotency_key,
  };
}

/** Strip internal columns before a row leaves the main process. */
export function toPendingDto(p: PendingRow): PendingActionDto {
  const { argsEnc: _a, idempotencyKey: _k, ...dto } = p;
  return dto;
}

export interface ExecutionRecord {
  idempotencyKey: string;
  status: 'running' | 'succeeded' | 'failed';
  result: string | null;
  attempts: number;
  createdAt: number;
  finishedAt: number | null;
}

export class ApprovalsRepo {
  constructor(private readonly db: Database) {}

  create(input: {
    companyId: string;
    cycleId: string | null;
    runId: string | null;
    taskId: string | null;
    role: RoleKey;
    skillKey: string;
    category: ActionCategory;
    riskLevel: RiskLevel;
    title: string;
    summary: string;
    argsEnc: string;
    reason: string;
    gate: 'approval' | 'objection_window';
    idempotencyKey: string;
    credits: number;
    executeAfter?: number | null;
    now?: number;
  }): { row: PendingRow; created: boolean } {
    const existing = this.byIdempotencyKey(input.idempotencyKey);
    if (existing) return { row: existing, created: false };
    const id = uid();
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO biz_pending_actions (id, company_id, cycle_id, run_id, task_id, role, skill_key, category,
           risk_level, title, summary, args_enc, reason, gate, idempotency_key, credits, status, execute_after,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.cycleId,
        input.runId,
        input.taskId,
        input.role,
        input.skillKey,
        input.category,
        input.riskLevel,
        input.title.slice(0, 200),
        input.summary.slice(0, 2_000),
        input.argsEnc,
        input.reason.slice(0, 500),
        input.gate,
        input.idempotencyKey,
        input.credits,
        input.executeAfter ?? null,
        now,
        now,
      );
    return { row: this.get(id)!, created: true };
  }

  get(id: string, companyId?: string): PendingRow | null {
    const r = (
      companyId
        ? this.db.prepare('SELECT * FROM biz_pending_actions WHERE id = ? AND company_id = ?').get(id, companyId)
        : this.db.prepare('SELECT * FROM biz_pending_actions WHERE id = ?').get(id)
    ) as Row | undefined;
    return r ? mapPending(r) : null;
  }

  byIdempotencyKey(key: string): PendingRow | null {
    const r = this.db
      .prepare('SELECT * FROM biz_pending_actions WHERE idempotency_key = ?')
      .get(key) as Row | undefined;
    return r ? mapPending(r) : null;
  }

  list(filter: { companyId?: string; statuses?: PendingStatus[]; limit?: number }): PendingRow[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter.companyId) {
      where.push('company_id = ?');
      args.push(filter.companyId);
    }
    if (filter.statuses?.length) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
      args.push(...filter.statuses);
    }
    args.push(filter.limit ?? 200);
    return (
      this.db
        .prepare(
          `SELECT * FROM biz_pending_actions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
           ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        )
        .all(...args) as Row[]
    ).map(mapPending);
  }

  countPending(companyId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM biz_pending_actions WHERE company_id = ? AND status = 'pending'")
      .get(companyId) as { n: number };
    return row.n;
  }

  oldestPendingAt(companyId: string): number | null {
    const row = this.db
      .prepare("SELECT MIN(created_at) AS t FROM biz_pending_actions WHERE company_id = ? AND status = 'pending'")
      .get(companyId) as { t: number | null };
    return row.t;
  }

  /** Compare-and-set status transition. Returns true iff this caller won. */
  transition(
    id: string,
    from: PendingStatus[],
    to: PendingStatus,
    extra: { decidedBy?: string; decidedAt?: number; decisionNote?: string; result?: string } = {},
    now = Date.now(),
  ): boolean {
    const sets = ['status = ?', 'updated_at = ?'];
    const args: unknown[] = [to, now];
    if (extra.decidedBy !== undefined) {
      sets.push('decided_by = ?');
      args.push(extra.decidedBy);
    }
    if (extra.decidedAt !== undefined) {
      sets.push('decided_at = ?');
      args.push(extra.decidedAt);
    }
    if (extra.decisionNote !== undefined) {
      sets.push('decision_note = ?');
      args.push(extra.decisionNote.slice(0, 1_000));
    }
    if (extra.result !== undefined) {
      sets.push('result = ?');
      args.push(extra.result.slice(0, 8_000));
    }
    const res = this.db
      .prepare(
        `UPDATE biz_pending_actions SET ${sets.join(', ')}
         WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`,
      )
      .run(...args, id, ...from);
    return res.changes === 1;
  }

  /** Objection-window actions whose window has elapsed. */
  dueObjectionWindow(now = Date.now()): PendingRow[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM biz_pending_actions WHERE status = 'pending' AND gate = 'objection_window'
             AND execute_after IS NOT NULL AND execute_after <= ?`,
        )
        .all(now) as Row[]
    ).map(mapPending);
  }

  /** Vault rotation: re-encrypt every args blob. */
  allArgs(): Array<{ id: string; argsEnc: string }> {
    return (this.db.prepare('SELECT id, args_enc FROM biz_pending_actions').all() as Row[]).map((r) => ({
      id: r.id,
      argsEnc: r.args_enc,
    }));
  }

  setArgs(id: string, argsEnc: string): void {
    this.db.prepare('UPDATE biz_pending_actions SET args_enc = ? WHERE id = ?').run(argsEnc, id);
  }

  // ── idempotency ledger ──────────────────────────────────────────────────

  getExecution(key: string): ExecutionRecord | null {
    const r = this.db
      .prepare('SELECT * FROM biz_skill_executions WHERE idempotency_key = ?')
      .get(key) as Row | undefined;
    if (!r) return null;
    return {
      idempotencyKey: r.idempotency_key,
      status: r.status,
      result: r.result ?? null,
      attempts: r.attempts,
      createdAt: r.created_at,
      finishedAt: r.finished_at ?? null,
    };
  }

  /**
   * Claim an idempotency key for execution. Returns:
   *  - { claimed: true } when this caller should run the side effect;
   *  - { claimed: false, record } when it already succeeded (replay the
   *    result) or is running right now (don't double-run).
   */
  claimExecution(
    key: string,
    companyId: string,
    skillKey: string,
    staleMs: number,
    now = Date.now(),
  ): { claimed: true } | { claimed: false; record: ExecutionRecord } {
    return this.db.transaction(() => {
      const existing = this.getExecution(key);
      if (!existing) {
        this.db
          .prepare(
            `INSERT INTO biz_skill_executions (idempotency_key, company_id, skill_key, status, attempts, created_at)
             VALUES (?, ?, ?, 'running', 1, ?)`,
          )
          .run(key, companyId, skillKey, now);
        return { claimed: true as const };
      }
      const staleRun = existing.status === 'running' && now - existing.createdAt > staleMs;
      if (existing.status === 'failed' || staleRun) {
        this.db
          .prepare(
            `UPDATE biz_skill_executions SET status = 'running', attempts = attempts + 1, created_at = ?,
               finished_at = NULL WHERE idempotency_key = ?`,
          )
          .run(now, key);
        return { claimed: true as const };
      }
      return { claimed: false as const, record: existing };
    })();
  }

  countExecutionsSince(companyId: string, skillKey: string, since: number): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM biz_skill_executions WHERE company_id = ? AND skill_key = ? AND created_at >= ?',
      )
      .get(companyId, skillKey, since) as { n: number };
    return row.n;
  }

  finishExecution(key: string, status: 'succeeded' | 'failed', result: string, now = Date.now()): void {
    this.db
      .prepare('UPDATE biz_skill_executions SET status = ?, result = ?, finished_at = ? WHERE idempotency_key = ?')
      .run(status, result.slice(0, 20_000), now, key);
  }
}
