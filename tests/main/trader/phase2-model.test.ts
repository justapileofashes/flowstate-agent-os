// Phase 2 DoD — baseline model + shadow backtest.
//   "train_and_backtest completes end-to-end on historical data (≥ 6 months);
//    registry shows a promoted version with AUC + Sharpe > baseline
//    heuristics; backtest report file exists"

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { computeEdges, contributions, logLoss, modelHash, predictMany, trainGbdt } from '@main/trader/model/gbdt';
import { auc, maxDrawdownPct, psi, sharpe, topDecileHitRate } from '@main/trader/model/metrics';
import { runVectorized } from '@main/trader/backtest/vectorized';
import { costModel } from '@main/trader/backtest/fills';
import { defaultTraderConfig } from '@shared/trader/types';
import { etToUtc } from '@main/trader/data/calendar';
import { backfill, makeTrader, rng, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

const PARAMS = { trees: 60, depth: 3, learningRate: 0.1, minLeaf: 20, bins: 32, subsample: 0.8, l2: 1 };

function separable(n: number, seed: number): { X: number[][]; y: number[] } {
  const r = rng(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * 2 - 1;
    const b = r() * 2 - 1;
    const noise = r();
    X.push([a, b, noise]);
    y.push(a + 0.5 * b + (r() - 0.5) * 0.4 > 0 ? 1 : 0);
  }
  return { X, y };
}

describe('metrics', () => {
  it('AUC, top-decile hit rate, Sharpe, drawdown, PSI', () => {
    expect(auc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8])).toBeCloseTo(0.75, 9);
    expect(auc([1, 1, 0], [0.5, 0.5, 0.5])).toBe(0.5);
    expect(topDecileHitRate([1, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1])).toBe(1);
    expect(sharpe([0.01, 0.01, 0.01], 252)).toBe(0); // no variance
    expect(sharpe([0.01, -0.005, 0.02, 0.0], 252)).toBeGreaterThan(0);
    expect(maxDrawdownPct([100, 120, 90, 130])).toBeCloseTo(25, 9);
    expect(psi([0.1, 0.2, 0.3], [0.1, 0.2, 0.3])).toBeCloseTo(0, 9);
  });
});

describe('GBDT (LightGBM stand-in)', () => {
  it('learns a separable pattern and ignores noise features', async () => {
    const train = separable(3000, 1);
    const test = separable(1000, 2);
    const m = await trainGbdt(train.X, train.y, { params: PARAMS, featureNames: ['a', 'b', 'noise'] });
    const p = predictMany(m, test.X);
    expect(auc(test.y, p)).toBeGreaterThan(0.9);
    expect(logLoss(test.y, p)).toBeLessThan(0.45);
    const imp = m.importances;
    expect(imp[0]!).toBeGreaterThan(imp[2]!);
    expect(contributions(m, test.X[0]!)[0]!.feature).not.toBe('noise');
  });

  it('is deterministic (same data + seed → same hash) and JSON round-trips', async () => {
    const d = separable(800, 3);
    const a = await trainGbdt(d.X, d.y, { params: PARAMS, featureNames: ['a', 'b', 'n'], seed: 11 });
    const b = await trainGbdt(d.X, d.y, { params: PARAMS, featureNames: ['a', 'b', 'n'], seed: 11 });
    expect(modelHash(a)).toBe(modelHash(b));
    const copy = JSON.parse(JSON.stringify(a));
    expect(predictMany(copy, d.X.slice(0, 20))).toEqual(predictMany(a, d.X.slice(0, 20)));
  });

  it('early stopping trims trees; warm start adds trees with the same bin edges', async () => {
    const d = separable(1500, 4);
    const v = separable(500, 5);
    const m = await trainGbdt(d.X, d.y, { params: { ...PARAMS, trees: 300 }, featureNames: ['a', 'b', 'n'], validation: v, earlyStoppingRounds: 10 });
    expect(m.trees.length).toBeLessThan(300);
    const more = await trainGbdt(v.X, v.y, { params: PARAMS, featureNames: ['a', 'b', 'n'], trees: 5, continueFrom: m });
    expect(more.trees.length).toBe(m.trees.length + 5);
    expect(more.edges).toEqual(m.edges);
    expect(computeEdges([[1], [2], [2], [3]], 1, 4)[0]).toEqual([2, 3]);
  });
});

describe('vectorized backtester', () => {
  it('reproduces the analytic result of a known signal profile (acceptance test)', () => {
    // Price rises 1% every bar; one long signal held 5 bars, 10% position, no costs.
    const candles = Array.from({ length: 30 }, (_, i) => {
      const px = 100 * 1.01 ** i;
      const open = 100 * 1.01 ** Math.max(0, i - 1); // opens at the previous close
      return { ts: i * 3_600_000, open, high: px, low: open, close: px, volume: 1e6 };
    });
    const costs = { ...costModel(defaultTraderConfig().execution), slippageBps: 0 };
    const r = runVectorized({ series: [{ symbol: 'X', candles, signals: [{ i: 3, side: 'long', holdBars: 5 }] }], startEquity: 100_000, positionPct: 10, costs, periodsPerYear: 1764 });
    // Entry at open of bar 4 (= close of bar 3), exit at close of bar 8: 5 bars of +1%.
    const expectedTrade = 1.01 ** 5 - 1;
    expect(r.trades[0]!.pnl).toBeCloseTo(10_000 * expectedTrade, 6);
    expect(r.metrics.endEquity).toBeCloseTo(100_000 * (1 + 0.1 * 0.01) ** 5, 4);
    expect(r.metrics.maxDrawdownPct).toBe(0);
    expect(r.metrics.trades).toBe(1);
    // Costs: 10 bps slippage each side lowers the result by ≈ 2 × 10 bps × position.
    const withCosts = runVectorized({ series: [{ symbol: 'X', candles, signals: [{ i: 3, side: 'long', holdBars: 5 }] }], startEquity: 100_000, positionPct: 10, costs: { ...costs, slippageBps: 10 }, periodsPerYear: 1764 });
    expect(withCosts.metrics.endEquity).toBeLessThan(r.metrics.endEquity);
    expect(r.metrics.endEquity - withCosts.metrics.endEquity).toBeCloseTo(100_000 * 0.1 * 0.002, 0);
  });

  it('a fixed alternating signal profile reproduces its Sharpe within tolerance', () => {
    // Returns alternate +2% / −1% per bar; a strategy always long → per-bar portfolio return
    // 0.1·(+2%, −1%) → mean 0.05%, sd ≈ 0.1581% → Sharpe = mean/sd·√N.
    const closes = [100];
    for (let i = 1; i < 201; i++) closes.push(closes[i - 1]! * (i % 2 ? 1.02 : 0.99));
    const candles = closes.map((c, i) => ({ ts: i * 3_600_000, open: closes[Math.max(0, i - 1)]!, high: c, low: c, close: c, volume: 1e6 }));
    const costs = { ...costModel(defaultTraderConfig().execution), slippageBps: 0 };
    const r = runVectorized({ series: [{ symbol: 'X', candles, signals: [{ i: 0, side: 'long', holdBars: 200 }] }], startEquity: 100_000, positionPct: 10, costs, periodsPerYear: 1000 });
    const rets = Array.from({ length: 200 }, (_, k) => 0.1 * ((k + 1) % 2 ? 0.02 : -0.01));
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
    expect(r.metrics.sharpe).toBeCloseTo((mean / sd) * Math.sqrt(1000), 1);
  });
});

describe('Phase 2 DoD: train_and_backtest end-to-end', () => {
  it('trains on ≥ 6 months, promotes a model that beats the baselines, writes a backtest report', async () => {
    env = await makeTrader({ withDataDir: true });
    await backfill(env);
    const bars = env.service.db.market.bars('AAPL', '1h');
    expect((bars[bars.length - 1]!.ts - bars[0]!.ts) / 86_400_000).toBeGreaterThan(180);

    const res = await env.service.handle('models.train', { timeframe: '1h' });
    expect(res.error).toBeUndefined();
    expect(res.action).toBe('promoted');
    const m = res.model!;
    expect(m.status).toBe('active');
    expect(m.metrics.auc).toBeGreaterThan(0.55);
    expect(m.metrics.sharpe).toBeGreaterThan(Math.max(...m.metrics.baselines.map((b) => b.sharpe)));
    expect(m.metrics.walkForward.length).toBeGreaterThanOrEqual(3);
    expect(m.metrics.rows.train).toBeGreaterThan(1000);
    expect(m.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.datasetId).toMatch(/^ds-/);
    // Purged split: the test window starts after every training label.
    expect(m.metrics.testFrom).toBeGreaterThan(0);

    const models = await env.service.handle('models.list', {});
    expect(models.models.filter((x) => x.status === 'active')).toHaveLength(1);

    const bt = await env.service.handle('backtests.run', { kind: 'event', timeframe: '1h', days: 60 });
    expect(bt.error).toBeUndefined();
    const report = bt.report!;
    expect(report.status).toBe('done');
    expect(report.metrics!.bars).toBeGreaterThan(100);
    expect(existsSync(report.reportPath!)).toBe(true);
    expect(existsSync(report.equityPath!)).toBe(true);
    const body = JSON.parse(readFileSync(report.reportPath!, 'utf8')) as { trades: unknown[]; equity: unknown[] };
    expect(body.equity.length).toBe(report.metrics!.bars);
    expect(readFileSync(report.equityPath!, 'utf8').split('\n')[0]).toBe('ts,iso,equity');

    const vec = await env.service.handle('backtests.run', { kind: 'vectorized', timeframe: '1h', days: 60 });
    expect(vec.report!.metrics!.trades).toBeGreaterThan(0);
    const fetched = await env.service.handle('report.get', { id: report.id });
    expect(fetched.report!.trades.length).toBe(report.trades.length);
  }, 120_000);

  it('rejects a model trained on noise (no edge → not promoted)', async () => {
    const { marketData } = await import('./helpers');
    const end = etToUtc(2026, 9, 23, 11, 0);
    // φ = 0 → pure random walk: nothing to learn.
    const data = marketData(end);
    for (const [, byTf] of data) {
      const c = byTf.get('1h')!;
      const r = rng(77);
      let px = 100;
      byTf.set(
        '1h',
        c.map((k) => {
          const ret = 0.006 * (r() * 2 - 1) * 1.7;
          const open = px;
          px = px * Math.exp(ret);
          return { ...k, open, close: px, high: Math.max(open, px) * 1.001, low: Math.min(open, px) * 0.999 };
        }),
      );
    }
    env = await makeTrader({ data });
    await backfill(env);
    const res = await env.service.handle('models.train', { timeframe: '1h' });
    expect(res.action).toBe('rejected');
    expect(res.model!.status).toBe('rejected');
    expect(res.model!.metrics.reasons.join(' ')).toMatch(/AUC|baseline|Sharpe|trades/);
    const st = await env.service.handle('status', {});
    expect(st.activeModels).toHaveLength(0);
  }, 120_000);
});
