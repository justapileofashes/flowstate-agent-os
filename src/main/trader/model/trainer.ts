// Trainer: features → labelled set → chronological split (train / validation
// / test, never shuffled, purged so no label overlaps the next window) →
// GBDT with early stopping → purged walk-forward folds → refit → out-of-sample
// test metrics (AUC, log-loss, top-decile hit rate, strategy Sharpe/drawdown
// through the vectorized backtester) vs. heuristic baselines and the current
// incumbent. Incremental ("micro-update") runs warm-start the parent on recent
// data + the replay buffer and are evaluated only on bars the parent never saw.

import { assetClassOf, type ModelMetricsDto, type Timeframe, type TraderConfig } from '@shared/trader/types';
import type { Candle } from '../data/types';
import { hashCandles, datasetId, type DatasetManifest } from '../data/lake';
import { FeatureEngine, FEATURE_NAMES, sliceSet, vectorFromNamed, wrapFeatures, type LabeledSet } from '../features/engine';
import { BARS_PER_YEAR, FEATURE_SET_VERSION, LIMITS } from '../config';
import { runVectorized, type VecSeries, type VecSignal } from '../backtest/vectorized';
import { costModel } from '../backtest/fills';
import { importanceList, logLoss, modelHash, predictMany, trainGbdt, type GbdtModel } from './gbdt';
import { auc, mean, round, topDecileHitRate } from './metrics';
import type { ModelBlob, ModelMeta, Predictor } from './predictor';

export interface TrainRequest {
  timeframe: Timeframe;
  horizonBars: number;
  candles: Map<string, Candle[]>;
  config: TraderConfig;
  kind: 'full' | 'incremental';
  parent?: { version: string; blob: ModelBlob } | null;
  incumbent?: Predictor | null;
  replay?: Array<{ features: Record<string, number>; label: 0 | 1 }>;
  now: number;
  seed?: number;
  writeManifest?: (m: DatasetManifest) => string;
  onProgress?: (msg: string) => void;
}

export interface TrainResult {
  version: string;
  blob: ModelBlob;
  metrics: ModelMetricsDto;
  datasetId: string;
  hash: string;
}

export class InsufficientDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientDataError';
  }
}

function quantileTs(ts: number[], q: number): number {
  const uniq = [...new Set(ts)].sort((a, b) => a - b);
  return uniq[Math.min(uniq.length - 1, Math.max(0, Math.floor(q * uniq.length)))]!;
}

function indices(set: LabeledSet, pred: (i: number) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < set.ts.length; i++) if (pred(i)) out.push(i);
  return out;
}

function moveAtr(set: LabeledSet): { upAtr: number; downAtr: number; upPct: number; downPct: number } {
  const ups: number[] = [];
  const downs: number[] = [];
  const upsPct: number[] = [];
  const downsPct: number[] = [];
  for (let i = 0; i < set.ret.length; i++) {
    const a = set.atrPct[i]!;
    if (!(a > 0)) continue;
    if (set.ret[i]! > 0) {
      ups.push(set.ret[i]! / a);
      upsPct.push(set.ret[i]!);
    } else {
      downs.push(-set.ret[i]! / a);
      downsPct.push(-set.ret[i]!);
    }
  }
  return { upAtr: mean(ups) || 1, downAtr: mean(downs) || 1, upPct: mean(upsPct), downPct: mean(downsPct) };
}

/** Vectorized evaluation of a probability vector over a labelled window. */
export function evaluateStrategy(
  set: LabeledSet,
  probs: number[],
  candles: Map<string, Candle[]>,
  config: TraderConfig,
  meta: { upAtr: number; downAtr: number; horizonBars: number },
  periodsPerYear: number,
  from: number,
): ReturnType<typeof runVectorized> {
  const bySymbol = new Map<string, VecSignal[]>();
  const idx = new Map<string, Map<number, number>>();
  for (const [s, c] of candles) {
    const m = new Map<number, number>();
    c.forEach((k, i) => m.set(k.ts, i));
    idx.set(s, m);
  }
  const threshold = config.signals.confidenceThreshold;
  for (let r = 0; r < set.ts.length; r++) {
    const p = probs[r]!;
    const side = p >= 0.5 ? 'long' : 'short';
    if (side === 'short' && !config.risk.allowShort) continue;
    const conf = side === 'long' ? p : 1 - p;
    if (conf < threshold) continue;
    const atrPct = set.atrPct[r]!;
    const up = meta.upAtr * atrPct;
    const down = meta.downAtr * atrPct;
    const edge = side === 'long' ? p * up - (1 - p) * down : (1 - p) * down - p * up;
    if (edge < config.signals.minEdgePct) continue;
    const i = idx.get(set.symbol[r]!)?.get(set.ts[r]!);
    if (i === undefined) continue;
    const list = bySymbol.get(set.symbol[r]!) ?? [];
    list.push({ i, side, holdBars: meta.horizonBars, stopPct: config.risk.stopAtrMult * atrPct });
    bySymbol.set(set.symbol[r]!, list);
  }
  const series: VecSeries[] = [...candles.entries()].map(([symbol, c]) => ({ symbol, candles: c, signals: bySymbol.get(symbol) ?? [] }));
  return runVectorized({
    series,
    startEquity: 100_000,
    positionPct: config.risk.maxPositionPct,
    costs: costModel(config.execution),
    periodsPerYear,
    from,
  });
}

/** Heuristic baselines on the same window: equal-weight buy & hold, and a trend/momentum rule. */
export function baselines(
  set: LabeledSet,
  candles: Map<string, Candle[]>,
  config: TraderConfig,
  horizonBars: number,
  periodsPerYear: number,
  from: number,
): Array<{ name: string; sharpe: number; totalReturnPct: number }> {
  const costs = costModel(config.execution);
  const symbols = [...candles.keys()];
  const bh: VecSeries[] = symbols.map((symbol) => {
    const c = candles.get(symbol)!;
    const first = c.findIndex((k) => k.ts >= from);
    return { symbol, candles: c, signals: first > 0 ? [{ i: first - 1, side: 'long' as const, holdBars: c.length - first }] : [] };
  });
  const buyHold = runVectorized({ series: bh, startEquity: 100_000, positionPct: 100 / Math.max(1, symbols.length), costs, periodsPerYear, from });

  const rocIdx = FEATURE_NAMES.indexOf('roc_15');
  const trendIdx = FEATURE_NAMES.indexOf('regime_trend');
  const bySymbol = new Map<string, VecSignal[]>();
  const idx = new Map<string, Map<number, number>>();
  for (const [s, c] of candles) {
    const m = new Map<number, number>();
    c.forEach((k, i) => m.set(k.ts, i));
    idx.set(s, m);
  }
  for (let r = 0; r < set.ts.length; r++) {
    const x = set.X[r]!;
    if (!(x[rocIdx]! > 0 && x[trendIdx]! >= 0)) continue;
    const i = idx.get(set.symbol[r]!)?.get(set.ts[r]!);
    if (i === undefined) continue;
    const list = bySymbol.get(set.symbol[r]!) ?? [];
    list.push({ i, side: 'long', holdBars: horizonBars });
    bySymbol.set(set.symbol[r]!, list);
  }
  const momentum = runVectorized({
    series: symbols.map((symbol) => ({ symbol, candles: candles.get(symbol)!, signals: bySymbol.get(symbol) ?? [] })),
    startEquity: 100_000,
    positionPct: config.risk.maxPositionPct,
    costs,
    periodsPerYear,
    from,
  });
  return [
    { name: 'buy & hold (equal weight)', sharpe: round(buyHold.metrics.sharpe, 3), totalReturnPct: round(buyHold.metrics.totalReturnPct, 3) },
    { name: 'momentum rule (ROC15 > 0, trend ≥ 0)', sharpe: round(momentum.metrics.sharpe, 3), totalReturnPct: round(momentum.metrics.totalReturnPct, 3) },
  ];
}

function versionFor(tf: Timeframe, h: number, now: number, hash: string): string {
  const d = new Date(now);
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${tf}-h${h}-${stamp}-${hash.slice(0, 6)}`;
}

export async function trainModel(req: TrainRequest): Promise<TrainResult> {
  const { timeframe: tf, horizonBars: h, config } = req;
  const progress = req.onProgress ?? (() => undefined);
  const engine = new FeatureEngine();
  const symbols = [...req.candles.keys()].sort();
  const frames = symbols.map((s) => engine.compute(s, tf, req.candles.get(s)!));
  const set = wrapFeatures(frames, req.candles, [h]).get(h)!;
  if (set.X.length < LIMITS.minTrainRows) {
    throw new InsufficientDataError(`only ${set.X.length} labelled rows for ${tf} (need ${LIMITS.minTrainRows}); backfill more history first`);
  }
  const assetClass = symbols.every((s) => assetClassOf(s) === 'crypto') ? 'crypto' : 'us_equity';
  const ppy = BARS_PER_YEAR[assetClass][tf];
  const params = config.models.gbdt;
  const seed = req.seed ?? 7;
  const reasons: string[] = [];

  // ── chronological split with purging ─────────────────────────────────────
  let testStart = quantileTs(set.ts, 0.8);
  if (req.kind === 'incremental' && req.parent) {
    // Only bars the parent never saw count as out-of-sample.
    testStart = Math.max(testStart, req.parent.blob.meta.dataEnd + 1);
  }
  const valStart = quantileTs(set.ts.filter((t) => t < testStart), 0.75);
  const trainIdx = indices(set, (i) => set.ts[i]! < valStart && set.labelTs[i]! < valStart);
  const valIdx = indices(set, (i) => set.ts[i]! >= valStart && set.ts[i]! < testStart && set.labelTs[i]! < testStart);
  const fitIdx = indices(set, (i) => set.ts[i]! < testStart && set.labelTs[i]! < testStart);
  const testIdx = indices(set, (i) => set.ts[i]! >= testStart);
  if (trainIdx.length < 100 || valIdx.length < 30) throw new InsufficientDataError(`split too small (train ${trainIdx.length}, validation ${valIdx.length})`);
  const train = sliceSet(set, trainIdx);
  const val = sliceSet(set, valIdx);
  const fit = sliceSet(set, fitIdx);
  const test = sliceSet(set, testIdx);
  if (test.X.length < 50) reasons.push(`only ${test.X.length} out-of-sample rows — metrics are weak evidence`);

  let model: GbdtModel;
  let bestTrees: number;
  const walkForward: ModelMetricsDto['walkForward'] = [];

  if (req.kind === 'incremental' && req.parent) {
    progress('warm-starting parent on recent data + replay buffer');
    const parent = req.parent.blob.gbdt;
    const recentIdx = indices(fit, (i) => fit.ts[i]! > req.parent!.blob.meta.dataEnd - 14 * 86_400_000);
    const recent = sliceSet(fit, recentIdx.length >= 50 ? recentIdx : indices(fit, () => true));
    const X = [...recent.X];
    const y = [...recent.y];
    for (const r of req.replay ?? []) {
      const v = vectorFromNamed(r.features);
      if (v) {
        X.push(v);
        y.push(r.label);
      }
    }
    model = await trainGbdt(X, y, { params, featureNames: [...FEATURE_NAMES], seed, trees: Math.max(10, Math.round(params.trees / 6)), continueFrom: parent });
    bestTrees = model.trees.length;
  } else {
    progress(`training on ${train.X.length} rows, validating on ${val.X.length}`);
    const probe = await trainGbdt(train.X, train.y, {
      params,
      featureNames: [...FEATURE_NAMES],
      seed,
      validation: { X: val.X, y: val.y },
      earlyStoppingRounds: 20,
    });
    bestTrees = Math.max(10, probe.trees.length);

    // Purged, expanding walk-forward folds over the fit region.
    const cuts = [0.5, 0.625, 0.75, 0.875, 1].map((q) => (q >= 1 ? testStart : quantileTs(fit.ts, q)));
    for (let k = 0; k < cuts.length - 1; k++) {
      const a = cuts[k]!;
      const b = cuts[k + 1]!;
      const trI = indices(fit, (i) => fit.labelTs[i]! < a);
      const vaI = indices(fit, (i) => fit.ts[i]! >= a && fit.ts[i]! < b);
      if (trI.length < 100 || vaI.length < 20) continue;
      const tr = sliceSet(fit, trI);
      const va = sliceSet(fit, vaI);
      const m = await trainGbdt(tr.X, tr.y, { params, featureNames: [...FEATURE_NAMES], seed: seed + k + 1, trees: bestTrees });
      const p = predictMany(m, va.X);
      const mv = moveAtr(tr);
      const bt = evaluateStrategy(va, p, req.candles, config, { ...mv, horizonBars: h }, ppy, a);
      walkForward.push({ fold: k + 1, from: a, to: b, auc: round(auc(va.y, p), 4), sharpe: round(bt.metrics.sharpe, 3) });
      progress(`walk-forward fold ${k + 1}: AUC ${auc(va.y, p).toFixed(3)}`);
    }
    progress(`refitting on ${fit.X.length} rows with ${bestTrees} trees`);
    model = await trainGbdt(fit.X, fit.y, { params, featureNames: [...FEATURE_NAMES], seed, trees: bestTrees });
  }

  // ── out-of-sample test ───────────────────────────────────────────────────
  const moves = moveAtr(fit);
  const meta: ModelMeta = {
    timeframe: tf,
    horizonBars: h,
    featureSet: FEATURE_SET_VERSION,
    upAtr: moves.upAtr,
    downAtr: moves.downAtr,
    dataEnd: fit.labelTs.reduce((a, b) => (b > a ? b : a), req.parent?.blob.meta.dataEnd ?? 0),
  };
  const pTest = test.X.length ? predictMany(model, test.X) : [];
  const bt = test.X.length
    ? evaluateStrategy(test, pTest, req.candles, config, { ...moves, horizonBars: h }, ppy, testStart)
    : null;
  const base = test.X.length ? baselines(test, req.candles, config, h, ppy, testStart) : [];
  let incumbent: ModelMetricsDto['incumbent'] = null;
  if (req.incumbent && test.X.length) {
    const pInc = test.X.map((x) => req.incumbent!.probUp(x));
    const incBt = evaluateStrategy(test, pInc, req.candles, config, { upAtr: req.incumbent.meta.upAtr, downAtr: req.incumbent.meta.downAtr, horizonBars: h }, ppy, testStart);
    incumbent = { version: req.incumbent.version, auc: round(auc(test.y, pInc), 4), sharpe: round(incBt.metrics.sharpe, 3) };
  }

  const testAuc = test.X.length ? auc(test.y, pTest) : 0.5;
  const sharpeVal = bt?.metrics.sharpe ?? 0;
  const trades = bt?.metrics.trades ?? 0;
  const bestBaseline = base.length ? Math.max(...base.map((b) => b.sharpe)) : 0;
  let passed = true;
  if (testAuc < config.models.minAuc) {
    passed = false;
    reasons.push(`test AUC ${testAuc.toFixed(3)} < ${config.models.minAuc}`);
  }
  if (trades < 5) {
    passed = false;
    reasons.push(`only ${trades} simulated trades on the test window (need ≥ 5)`);
  }
  if (!(sharpeVal > 0)) {
    passed = false;
    reasons.push(`test Sharpe ${sharpeVal.toFixed(2)} ≤ 0`);
  }
  if (sharpeVal <= bestBaseline) {
    passed = false;
    reasons.push(`test Sharpe ${sharpeVal.toFixed(2)} does not beat the best baseline (${bestBaseline.toFixed(2)})`);
  }
  if (incumbent && (sharpeVal <= incumbent.sharpe || testAuc < incumbent.auc)) {
    passed = false;
    reasons.push(`does not beat incumbent ${incumbent.version} on the latest window (Sharpe ${incumbent.sharpe.toFixed(2)}, AUC ${incumbent.auc.toFixed(3)})`);
  }
  if (passed) reasons.push('beats baselines' + (incumbent ? ' and the incumbent' : '') + ' out-of-sample');

  const metrics: ModelMetricsDto = {
    auc: round(testAuc, 4),
    logLoss: round(test.X.length ? logLoss(test.y, pTest) : 0, 4),
    hitRateTopDecile: round(test.X.length ? topDecileHitRate(test.y, pTest) : 0, 4),
    baseRate: round(test.y.length ? mean(test.y) : 0, 4),
    sharpe: round(sharpeVal, 3),
    maxDrawdownPct: round(bt?.metrics.maxDrawdownPct ?? 0, 3),
    totalReturnPct: round(bt?.metrics.totalReturnPct ?? 0, 3),
    trades,
    winRate: round(bt?.metrics.winRate ?? 0, 4),
    baselines: base,
    walkForward,
    rows: { train: train.X.length, validation: val.X.length, test: test.X.length },
    importances: importanceList(model).slice(0, 12),
    upMovePct: round(moves.upPct, 4),
    downMovePct: round(moves.downPct, 4),
    incumbent,
    passed,
    reasons,
    testFrom: test.ts[0] ?? null,
    testTo: test.ts[test.ts.length - 1] ?? null,
  };

  const manifest: DatasetManifest = {
    timeframe: tf,
    featureSet: FEATURE_SET_VERSION,
    horizonBars: h,
    symbols: symbols.map((s) => {
      const c = req.candles.get(s)!;
      return { symbol: s, from: c[0]?.ts ?? 0, to: c[c.length - 1]?.ts ?? 0, bars: c.length, sha256: hashCandles(c) };
    }),
  };
  const dsId = req.writeManifest ? req.writeManifest(manifest) : datasetId(manifest);
  const blob: ModelBlob = { gbdt: model, meta };
  const hash = modelHash(model);
  return { version: versionFor(tf, h, req.now, hash), blob, metrics, datasetId: dsId, hash };
}
