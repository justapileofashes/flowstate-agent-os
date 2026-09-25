// Backtest runner: builds the causal `decide` function (features → registered
// models → the live quant core) over stored bars and runs the vectorized or
// event-driven engine. Also powers Simulation Mode ("paper-simulate": today's
// strategy on today's bars) and the ShadowBacktester (candidate vs production
// on the same window, no orders).

import {
  assetClassOf,
  type BacktestMetricsDto,
  type BacktestReportDto,
  type BacktestTradeDto,
  type EquityPointDto,
  type StrategyDto,
  type Timeframe,
  type TraderConfig,
} from '@shared/trader/types';
import type { TraderDb } from '../db';
import type { Candle } from '../data/types';
import { barEnd } from '../data/calendar';
import { FeatureEngine, namedFeatures, type FeatureRowOut } from '../features/engine';
import type { Predictor } from '../model/predictor';
import { decide as coreDecide, type TimeframeScore } from '../signals/core';
import { RiskManager } from '../risk/manager';
import { BARS_PER_YEAR, LIMITS } from '../config';
import { runEventBacktest, type EventResult } from './event';
import { runVectorized, type VecSignal } from './vectorized';
import { costModel } from './fills';
import { writeReport } from './report';
import type { SignalProposal } from '../types';

export interface RunnerDeps {
  db: TraderDb;
  config: () => TraderConfig;
  strategies: () => StrategyDto[];
  reportsDir: string | null;
  now: () => number;
}

export interface BacktestRequest {
  kind: 'vectorized' | 'event' | 'simulation';
  label?: string;
  timeframe: Timeframe;
  symbols: string[];
  from: number;
  to: number;
  /** Predictors per timeframe (base timeframe required). */
  predictors: Map<Timeframe, Predictor>;
  startEquity?: number;
  /** Treat all bars as tradable (synthetic data). */
  ignoreSessions?: boolean;
  config?: TraderConfig;
}

interface Prepared {
  candles: Map<string, Candle[]>;
  decide: (symbol: string, index: number, ts: number) => { proposal: SignalProposal | null; reason: string };
}

export class BacktestRunner {
  constructor(private readonly deps: RunnerDeps) {}

  /** Features + per-timeframe probabilities, precomputed once; decide() is then O(log n). */
  prepare(req: BacktestRequest, config: TraderConfig): Prepared {
    const engine = new FeatureEngine();
    const candles = new Map<string, Candle[]>();
    const rowsByTf = new Map<Timeframe, Map<string, { rows: FeatureRowOut[]; ends: number[]; probs: number[] }>>();
    const strategies = this.deps.strategies();
    const tfs = [...req.predictors.keys()];
    if (!req.predictors.has(req.timeframe)) throw new Error(`no model for the base timeframe ${req.timeframe}`);
    for (const tf of tfs) {
      const perSymbol = new Map<string, { rows: FeatureRowOut[]; ends: number[]; probs: number[] }>();
      const pred = req.predictors.get(tf)!;
      for (const s of req.symbols) {
        const bars = this.deps.db.market.bars(s, tf, { from: req.from - warmupMs(tf), to: req.to });
        if (tf === req.timeframe) candles.set(s, bars);
        const frame = engine.compute(s, tf, bars);
        perSymbol.set(s, {
          rows: frame.rows,
          ends: frame.rows.map((r) => barEnd(r.ts, tf, assetClassOf(s))),
          probs: frame.rows.map((r) => pred.probUp(r.x)),
        });
      }
      rowsByTf.set(tf, perSymbol);
    }
    const base = rowsByTf.get(req.timeframe)!;
    const baseIndex = new Map<string, Map<number, number>>();
    for (const [s, v] of base) baseIndex.set(s, new Map(v.rows.map((r, k) => [r.ts, k])));

    const decide = (symbol: string, _i: number, ts: number): { proposal: SignalProposal | null; reason: string } => {
      const k = baseIndex.get(symbol)?.get(ts);
      if (k === undefined) return { proposal: null, reason: 'features not warm' };
      const b = base.get(symbol)!;
      const row = b.rows[k]!;
      const end = b.ends[k]!;
      const scores: TimeframeScore[] = [];
      for (const tf of tfs) {
        const pred = req.predictors.get(tf)!;
        let prob: number | undefined;
        if (tf === req.timeframe) prob = b.probs[k];
        else {
          const other = rowsByTf.get(tf)!.get(symbol);
          if (other) {
            // latest bar of the other timeframe that had closed by this bar's end
            let lo = 0;
            let hi = other.ends.length - 1;
            let found = -1;
            while (lo <= hi) {
              const mid = (lo + hi) >> 1;
              if (other.ends[mid]! <= end) {
                found = mid;
                lo = mid + 1;
              } else hi = mid - 1;
            }
            if (found >= 0) prob = other.probs[found];
          }
        }
        if (prob === undefined) continue;
        scores.push({ timeframe: tf, probUp: prob, modelVersion: pred.version, modelHash: pred.hash, horizonBars: pred.meta.horizonBars, upAtr: pred.meta.upAtr, downAtr: pred.meta.downAtr });
      }
      const basePred = req.predictors.get(req.timeframe)!;
      const d = coreDecide({
        symbol,
        scores,
        base: { timeframe: req.timeframe, barTs: row.ts, close: row.close, atr: row.atr, regime: row.regime, features: namedFeatures(row), drivers: '' },
        config,
        strategies,
      });
      if (d.proposal) d.proposal.drivers = basePred.drivers(row.x);
      return { proposal: d.proposal, reason: d.reason };
    };
    return { candles, decide };
  }

  run(req: BacktestRequest): { report: BacktestReportDto; result: EventResult | null } {
    const config = req.config ?? this.deps.config();
    const now = this.deps.now();
    const label = req.label ?? `${req.kind} ${req.timeframe} ${req.symbols.length} symbols`;
    const cfgSnapshot = {
      timeframe: req.timeframe,
      symbols: req.symbols,
      from: req.from,
      to: req.to,
      models: [...req.predictors.values()].map((p) => ({ version: p.version, hash: p.hash })),
      risk: config.risk,
      signals: config.signals,
      execution: config.execution,
    };
    const bt = this.deps.db.runs.createBacktest(req.kind, label, cfgSnapshot, now);
    try {
      const prep = this.prepare(req, config);
      const startEquity = req.startEquity ?? config.execution.paperStartingCash;
      let body: { config: Record<string, unknown>; trades: BacktestTradeDto[]; equity: EquityPointDto[]; rejected: BacktestReportDto['rejected']; metrics: BacktestMetricsDto };
      let result: EventResult | null = null;
      if (req.kind === 'vectorized') {
        const series = [...prep.candles.entries()].map(([symbol, c]) => {
          const signals: VecSignal[] = [];
          c.forEach((bar, i) => {
            if (bar.ts < req.from) return;
            const d = prep.decide(symbol, i, bar.ts);
            if (d.proposal) signals.push({ i, side: d.proposal.side, holdBars: Math.max(1, d.proposal.maxHoldBars), stopPct: (Math.abs(d.proposal.entry - d.proposal.stop) / d.proposal.entry) * 100 });
          });
          return { symbol, candles: c, signals };
        });
        const assetClass = req.symbols.every((s) => assetClassOf(s) === 'crypto') ? 'crypto' : 'us_equity';
        const v = runVectorized({ series, startEquity, positionPct: config.risk.maxPositionPct, costs: costModel(config.execution), periodsPerYear: BARS_PER_YEAR[assetClass][req.timeframe], from: req.from });
        body = { config: cfgSnapshot, trades: v.trades, equity: v.equity, rejected: [], metrics: v.metrics };
      } else {
        result = runEventBacktest({
          timeframe: req.timeframe,
          candles: prep.candles,
          decide: prep.decide,
          config,
          risk: new RiskManager(),
          startEquity,
          from: req.from,
          to: req.to,
          ...(req.ignoreSessions ? { ignoreSessions: true } : {}),
        });
        body = { config: cfgSnapshot, trades: result.trades, equity: result.equity, rejected: result.rejected.slice(0, 500), metrics: result.metrics };
      }
      let paths = { reportPath: null as string | null, equityPath: null as string | null };
      if (this.deps.reportsDir) {
        paths = writeReport(this.deps.reportsDir, {
          id: bt.id,
          kind: req.kind,
          label,
          config: cfgSnapshot,
          metrics: body.metrics,
          trades: body.trades,
          equity: body.equity,
          rejected: body.rejected,
          createdAt: now,
        });
      }
      this.deps.db.runs.finishBacktest(bt.id, { metrics: body.metrics, reportPath: paths.reportPath, equityPath: paths.equityPath, now: this.deps.now() });
      const done = this.deps.db.runs.backtest(bt.id)!;
      return { report: { ...done, config: cfgSnapshot, trades: body.trades, equity: body.equity, rejected: body.rejected }, result };
    } catch (err) {
      this.deps.db.runs.failBacktest(bt.id, err instanceof Error ? err.message : String(err), this.deps.now());
      throw err;
    }
  }
}

const BARS_PER_SESSION: Record<Timeframe, number> = { '5m': 78, '15m': 26, '1h': 7, '1d': 1 };

/** Calendar time needed to load enough bars to warm the features up (weekends included). */
export function warmupMs(tf: Timeframe): number {
  const sessions = Math.ceil((LIMITS.warmupBars * 1.2) / BARS_PER_SESSION[tf]);
  return Math.ceil(sessions * 1.4 + 4) * 86_400_000;
}
