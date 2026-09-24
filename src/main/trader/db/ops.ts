// Operational state: durable switches (kill switch, breaker, consent…),
// versioned config, alerts, metric samples, equity snapshots, operator log.

import type { Database } from 'better-sqlite3';
import { traderConfigSchema, type AccountKind, type AlertDto, type EquityPointDto, type TraderConfig } from '@shared/trader/types';
import { num, parseJson, uid, type Row } from './util';

export class OpsRepo {
  constructor(private readonly db: Database) {}

  // ── state kv ─────────────────────────────────────────────────────────────

  get<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM trader_state WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? parseJson<T>(r.value, fallback) : fallback;
  }

  set(key: string, value: unknown, now: number): void {
    this.db
      .prepare(
        'INSERT INTO trader_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      )
      .run(key, JSON.stringify(value), now);
  }

  listByPrefix<T>(prefix: string): Array<{ key: string; value: T }> {
    return (this.db.prepare('SELECT key, value FROM trader_state WHERE key LIKE ? ORDER BY key').all(`${prefix}%`) as Row[]).map((r) => ({
      key: r.key as string,
      value: parseJson<T>(r.value, {} as T),
    }));
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM trader_state WHERE key = ?').run(key);
  }

  /** Single-flight lease: true when this caller now holds `key` until `until`. */
  tryLease(key: string, holder: string, now: number, ttlMs: number): boolean {
    const res = this.db
      .prepare(
        `INSERT INTO trader_state (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
         WHERE json_extract(trader_state.value, '$.until') < ? OR json_extract(trader_state.value, '$.holder') = ?`,
      )
      .run(key, JSON.stringify({ holder, until: now + ttlMs }), now, now, holder);
    return res.changes === 1;
  }

  releaseLease(key: string, holder: string): void {
    this.db.prepare("DELETE FROM trader_state WHERE key = ? AND json_extract(value, '$.holder') = ?").run(key, holder);
  }

  // ── config versions ──────────────────────────────────────────────────────

  config(): { version: number; config: TraderConfig } {
    const r = this.db.prepare('SELECT version, config FROM trader_config_versions ORDER BY version DESC LIMIT 1').get() as Row | undefined;
    if (!r) return { version: 0, config: traderConfigSchema.parse({}) };
    const parsed = traderConfigSchema.safeParse(parseJson(r.config, {}));
    return { version: r.version, config: parsed.success ? parsed.data : traderConfigSchema.parse({}) };
  }

  saveConfig(config: TraderConfig, note: string, editedBy: string, now: number): number {
    const current = this.config().version;
    const version = current + 1;
    this.db
      .prepare('INSERT INTO trader_config_versions (version, config, note, edited_by, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(version, JSON.stringify(config), note.slice(0, 500), editedBy, now);
    return version;
  }

  configHistory(limit = 50): Array<{ version: number; note: string; editedBy: string; createdAt: number; config: TraderConfig }> {
    return (this.db.prepare('SELECT * FROM trader_config_versions ORDER BY version DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      version: r.version,
      note: r.note,
      editedBy: r.edited_by,
      createdAt: r.created_at,
      config: traderConfigSchema.parse(parseJson(r.config, {})),
    }));
  }

  // ── alerts ───────────────────────────────────────────────────────────────

  /** Raise an alert unless the same key is still open within `dedupeMs`. */
  raiseAlert(a: { key: string; severity: AlertDto['severity']; title: string; detail: string }, now: number, dedupeMs = 30 * 60_000): AlertDto | null {
    const open = this.db
      .prepare('SELECT id FROM trader_alerts WHERE key = ? AND acknowledged_at IS NULL AND created_at >= ? LIMIT 1')
      .get(a.key, now - dedupeMs);
    if (open) return null;
    const id = uid();
    this.db
      .prepare('INSERT INTO trader_alerts (id, key, severity, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, a.key, a.severity, a.title.slice(0, 200), a.detail.slice(0, 2000), now);
    return { id, key: a.key, severity: a.severity, title: a.title, detail: a.detail, createdAt: now, acknowledgedAt: null };
  }

  alerts(opts: { open?: boolean; limit?: number } = {}): AlertDto[] {
    const rows = opts.open
      ? this.db.prepare('SELECT * FROM trader_alerts WHERE acknowledged_at IS NULL ORDER BY created_at DESC LIMIT ?').all(opts.limit ?? 100)
      : this.db.prepare('SELECT * FROM trader_alerts ORDER BY created_at DESC LIMIT ?').all(opts.limit ?? 100);
    return (rows as Row[]).map((r) => ({
      id: r.id,
      key: r.key,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      createdAt: r.created_at,
      acknowledgedAt: r.acknowledged_at ?? null,
    }));
  }

  ackAlert(id: string | 'all', now: number): number {
    return id === 'all'
      ? this.db.prepare('UPDATE trader_alerts SET acknowledged_at = ? WHERE acknowledged_at IS NULL').run(now).changes
      : this.db.prepare('UPDATE trader_alerts SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL').run(now, id).changes;
  }

  openAlertCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM trader_alerts WHERE acknowledged_at IS NULL').get() as { n: number }).n;
  }

  // ── metric samples ───────────────────────────────────────────────────────

  recordSamples(samples: Array<{ name: string; labels: string; value: number }>, ts: number): void {
    if (!samples.length) return;
    const stmt = this.db.prepare('INSERT INTO trader_metrics (name, labels, ts, value) VALUES (?, ?, ?, ?)');
    this.db.transaction(() => {
      for (const s of samples) if (Number.isFinite(s.value)) stmt.run(s.name, s.labels, ts, s.value);
    })();
  }

  series(name: string, since: number): Array<{ labels: string; ts: number; value: number }> {
    return this.db
      .prepare('SELECT labels, ts, value FROM trader_metrics WHERE name = ? AND ts >= ? ORDER BY ts')
      .all(name, since) as Array<{ labels: string; ts: number; value: number }>;
  }

  pruneMetrics(olderThan: number): void {
    this.db.prepare('DELETE FROM trader_metrics WHERE ts < ?').run(olderThan);
  }

  // ── equity curve ─────────────────────────────────────────────────────────

  recordEquity(account: AccountKind, ts: number, equity: number, cash: number): void {
    this.db.prepare('INSERT OR REPLACE INTO trader_equity (account, ts, equity, cash) VALUES (?, ?, ?, ?)').run(account, ts, equity, cash);
  }

  equityCurve(account: AccountKind, since: number, maxPoints = 400): EquityPointDto[] {
    const rows = this.db
      .prepare('SELECT ts, equity FROM trader_equity WHERE account = ? AND ts >= ? ORDER BY ts')
      .all(account, since) as Array<{ ts: number; equity: number }>;
    if (rows.length <= maxPoints) return rows;
    const step = rows.length / maxPoints;
    const out: EquityPointDto[] = [];
    for (let i = 0; i < maxPoints; i++) out.push(rows[Math.floor(i * step)]!);
    out.push(rows[rows.length - 1]!);
    return out;
  }

  peakEquity(account: AccountKind): number {
    return num((this.db.prepare('SELECT MAX(equity) AS m FROM trader_equity WHERE account = ?').get(account) as Row).m);
  }

  equityAt(account: AccountKind, beforeTs: number): number | null {
    const r = this.db
      .prepare('SELECT equity FROM trader_equity WHERE account = ? AND ts < ? ORDER BY ts DESC LIMIT 1')
      .get(account, beforeTs) as { equity: number } | undefined;
    return r?.equity ?? null;
  }

  firstEquityTs(account: AccountKind): number | null {
    const r = this.db.prepare('SELECT MIN(ts) AS t FROM trader_equity WHERE account = ?').get(account) as { t: number | null };
    return r.t ?? null;
  }

  resetEquity(account: AccountKind): void {
    this.db.prepare('DELETE FROM trader_equity WHERE account = ?').run(account);
  }

  // ── operator log ─────────────────────────────────────────────────────────

  log(actor: string, action: string, detail: Record<string, unknown>, now: number): void {
    this.db
      .prepare('INSERT INTO trader_ops_log (id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(uid(), actor, action, JSON.stringify(detail).slice(0, 8000), now);
  }

  opsLog(limit = 100): Array<{ id: string; actor: string; action: string; detail: Record<string, unknown>; createdAt: number }> {
    return (this.db.prepare('SELECT * FROM trader_ops_log ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      detail: parseJson(r.detail, {}),
      createdAt: r.created_at,
    }));
  }

  lastOp(action: string): number | null {
    const r = this.db.prepare('SELECT MAX(created_at) AS t FROM trader_ops_log WHERE action = ?').get(action) as { t: number | null };
    return r.t ?? null;
  }
}
