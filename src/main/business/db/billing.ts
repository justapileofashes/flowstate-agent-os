// Credits ledger (append-only; balance_after makes reconciliation a single
// read) + usage events (one row per model call: tokens, cost, credits, ok).

import type { Database } from 'better-sqlite3';
import type { LedgerEntryDto } from '@shared/business/types';
import { startOfMonth, uid, type Row } from './util';

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function mapLedger(r: Row): LedgerEntryDto {
  return {
    id: r.id,
    companyId: r.company_id,
    delta: r.delta,
    balanceAfter: r.balance_after,
    reason: r.reason,
    refType: r.ref_type ?? null,
    refId: r.ref_id ?? null,
    note: r.note,
    createdAt: r.created_at,
  };
}

export interface UsageEventInput {
  companyId: string;
  cycleId: string | null;
  runId: string | null;
  role: string | null;
  alias: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  credits: number;
  ok: boolean;
  error?: string | null;
  latencyMs: number;
}

export interface UsageRowLite {
  role: string | null;
  model: string;
  provider: string;
  costUsd: number;
  credits: number;
  ok: boolean;
  createdAt: number;
}

export class BillingRepo {
  constructor(private readonly db: Database) {}

  balance(companyId: string): number {
    const r = this.db
      .prepare(
        'SELECT balance_after AS b FROM biz_credits_ledger WHERE company_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(companyId) as { b: number } | undefined;
    return r?.b ?? 0;
  }

  /** Append a ledger row; balance is computed inside the same transaction. */
  entry(input: {
    companyId: string;
    delta: number;
    reason: LedgerEntryDto['reason'];
    refType?: string | null;
    refId?: string | null;
    note?: string;
    now?: number;
  }): LedgerEntryDto {
    const id = uid();
    this.db.transaction(() => {
      const balance = round6(this.balance(input.companyId) + input.delta);
      this.db
        .prepare(
          `INSERT INTO biz_credits_ledger (id, company_id, delta, balance_after, reason, ref_type, ref_id, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.companyId,
          round6(input.delta),
          balance,
          input.reason,
          input.refType ?? null,
          input.refId ?? null,
          (input.note ?? '').slice(0, 300),
          input.now ?? Date.now(),
        );
    })();
    return mapLedger(this.db.prepare('SELECT * FROM biz_credits_ledger WHERE id = ?').get(id) as Row);
  }

  ledger(companyId: string, limit = 100): LedgerEntryDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_credits_ledger WHERE company_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(companyId, limit) as Row[]
    ).map(mapLedger);
  }

  /** Sum of deltas — must equal balance() (reconciliation invariant). */
  sumDeltas(companyId: string): number {
    const r = this.db
      .prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM biz_credits_ledger WHERE company_id = ?')
      .get(companyId) as { s: number };
    return round6(r.s);
  }

  hasEntry(companyId: string, reason: LedgerEntryDto['reason'], refId: string): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM biz_credits_ledger WHERE company_id = ? AND reason = ? AND ref_id = ? LIMIT 1')
        .get(companyId, reason, refId),
    );
  }

  /** Credits spent (positive number) since `since`. */
  spentSince(companyId: string, since: number): number {
    const r = this.db
      .prepare(
        `SELECT COALESCE(SUM(-delta), 0) AS s FROM biz_credits_ledger
         WHERE company_id = ? AND created_at >= ? AND reason IN ('cycle_spend', 'skill_spend', 'refund')`,
      )
      .get(companyId, since) as { s: number };
    return round6(r.s);
  }

  monthSpent(companyId: string, now = Date.now()): number {
    return this.spentSince(companyId, startOfMonth(now));
  }

  // ── usage events ────────────────────────────────────────────────────────

  recordUsage(e: UsageEventInput, now = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO biz_usage_events (id, company_id, cycle_id, run_id, role, alias, provider, model, input_tokens,
           output_tokens, cost_usd, credits, ok, error, latency_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uid(),
        e.companyId,
        e.cycleId,
        e.runId,
        e.role,
        e.alias,
        e.provider,
        e.model,
        e.inputTokens,
        e.outputTokens,
        e.costUsd,
        e.credits,
        e.ok ? 1 : 0,
        e.error ? e.error.slice(0, 500) : null,
        e.latencyMs,
        now,
      );
  }

  usageSince(companyId: string, since: number): UsageRowLite[] {
    return (
      this.db
        .prepare(
          `SELECT role, model, provider, cost_usd, credits, ok, created_at FROM biz_usage_events
           WHERE company_id = ? AND created_at >= ? ORDER BY created_at`,
        )
        .all(companyId, since) as Row[]
    ).map((r) => ({
      role: r.role ?? null,
      model: r.model,
      provider: r.provider,
      costUsd: r.cost_usd,
      credits: r.credits,
      ok: r.ok === 1,
      createdAt: r.created_at,
    }));
  }

  usdSince(companyId: string, since: number): number {
    const r = this.db
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM biz_usage_events WHERE company_id = ? AND created_at >= ?')
      .get(companyId, since) as { s: number };
    return r.s;
  }

  recentProviderCalls(companyId: string, limit = 100): Array<{ provider: string; ok: boolean }> {
    return (
      this.db
        .prepare('SELECT provider, ok FROM biz_usage_events WHERE company_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(companyId, limit) as Row[]
    ).map((r) => ({ provider: r.provider, ok: r.ok === 1 }));
  }
}
