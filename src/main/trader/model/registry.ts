// Model registry + promotion policy. Only a model with status 'active' scores
// live signals. Promotion paths:
//   - first model of a timeframe: straight to active if it passed the bar at
//     training time (beats baselines out-of-sample, AUC ≥ minAuc);
//   - later models: 'shadow' — scored every tick next to the incumbent but
//     never traded — and auto-promoted once they beat the incumbent on the
//     latest window AND win `shadowDays` consecutive daily shadow comparisons;
//     three failed days (or 10 days without qualifying) reject them;
//   - manual promotion by the user (typed confirmation, paper mode only).

import { TIMEFRAME_MS, type ModelStatus, type ShadowEvalDto, type Timeframe, type TraderConfig, type ModelSpec } from '@shared/trader/types';
import type { TraderDb } from '../db';
import type { ModelRecord } from '../db/models';
import type { Candle } from '../data/types';
import type { DatasetManifest } from '../data/lake';
import { logLoss } from './gbdt';
import { Predictor, type ModelBlob } from './predictor';
import { trainModel, type TrainResult } from './trainer';

export interface RegistryDeps {
  db: TraderDb;
  config: () => TraderConfig;
  now: () => number;
  writeManifest?: (m: DatasetManifest) => string;
  onEvent?: (e: { kind: 'promoted' | 'shadow' | 'rejected' | 'trained'; version: string; timeframe: Timeframe; detail: string }) => void;
}

export type TrainAction = 'promoted' | 'shadow' | 'rejected';

export class ModelRegistry {
  private readonly cache = new Map<string, Predictor>();
  private training = new Set<string>();

  constructor(private readonly deps: RegistryDeps) {}

  predictor(m: ModelRecord): Predictor {
    let p = this.cache.get(m.version);
    if (!p) {
      p = new Predictor(m.version, m.hash, m.blob);
      this.cache.set(m.version, p);
    }
    return p;
  }

  /** Active predictor per enabled timeframe. */
  active(): Map<Timeframe, Predictor> {
    const out = new Map<Timeframe, Predictor>();
    for (const spec of this.deps.config().models.specs) {
      if (!spec.enabled) continue;
      const m = this.deps.db.models.active(spec.timeframe);
      if (m) out.set(spec.timeframe, this.predictor(m));
    }
    return out;
  }

  shadows(): Predictor[] {
    return this.deps.db.models.list({ status: ['shadow'] }).map((m) => this.predictor(m));
  }

  isTraining(timeframe: Timeframe): boolean {
    return this.training.has(timeframe);
  }

  loadCandles(timeframe: Timeframe, symbols: string[], lookbackDays: number): Map<string, Candle[]> {
    const from = this.deps.now() - lookbackDays * 86_400_000;
    const out = new Map<string, Candle[]>();
    for (const s of symbols) {
      const c = this.deps.db.market.bars(s, timeframe, { from });
      if (c.length) out.set(s, c);
    }
    return out;
  }

  async train(
    spec: Pick<ModelSpec, 'timeframe' | 'horizonBars'>,
    symbols: string[],
    kind: 'full' | 'incremental' = 'full',
    onProgress?: (msg: string) => void,
  ): Promise<{ model: ModelRecord; action: TrainAction }> {
    const cfg = this.deps.config();
    if (this.training.has(spec.timeframe)) throw new Error(`a ${spec.timeframe} model is already training`);
    this.training.add(spec.timeframe);
    try {
      const candles = this.loadCandles(spec.timeframe, symbols, cfg.models.lookbackDays);
      const activeRec = this.deps.db.models.active(spec.timeframe);
      const parent = kind === 'incremental' ? activeRec : null;
      if (kind === 'incremental' && !parent) throw new Error(`no active ${spec.timeframe} model to update — run a full retrain first`);
      const now = this.deps.now();
      const result: TrainResult = await trainModel({
        timeframe: spec.timeframe,
        horizonBars: parent?.horizonBars ?? spec.horizonBars,
        candles,
        config: cfg,
        kind,
        parent: parent ? { version: parent.version, blob: JSON.parse(parent.blob) as ModelBlob } : null,
        incumbent: activeRec ? this.predictor(activeRec) : null,
        replay: kind === 'incremental' ? this.deps.db.runs.replay({ timeframe: spec.timeframe, since: now - 30 * 86_400_000 }) : [],
        now,
        ...(this.deps.writeManifest ? { writeManifest: this.deps.writeManifest } : {}),
        ...(onProgress ? { onProgress } : {}),
      });
      // Same data + same minute → same hash-based version: keep versions unique.
      if (this.deps.db.models.get(result.version)) {
        let n = 2;
        while (this.deps.db.models.get(`${result.version}.${n}`)) n += 1;
        result.version = `${result.version}.${n}`;
      }
      let status: ModelStatus = 'candidate';
      let action: TrainAction;
      if (!result.metrics.passed) {
        status = 'rejected';
        action = 'rejected';
      } else if (!activeRec && cfg.models.autoPromote) {
        status = 'candidate';
        action = 'promoted';
      } else {
        status = 'shadow';
        action = 'shadow';
      }
      this.deps.db.models.insert({
        version: result.version,
        timeframe: spec.timeframe,
        horizonBars: parent?.horizonBars ?? spec.horizonBars,
        kind,
        parentVersion: parent?.version ?? null,
        status,
        trainedAt: now,
        datasetId: result.datasetId,
        featureSet: result.blob.meta.featureSet,
        metrics: result.metrics,
        hash: result.hash,
        blob: JSON.stringify(result.blob),
        notes: result.metrics.reasons.join('; '),
      });
      this.deps.onEvent?.({ kind: 'trained', version: result.version, timeframe: spec.timeframe, detail: result.metrics.reasons.join('; ') });
      if (action === 'promoted') {
        this.promote(result.version, 'auto', 'first model for this timeframe; beat the baselines out-of-sample');
      } else {
        this.deps.onEvent?.({ kind: action, version: result.version, timeframe: spec.timeframe, detail: result.metrics.reasons.join('; ') });
      }
      return { model: this.deps.db.models.get(result.version)!, action };
    } finally {
      this.training.delete(spec.timeframe);
    }
  }

  promote(version: string, by: 'auto' | 'user', note: string): ModelRecord | null {
    const m = this.deps.db.models.promote(version, this.deps.now(), `${by === 'auto' ? 'auto-promoted' : 'promoted by user'}: ${note}`);
    if (m) this.deps.onEvent?.({ kind: 'promoted', version, timeframe: m.timeframe, detail: note });
    return m;
  }

  reject(version: string, reason: string): void {
    this.deps.db.models.setStatus(version, 'rejected', this.deps.now(), reason);
    const m = this.deps.db.models.get(version);
    if (m) this.deps.onEvent?.({ kind: 'rejected', version, timeframe: m.timeframe, detail: reason });
  }

  /** Record live scores for the active + shadow models of a timeframe (shadow comparison input). */
  recordScores(timeframe: Timeframe, symbol: string, barTs: number, x: number[]): void {
    const now = this.deps.now();
    const active = this.deps.db.models.active(timeframe);
    const shadows = this.deps.db.models.list({ timeframe, status: ['shadow'] });
    if (!shadows.length || !active) return;
    for (const m of [active, ...shadows]) {
      this.deps.db.models.recordShadowScore(m.version, symbol, barTs, this.predictor(m).probUp(x), now);
    }
  }

  /**
   * Daily shadow comparison: realized labels for the day's scored bars; the
   * candidate passes the day when its log-loss beats the incumbent's on the
   * same samples (≥ 20 of them).
   */
  evaluateShadowDay(dayStart: number, dayEnd: number, day: string): ShadowEvalDto[] {
    const out: ShadowEvalDto[] = [];
    const now = this.deps.now();
    for (const cand of this.deps.db.models.list({ status: ['shadow'] })) {
      const active = this.deps.db.models.active(cand.timeframe);
      if (!active) continue;
      const cs = this.deps.db.models.shadowScores(cand.version, dayStart, dayEnd);
      const as = new Map(this.deps.db.models.shadowScores(active.version, dayStart, dayEnd).map((s) => [`${s.symbol}|${s.barTs}`, s.probUp]));
      const y: number[] = [];
      const pc: number[] = [];
      const pa: number[] = [];
      const labelCache = new Map<string, Candle[]>();
      for (const s of cs) {
        const pA = as.get(`${s.symbol}|${s.barTs}`);
        if (pA === undefined) continue;
        let bars = labelCache.get(s.symbol);
        if (!bars) {
          bars = this.deps.db.market.bars(s.symbol, cand.timeframe, { from: dayStart - TIMEFRAME_MS[cand.timeframe] });
          labelCache.set(s.symbol, bars);
        }
        const i = bars.findIndex((b) => b.ts === s.barTs);
        if (i < 0 || i + cand.horizonBars >= bars.length) continue; // label not known yet
        y.push(bars[i + cand.horizonBars]!.close > bars[i]!.close ? 1 : 0);
        pc.push(s.probUp);
        pa.push(pA);
      }
      const candidateScore = y.length ? -logLoss(y, pc) : 0;
      const activeScore = y.length ? -logLoss(y, pa) : 0;
      const e: ShadowEvalDto = {
        modelVersion: cand.version,
        activeVersion: active.version,
        day,
        candidateScore: Math.round(candidateScore * 10_000) / 10_000,
        activeScore: Math.round(activeScore * 10_000) / 10_000,
        samples: y.length,
        passed: y.length >= 20 && candidateScore > activeScore,
      };
      if (y.length > 0) {
        this.deps.db.models.recordShadowEval(e, now);
        out.push(e);
      }
    }
    return out;
  }

  /** Promote qualified shadows, reject failing/stale ones. */
  applyPolicy(): Array<{ version: string; action: 'promoted' | 'rejected'; reason: string }> {
    const cfg = this.deps.config();
    const now = this.deps.now();
    const actions: Array<{ version: string; action: 'promoted' | 'rejected'; reason: string }> = [];
    for (const m of this.deps.db.models.list({ status: ['shadow'] })) {
      const evals = this.deps.db.models.shadowEvals(m.version, 30);
      const streak = this.deps.db.models.shadowStreak(m.version);
      let failStreak = 0;
      for (const e of evals) {
        if (e.passed) break;
        failStreak += 1;
      }
      if (cfg.models.autoPromote && m.metrics.passed && streak >= cfg.models.shadowDays) {
        const reason = `won ${streak} consecutive shadow days and beat the incumbent on the latest window`;
        this.promote(m.version, 'auto', reason);
        actions.push({ version: m.version, action: 'promoted', reason });
      } else if (failStreak >= 3) {
        const reason = `lost ${failStreak} consecutive shadow days — reverted to the incumbent`;
        this.reject(m.version, reason);
        actions.push({ version: m.version, action: 'rejected', reason });
      } else if (now - m.trainedAt > 10 * 86_400_000) {
        const reason = 'did not qualify within 10 days of shadowing';
        this.reject(m.version, reason);
        actions.push({ version: m.version, action: 'rejected', reason });
      }
    }
    return actions;
  }
}
