// Model registry persistence + shadow comparison records.

import type { Database } from 'better-sqlite3';
import type { ModelDto, ModelMetricsDto, ModelStatus, ShadowEvalDto, Timeframe } from '@shared/trader/types';
import { num, parseJson, uid, type Row } from './util';

export interface ModelInsert {
  version: string;
  timeframe: Timeframe;
  horizonBars: number;
  kind: 'full' | 'incremental';
  parentVersion: string | null;
  status: ModelStatus;
  trainedAt: number;
  datasetId: string;
  featureSet: string;
  metrics: ModelMetricsDto;
  hash: string;
  blob: string;
  notes?: string;
}

export interface ModelRecord extends ModelDto {
  blob: string;
}

export class ModelsRepo {
  constructor(private readonly db: Database) {}

  insert(m: ModelInsert): ModelRecord {
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO trader_models (id, version, timeframe, horizon_bars, kind, parent_version, status, trained_at, dataset_id,
           feature_set, auc, sharpe, max_dd, metrics, hash, blob, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        m.version,
        m.timeframe,
        m.horizonBars,
        m.kind,
        m.parentVersion,
        m.status,
        m.trainedAt,
        m.datasetId,
        m.featureSet,
        m.metrics.auc,
        m.metrics.sharpe,
        m.metrics.maxDrawdownPct,
        JSON.stringify(m.metrics),
        m.hash,
        m.blob,
        m.notes ?? '',
      );
    return this.get(m.version)!;
  }

  get(version: string): ModelRecord | null {
    const r = this.db.prepare('SELECT * FROM trader_models WHERE version = ?').get(version) as Row | undefined;
    return r ? this.map(r) : null;
  }

  list(opts: { timeframe?: Timeframe; status?: ModelStatus[]; limit?: number } = {}): ModelRecord[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.timeframe) {
      where.push('timeframe = ?');
      args.push(opts.timeframe);
    }
    if (opts.status?.length) {
      where.push(`status IN (${opts.status.map(() => '?').join(',')})`);
      args.push(...opts.status);
    }
    const sql = `SELECT * FROM trader_models ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY trained_at DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, opts.limit ?? 100) as Row[]).map((r) => this.map(r));
  }

  active(timeframe: Timeframe): ModelRecord | null {
    const r = this.db
      .prepare("SELECT * FROM trader_models WHERE timeframe = ? AND status = 'active' ORDER BY promoted_at DESC LIMIT 1")
      .get(timeframe) as Row | undefined;
    return r ? this.map(r) : null;
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM trader_models').get() as { n: number }).n;
  }

  /** Promote atomically: the previous active model of the timeframe retires. */
  promote(version: string, now: number, note: string): ModelRecord | null {
    const m = this.get(version);
    if (!m) return null;
    this.db.transaction(() => {
      this.db
        .prepare("UPDATE trader_models SET status = 'retired', retired_at = ? WHERE timeframe = ? AND status = 'active' AND version != ?")
        .run(now, m.timeframe, version);
      this.db
        .prepare("UPDATE trader_models SET status = 'active', promoted_at = ?, notes = CASE WHEN notes = '' THEN ? ELSE notes || '\n' || ? END WHERE version = ?")
        .run(now, note, note, version);
    })();
    return this.get(version);
  }

  setStatus(version: string, status: ModelStatus, now: number, note?: string): void {
    this.db
      .prepare(
        `UPDATE trader_models SET status = ?, retired_at = CASE WHEN ? IN ('retired','rejected') THEN ? ELSE retired_at END,
           notes = CASE WHEN ? IS NULL THEN notes WHEN notes = '' THEN ? ELSE notes || '\n' || ? END
         WHERE version = ?`,
      )
      .run(status, status, now, note ?? null, note ?? null, note ?? null, version);
  }

  recordShadowEval(e: ShadowEvalDto, now: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO trader_shadow_evals (model_version, day, active_version, candidate_score, active_score, samples, passed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.modelVersion, e.day, e.activeVersion, e.candidateScore, e.activeScore, e.samples, e.passed ? 1 : 0, now);
  }

  shadowEvals(version?: string, limit = 60): ShadowEvalDto[] {
    const rows = version
      ? this.db.prepare('SELECT * FROM trader_shadow_evals WHERE model_version = ? ORDER BY day DESC LIMIT ?').all(version, limit)
      : this.db.prepare('SELECT * FROM trader_shadow_evals ORDER BY day DESC, model_version LIMIT ?').all(limit);
    return (rows as Row[]).map((r) => ({
      modelVersion: r.model_version,
      activeVersion: r.active_version ?? null,
      day: r.day,
      candidateScore: num(r.candidate_score),
      activeScore: num(r.active_score),
      samples: num(r.samples),
      passed: r.passed === 1,
    }));
  }

  /** Consecutive passing days, most recent first, stopping at the first failure. */
  shadowStreak(version: string): number {
    let streak = 0;
    for (const e of this.shadowEvals(version, 30)) {
      if (!e.passed) break;
      streak += 1;
    }
    return streak;
  }

  recordShadowScore(version: string, symbol: string, barTs: number, probUp: number, now: number): void {
    this.db
      .prepare('INSERT OR REPLACE INTO trader_shadow_scores (model_version, symbol, bar_ts, prob_up, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(version, symbol, barTs, probUp, now);
  }

  shadowScores(version: string, from: number, to: number): Array<{ symbol: string; barTs: number; probUp: number }> {
    return (
      this.db
        .prepare('SELECT symbol, bar_ts, prob_up FROM trader_shadow_scores WHERE model_version = ? AND bar_ts >= ? AND bar_ts < ? ORDER BY bar_ts')
        .all(version, from, to) as Row[]
    ).map((r) => ({ symbol: r.symbol, barTs: r.bar_ts, probUp: r.prob_up }));
  }

  pruneShadowScores(olderThan: number): void {
    this.db.prepare('DELETE FROM trader_shadow_scores WHERE created_at < ?').run(olderThan);
  }

  private map(r: Row): ModelRecord {
    const metrics = parseJson<ModelMetricsDto>(r.metrics, {} as ModelMetricsDto);
    return {
      id: r.id,
      version: r.version,
      timeframe: r.timeframe,
      horizonBars: r.horizon_bars,
      kind: r.kind === 'incremental' ? 'incremental' : 'full',
      parentVersion: r.parent_version ?? null,
      status: r.status,
      trainedAt: r.trained_at,
      datasetId: r.dataset_id,
      featureSet: r.feature_set,
      hash: r.hash,
      auc: num(r.auc),
      sharpe: num(r.sharpe),
      maxDrawdownPct: num(r.max_dd),
      metrics,
      shadowPassDays: this.shadowStreakFast(r.version),
      promotedAt: r.promoted_at ?? null,
      notes: r.notes ?? '',
      blob: r.blob,
    };
  }

  private shadowStreakFast(version: string): number {
    const rows = this.db
      .prepare('SELECT passed FROM trader_shadow_evals WHERE model_version = ? ORDER BY day DESC LIMIT 30')
      .all(version) as Array<{ passed: number }>;
    let s = 0;
    for (const r of rows) {
      if (r.passed !== 1) break;
      s += 1;
    }
    return s;
  }
}

/** DTO without the (large) serialized model. */
export function toModelDto(m: ModelRecord): ModelDto {
  const { blob: _blob, ...dto } = m;
  return dto;
}
