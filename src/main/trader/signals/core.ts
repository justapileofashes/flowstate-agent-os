// The quant decision core — one pure function shared by the live Quant node,
// Simulation Mode and the event-driven backtester (Trade Ideas: "the exact
// same logic"). Per-timeframe model probabilities are fused (weighted
// log-odds, optional agreement), gated by confidence and expected edge, then
// matched against the active strategies to produce a SignalProposal with
// ATR-based stop/take-profit and a holding period.

import { TIMEFRAME_MS, type StrategyDto, type Timeframe, type TraderConfig } from '@shared/trader/types';
import type { SignalProposal } from '../types';

export interface TimeframeScore {
  timeframe: Timeframe;
  probUp: number;
  modelVersion: string;
  modelHash: string;
  horizonBars: number;
  upAtr: number;
  downAtr: number;
}

export interface BaseBar {
  timeframe: Timeframe;
  barTs: number;
  close: number;
  atr: number;
  regime: string;
  features: Record<string, number>;
  drivers: string;
}

export interface Decision {
  proposal: SignalProposal | null;
  /** Why no proposal (gating, disagreement, no strategy). */
  reason: string;
  probUp: number;
  confidence: number;
  edgePct: number;
  side: 'long' | 'short';
}

const logit = (p: number): number => Math.log(Math.min(0.999999, Math.max(1e-6, p)) / (1 - Math.min(0.999999, Math.max(1e-6, p))));
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

export function fuseScores(scores: TimeframeScore[], weights: Partial<Record<Timeframe, number>>, requireAgreement: boolean): { probUp: number; agree: boolean } {
  if (!scores.length) return { probUp: 0.5, agree: false };
  let num = 0;
  let den = 0;
  for (const s of scores) {
    const w = weights[s.timeframe] ?? 1;
    num += w * logit(s.probUp);
    den += w;
  }
  const probUp = den > 0 ? sigmoid(num / den) : 0.5;
  const up = probUp >= 0.5;
  const agree = !requireAgreement || scores.every((s) => (s.probUp >= 0.5) === up);
  return { probUp, agree };
}

function strategyMatches(s: StrategyDto, side: 'long' | 'short', confidence: number, base: BaseBar): { ok: boolean; why: string } {
  const p = s.params;
  if (p.timeframes.length && !p.timeframes.includes(base.timeframe)) return { ok: false, why: `${s.name}: timeframe ${base.timeframe} not in [${p.timeframes.join(',')}]` };
  if (!p.sides.includes(side)) return { ok: false, why: `${s.name}: ${side} not allowed` };
  if (confidence < p.minConfidence) return { ok: false, why: `${s.name}: confidence ${confidence.toFixed(2)} < ${p.minConfidence}` };
  if (p.regimes.length && !p.regimes.some((r) => base.regime.split('/').includes(r) || base.regime === r)) {
    return { ok: false, why: `${s.name}: regime ${base.regime} not in [${p.regimes.join(',')}]` };
  }
  for (const f of p.featureFilters) {
    const v = base.features[f.feature];
    if (v === undefined || !Number.isFinite(v)) return { ok: false, why: `${s.name}: feature ${f.feature} unavailable` };
    const ok = f.op === '>' ? v > f.value : f.op === '>=' ? v >= f.value : f.op === '<' ? v < f.value : v <= f.value;
    if (!ok) return { ok: false, why: `${s.name}: ${f.feature} ${v.toFixed(2)} not ${f.op} ${f.value}` };
  }
  return { ok: true, why: `${s.name}: all filters met` };
}

export function decide(input: {
  symbol: string;
  scores: TimeframeScore[];
  base: BaseBar;
  config: TraderConfig;
  strategies: StrategyDto[];
}): Decision {
  const { config, base, symbol } = input;
  const sc = config.signals;
  const { probUp, agree } = fuseScores(input.scores, sc.timeframeWeights, sc.requireAgreement);
  const side: 'long' | 'short' = probUp >= 0.5 ? 'long' : 'short';
  const confidence = side === 'long' ? probUp : 1 - probUp;
  const baseScore = input.scores.find((s) => s.timeframe === base.timeframe) ?? input.scores[0];
  const atrPct = base.close > 0 ? (base.atr / base.close) * 100 : 0;
  const up = (baseScore?.upAtr ?? 1) * atrPct;
  const down = (baseScore?.downAtr ?? 1) * atrPct;
  const edgePct = side === 'long' ? probUp * up - (1 - probUp) * down : (1 - probUp) * down - probUp * up;
  const none = (reason: string): Decision => ({ proposal: null, reason, probUp, confidence, edgePct, side });

  if (!input.scores.length || !baseScore) return none('no active model for this symbol/timeframe');
  if (!agree) return none(`timeframes disagree (${input.scores.map((s) => `${s.timeframe} ${s.probUp.toFixed(2)}`).join(', ')})`);
  const threshold = sc.perSymbolThreshold[symbol] ?? sc.confidenceThreshold;
  if (confidence < threshold) return none(`confidence ${confidence.toFixed(3)} < threshold ${threshold}`);
  if (edgePct < sc.minEdgePct) return none(`expected edge ${edgePct.toFixed(3)}% < minimum ${sc.minEdgePct}%`);
  if (side === 'short' && !config.risk.allowShort) return none('short signal but shorting is disabled');

  const active = input.strategies.filter((s) => s.status === 'active');
  let strategy: StrategyDto | null = null;
  const misses: string[] = [];
  for (const s of active) {
    const m = strategyMatches(s, side, confidence, base);
    if (m.ok) {
      strategy = s;
      break;
    }
    misses.push(m.why);
  }
  if (active.length && !strategy) return none(`no strategy matched (${misses.join(' | ')})`);

  const dir = side === 'long' ? 1 : -1;
  const stopMult = strategy?.params.stopAtrMult ?? config.risk.stopAtrMult;
  const tpMult = strategy?.params.takeProfitAtrMult ?? config.risk.takeProfitAtrMult;
  const atr = base.atr > 0 ? base.atr : base.close * 0.01;
  const horizonBars = baseScore.horizonBars;
  const maxHoldBars = strategy?.params.maxHoldBars ?? Math.round(horizonBars * config.execution.maxHoldBarsMult);
  const fused = input.scores.length > 1;
  return {
    probUp,
    confidence,
    edgePct,
    side,
    reason: 'signal',
    proposal: {
      symbol,
      side,
      timeframe: fused ? 'fused' : base.timeframe,
      baseTimeframe: base.timeframe,
      entry: base.close,
      stop: base.close - dir * stopMult * atr,
      takeProfit: base.close + dir * tpMult * atr,
      confidence,
      edgePct,
      horizonBars,
      horizonMin: Math.round((horizonBars * TIMEFRAME_MS[base.timeframe]) / 60_000),
      maxHoldBars,
      atr,
      regime: base.regime,
      barTs: base.barTs,
      modelVersion: baseScore.modelVersion,
      modelHash: baseScore.modelHash,
      strategyId: strategy?.id ?? null,
      strategyName: strategy?.name ?? null,
      perTimeframe: input.scores.map((s) => ({ timeframe: s.timeframe, probUp: Math.round(s.probUp * 10_000) / 10_000, modelVersion: s.modelVersion })),
      features: { ...base.features, regime: base.regime },
      source: 'model',
      drivers: base.drivers,
    },
  };
}

/** Deterministic rationale (used when the LLM is off, over budget, or fails). */
export function templateRationale(p: SignalProposal): string {
  const tfs = p.perTimeframe.map((t) => `${t.timeframe} ${(t.probUp * 100).toFixed(0)}% up`).join(', ');
  const rr = Math.abs(p.takeProfit - p.entry) / Math.max(1e-9, Math.abs(p.entry - p.stop));
  return (
    `${p.side === 'long' ? 'Long' : 'Short'} ${p.symbol}: ${(p.confidence * 100).toFixed(0)}% confidence over ~${p.horizonMin} min ` +
    `(${tfs}); expected edge ${p.edgePct.toFixed(2)}%. Regime ${p.regime}. ` +
    (p.drivers ? `Top drivers: ${p.drivers}. ` : '') +
    `Stop ${p.stop.toFixed(2)}, target ${p.takeProfit.toFixed(2)} (${rr.toFixed(1)}R)` +
    (p.strategyName ? `, strategy "${p.strategyName}".` : '.')
  );
}
