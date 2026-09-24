// Phase 6 DoD — observability, retrain loop, hardening.
//   "dashboard shows live PnL + exposure; a synthetic data-gap injection
//    triggers an alert; a retrain night promotes a model only after passing
//    shadow comparison (3 consecutive days)"

import { describe, it, expect, afterEach } from 'vitest';
import { Metrics } from '@main/trader/monitor/metrics';
import { MetricsServer } from '@main/trader/monitor/http';
import { TraderScheduler } from '@main/trader/scheduler';
import { etParts, etToUtc, isTradingDay } from '@main/trader/data/calendar';
import { defaultTraderConfig } from '@shared/trader/types';
import { backfill, makeDb, makeTrader, marketData, testConfig, type DbEnv, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
let dbEnv: DbEnv | null = null;
afterEach(() => {
  env?.cleanup();
  dbEnv?.cleanup();
  env = null;
  dbEnv = null;
});

const START = etToUtc(2026, 9, 14, 9, 45);

function barCloses(from: number, days: number): number[] {
  const out: number[] = [];
  let d = 0;
  for (let i = 0; d < days && i < 30; i++) {
    const p = etParts(from + i * 86_400_000);
    if (!isTradingDay(p.date, p.weekday)) continue;
    d += 1;
    for (let h = 0; h < 7; h++) out.push(Math.min(etToUtc(p.y, p.m, p.d, 10 + h, 30), etToUtc(p.y, p.m, p.d, 16, 0)));
  }
  return out;
}

async function running(): Promise<TraderEnv> {
  const e = await makeTrader({
    now: START,
    data: marketData(START + 20 * 86_400_000, undefined, '1h', 300),
    config: testConfig({ signals: { confidenceThreshold: 0.55, minEdgePct: 0 }, risk: { maxSectorPct: 100 } }),
  });
  await backfill(e);
  await e.service.handle('models.train', { timeframe: '1h' });
  await e.service.handle('consent.accept', { text: 'I UNDERSTAND' });
  await e.service.handle('autopilot.set', { enabled: true });
  return e;
}

describe('metrics registry', () => {
  it('renders Prometheus text with HELP/TYPE, labels and summaries', () => {
    const m = new Metrics();
    m.inc('trader_orders_total', { status: 'filled' });
    m.inc('trader_orders_total', { status: 'filled' });
    m.set('trader_equity', 101_000, { account: 'paper' });
    for (const v of [1, 2, 3, 4, 100]) m.observe('trader_slippage_bps', v, { account: 'paper' });
    const text = m.prometheus();
    expect(text).toContain('# TYPE trader_orders_total counter');
    expect(text).toContain('trader_orders_total{status="filled"} 2');
    expect(text).toContain('trader_equity{account="paper"} 101000');
    expect(text).toMatch(/trader_slippage_bps\{account="paper",quantile="0.5"\} 3/);
    expect(text).toContain('trader_slippage_bps_count{account="paper"} 5');
    expect(m.snapshot().histograms[0]!.p95).toBe(100);
  });

  it('serves /metrics and /healthz on 127.0.0.1 only when enabled', async () => {
    const m = new Metrics();
    m.set('trader_equity', 5);
    const srv = new MetricsServer(() => m.prometheus(), () => ({ mode: 'paper' }));
    const port = 39_000 + Math.floor(Math.random() * 2000);
    await srv.ensure(port);
    expect(srv.listening).toBe(port);
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('trader_equity 5');
    expect(await (await fetch(`http://127.0.0.1:${port}/healthz`)).json()).toMatchObject({ ok: true, mode: 'paper' });
    await srv.ensure(0);
    expect(srv.listening).toBeNull();
  });
});

describe('Phase 6 DoD: dashboard data', () => {
  it('ticks record live P&L, exposure and equity series for the dashboard', async () => {
    env = await running();
    for (const t of barCloses(START, 2)) {
      env.clock.set(new Date(t + 30_000));
      await env.service.runTick('schedule');
    }
    const snap = await env.service.handle('metrics.snapshot', { sinceHours: 72 });
    const names = new Set(snap.series.map((s) => s.name));
    for (const n of ['trader_equity', 'trader_daily_pnl', 'trader_gross_exposure_pct', 'trader_open_positions']) expect(names.has(n)).toBe(true);
    expect(snap.series.find((s) => s.name === 'trader_equity')!.points.length).toBeGreaterThan(5);
    expect(snap.histograms.some((h) => h.name === 'trader_tick_duration_ms')).toBe(true);
    const prom = await env.service.handle('metrics.prometheus', {});
    expect(prom.text).toContain('trader_cycles_total');
    const pf = await env.service.handle('portfolio', {});
    expect(pf.equityCurve.length).toBeGreaterThan(5);
    // NFR: a simulation tick (signal → order) stays well under 2 s.
    const cycles = env.service.db.runs.cycles(50);
    for (const c of cycles) expect((c.endedAt ?? 0) - c.startedAt).toBeLessThan(2_000);
  }, 180_000);
});

describe('Phase 6 DoD: alerts', () => {
  it('a synthetic data gap raises an alert and blocks trading on the stale symbols', async () => {
    env = await running();
    const [first] = barCloses(START, 1);
    env.clock.set(new Date(first! + 30_000));
    await env.service.runTick('schedule');
    // Freeze two symbols' feeds: no bars after now for AAPL / MSFT.
    for (const s of ['AAPL', 'MSFT']) {
      const bars = env.yahoo.data.get(s)!.get('1h')!;
      env.yahoo.data.get(s)!.set('1h', bars.filter((b) => b.ts + 3_600_000 <= env!.clock.now())); /* closed bars only */
    }
    env.clock.advance(2 * 3_600_000);
    const c = await env.service.runTick('schedule');
    const data = c!.nodes.find((n) => n.node === 'data')!;
    expect((data.data as { stale: string[] }).stale.sort()).toEqual(['AAPL', 'MSFT']);
    const alerts = await env.service.handle('alerts.list', { open: true });
    const gap = alerts.alerts.find((a) => a.key === 'data_gap')!;
    expect(gap.detail).toMatch(/AAPL/);
    expect(env.notifications.some((n) => /data gap/i.test(n.title))).toBe(true);
    const quant = c!.nodes.find((n) => n.node === 'quant');
    if (quant?.data) expect(JSON.stringify(quant.data)).toMatch(/"symbol":"AAPL","reason":"stale data"/);
    // Signals never touch stale symbols.
    const sigs = (await env.service.handle('signals.list', { since: 'all' })).signals.filter((s) => s.createdAt >= env!.clock.now() - 60_000);
    expect(sigs.some((s) => s.symbol === 'AAPL' || s.symbol === 'MSFT')).toBe(false);
  }, 180_000);

  it('drift, fill-failure streaks and webhook delivery', async () => {
    env = await makeTrader({ config: testConfig({ monitor: { webhookUrl: 'https://hooks.example.test/trader' } }) });
    env.http.on('https://hooks.example.test/trader', () => new Response('ok'));
    const now = env.clock.now();
    const db = env.service.db;
    // Baseline confidence ≈ 0.6 over the prior week, ≈ 0.85 today → drift.
    for (let i = 0; i < 150; i++) db.ops.recordSamples([{ name: 'trader_model_confidence_sample', labels: '1h', value: 0.58 + (i % 5) * 0.01 }], now - 3 * 86_400_000 - i * 60_000);
    for (let i = 0; i < 40; i++) db.ops.recordSamples([{ name: 'trader_model_confidence_sample', labels: '1h', value: 0.84 + (i % 3) * 0.01 }], now - i * 60_000);
    // Three failed orders in a row.
    for (let i = 0; i < 3; i++) {
      const { order } = db.oms.insertOrder({ clientOrderId: `f${i}`, account: 'paper', signalId: null, tradeId: null, symbol: 'AAPL', side: 'buy', role: 'entry', type: 'market', qty: 1, limitPrice: null, stopLoss: null, takeProfit: null, assumedPrice: 100, expiresAt: null, now: now + i });
      db.oms.updateOrder(order.id, { status: 'rejected', error: 'insufficient buying power' }, now + i);
    }
    const raised = env.service.alerts.evaluate({ now, config: env.service.config(), staleness: [], reconcileErrors: [] });
    expect(raised.map((a) => a.key).sort()).toEqual(['fill_failures', 'model_drift']);
    // De-duplicated while open.
    expect(env.service.alerts.evaluate({ now: now + 1000, config: env.service.config(), staleness: [], reconcileErrors: [] })).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 5));
    const hooks = env.http.calls.filter((c) => c.url.startsWith('https://hooks.example.test'));
    expect(hooks.length).toBe(2);
    expect(JSON.parse(hooks[0]!.body)).toMatchObject({ source: 'flowstate-ai-trader' });
    expect((await env.service.handle('alerts.ack', { id: 'all' })).acknowledged).toBeGreaterThanOrEqual(2);
  });
});

describe('Phase 6 DoD: retrain loop with shadow promotion', () => {
  it('a candidate is promoted only after 3 consecutive winning shadow days; losing candidates are reverted', async () => {
    env = await makeTrader({ data: marketData(etToUtc(2026, 9, 23, 11, 0)) });
    await backfill(env);
    const v1 = (await env.service.handle('models.train', { timeframe: '1h' })).model!;
    const db = env.service.db;
    const rec = db.models.get(v1.version)!;
    const mk = (version: string): void => {
      db.models.insert({ version, timeframe: '1h', horizonBars: rec.horizonBars, kind: 'incremental', parentVersion: v1.version, status: 'shadow', trainedAt: env!.clock.now(), datasetId: rec.datasetId, featureSet: rec.featureSet, metrics: { ...rec.metrics, passed: true }, hash: `${rec.hash.slice(0, 60)}${version.slice(-4)}`, blob: rec.blob });
    };
    mk('1h-cand-win');
    mk('1h-cand-lose');
    const day = (d: number, version: string, passed: boolean): void =>
      db.models.recordShadowEval({ modelVersion: version, activeVersion: v1.version, day: `2026-09-${String(d).padStart(2, '0')}`, candidateScore: passed ? -0.6 : -0.7, activeScore: -0.65, samples: 50, passed }, env!.clock.now());
    day(21, '1h-cand-win', true);
    day(22, '1h-cand-win', true);
    expect(env.service.registry.applyPolicy()).toEqual([]); // 2 days is not enough
    day(23, '1h-cand-win', true);
    day(21, '1h-cand-lose', false);
    day(22, '1h-cand-lose', false);
    day(23, '1h-cand-lose', false);
    const actions = env.service.registry.applyPolicy();
    expect(actions.map((a) => `${a.version}:${a.action}`).sort()).toEqual(['1h-cand-lose:rejected', '1h-cand-win:promoted']);
    expect(db.models.active('1h')!.version).toBe('1h-cand-win');
    expect(db.models.get(v1.version)!.status).toBe('retired');
  }, 120_000);

  it('shadow models are scored live next to the incumbent, and the daily review turns scores into evaluations', async () => {
    env = await running();
    const active = env.service.db.models.active('1h')!;
    env.service.db.models.insert({ version: '1h-shadow-x', timeframe: '1h', horizonBars: active.horizonBars, kind: 'full', parentVersion: null, status: 'shadow', trainedAt: env.clock.now(), datasetId: active.datasetId, featureSet: active.featureSet, metrics: { ...active.metrics, passed: true }, hash: 'f'.repeat(64), blob: active.blob });
    const closes = barCloses(START, 2);
    for (const t of closes) {
      env.clock.set(new Date(t + 30_000));
      await env.service.runTick('schedule');
    }
    const p = etParts(closes[0]!);
    const dayStart = etToUtc(p.y, p.m, p.d, 0, 0);
    const scores = env.service.db.models.shadowScores('1h-shadow-x', dayStart, dayStart + 86_400_000);
    expect(scores.length).toBeGreaterThan(20);
    const evals = env.service.registry.evaluateShadowDay(dayStart, dayStart + 86_400_000, p.date);
    expect(evals).toHaveLength(1);
    expect(evals[0]!.samples).toBeGreaterThanOrEqual(20);
    expect(evals[0]!.candidateScore).toBeCloseTo(evals[0]!.activeScore, 9); // identical model → no edge → no pass
    expect(evals[0]!.passed).toBe(false);
  }, 180_000);

  it('incremental retrain warm-starts the parent and evaluates only on bars it never saw', async () => {
    env = await running();
    const parent = env.service.db.models.active('1h')!;
    // Two more weeks of data arrive.
    env.clock.set(new Date(START + 15 * 86_400_000));
    await env.service.handle('data.ingest', { timeframe: '1h', days: 30 });
    const res = await env.service.handle('models.train', { timeframe: '1h', kind: 'incremental' });
    expect(res.error).toBeUndefined();
    expect(res.model!.kind).toBe('incremental');
    expect(res.model!.parentVersion).toBe(parent.version);
    const parentEnd = (JSON.parse(parent.blob) as { meta: { dataEnd: number } }).meta.dataEnd;
    expect(res.model!.metrics.testFrom!).toBeGreaterThan(parentEnd);
    expect(['shadow', 'rejected']).toContain(res.action); // never straight to active while an incumbent exists
  }, 180_000);

  it('the scheduler fires nightly and weekly retrains on their cron schedule', async () => {
    dbEnv = makeDb();
    let t = new Date(2026, 8, 22, 20, 0).getTime(); /* Tue 20:00 local */
    const calls: string[] = [];
    const sched = new TraderScheduler({
      db: dbEnv.db,
      config: () => defaultTraderConfig(),
      now: () => t,
      autopilot: () => false,
      anyMarketOpen: () => false,
      tick: async () => undefined,
      reconcile: async () => undefined,
      retrain: async (k) => void calls.push(k),
      dailyReview: async () => void calls.push('daily'),
      housekeeping: async () => void calls.push('housekeeping'),
    });
    await sched.beat(); // first boot arms the crons
    expect(calls.filter((c) => c === 'incremental')).toHaveLength(0);
    t = new Date(2026, 8, 23, 2, 31).getTime(); // 02:31 local, Wednesday → nightly '30 2 * * 1-5'
    await sched.beat();
    expect(calls.filter((c) => c === 'incremental')).toHaveLength(1);
    await sched.beat();
    expect(calls.filter((c) => c === 'incremental')).toHaveLength(1); // once per night
    t = new Date(2026, 8, 26, 4, 1).getTime(); // Saturday 04:01 local → weekly full
    await sched.beat();
    expect(calls).toContain('full');
    t = Math.max(t + 60_000, etToUtc(2026, 9, 26, 19, 0)); /* Saturday evening ET: daily review */
    await sched.beat();
    expect(calls).toContain('daily');
  });
});
