// Agent desk — the portfolio-manager agent drives trading without a promoted
// GBDT model, while software keeps prices, sizing and every risk rule.

import { describe, it, expect, afterEach } from 'vitest';
import { etParts, etToUtc, isTradingDay } from '@main/trader/data/calendar';
import { ideaToProposal, parseDeskReply, type DeskInput } from '@main/trader/orchestrator/desk';
import { backfill, makeTrader, marketData, testConfig, TEST_SYMBOLS, type TraderEnv } from './helpers';

let env: TraderEnv | null = null;
afterEach(() => {
  env?.cleanup();
  env = null;
});

const START = etToUtc(2026, 9, 14, 9, 45);

function barCloses(from: number, days: number): number[] {
  const out: number[] = [];
  let d = 0;
  for (let i = 0; d < days && i < 20; i++) {
    const p = etParts(from + i * 86_400_000);
    if (!isTradingDay(p.date, p.weekday)) continue;
    d += 1;
    for (let h = 0; h < 7; h++) out.push(Math.min(etToUtc(p.y, p.m, p.d, 10 + h, 30), etToUtc(p.y, p.m, p.d, 16, 0)));
  }
  return out;
}

function deskInput(over: Partial<DeskInput> = {}): DeskInput {
  return {
    config: testConfig({ llm: { enabled: true } }),
    baseTf: '1h',
    symbols: [
      { symbol: 'AAPL', close: 200, atr: 2, regime: 'trend_up', barTs: 1, named: { rsi_14: 61 } },
      { symbol: 'MSFT', close: 400, atr: 4, regime: 'range', barTs: 1, named: {} },
    ],
    marketRegime: 'broad up-trend',
    news: {},
    positions: [],
    taken: new Set(),
    ...over,
  };
}

describe('desk reply parsing', () => {
  it('keeps valid ideas and drops unknown, duplicate, low-confidence and disallowed ones', () => {
    const reply =
      'Here you go:\n```json\n{"trades":[' +
      '{"symbol":"aapl","side":"long","confidence":0.7,"thesis":"trend + RSI"},' +
      '{"symbol":"AAPL","side":"long","confidence":0.8},' +
      '{"symbol":"TSLA","side":"long","confidence":0.9},' +
      '{"symbol":"MSFT","side":"long","confidence":0.4},' +
      '{"symbol":"MSFT","side":"short","confidence":0.9}]}\n```';
    const ideas = parseDeskReply(reply, deskInput());
    expect(ideas.map((i) => i.symbol)).toEqual(['AAPL']);
  });

  it('a non-JSON reply is an error (no trades), an empty list is fine', () => {
    expect(() => parseDeskReply('I think AAPL looks great!', deskInput())).toThrow();
    expect(parseDeskReply('{"trades":[]}', deskInput())).toEqual([]);
  });

  it('software sets entry, ATR stop and take-profit — not the agent', () => {
    const input = deskInput();
    const p = ideaToProposal({ symbol: 'AAPL', side: 'long', confidence: 0.7, thesis: 't' }, input.symbols[0]!, input, 'm');
    expect(p.source).toBe('agent');
    expect(p.entry).toBe(200);
    expect(p.stop).toBeCloseTo(200 - input.config.risk.stopAtrMult * 2);
    expect(p.takeProfit).toBeCloseTo(200 + input.config.risk.takeProfitAtrMult * 2);
    expect(p.requestedSize).toBeUndefined();
  });
});

describe('agent desk drives the AI Trader with no promoted model', () => {
  it('agent ideas become paper orders through the normal risk engine', async () => {
    const data = marketData(START + 10 * 86_400_000, undefined, '1h', 290);
    let calls = 0;
    env = await makeTrader({
      now: START,
      data,
      config: testConfig({ llm: { enabled: true }, risk: { maxPositions: 4, maxSectorPct: 100 } }),
      handler: (req) => {
        const sys = req.messages.find((m) => m.role === 'system')?.content ?? '';
        if (!sys.includes('portfolio manager')) return { text: 'Rationale.' };
        calls += 1;
        const user = JSON.parse(req.messages.find((m) => m.role === 'user')!.content) as { symbols: Array<{ symbol: string }> };
        const pick = user.symbols.find((s) => s.symbol === 'AAPL') ?? user.symbols[0];
        return { text: JSON.stringify({ trades: pick ? [{ symbol: pick.symbol, side: 'long', confidence: 0.72, thesis: 'test' }] : [] }) };
      },
    });
    await backfill(env);
    await env.service.handle('consent.accept', { text: 'I UNDERSTAND' });
    await env.service.handle('autopilot.set', { enabled: true });
    for (const t of barCloses(START, 2)) {
      env.clock.set(new Date(t + 30_000));
      const c = await env.service.runTick('schedule');
      expect(c!.status).not.toBe('aborted');
    }
    expect(calls).toBeGreaterThan(0);
    const signals = (await env.service.handle('signals.list', { since: 'all', limit: 500 })).signals;
    const agentSignals = signals.filter((s) => s.source === 'agent');
    expect(agentSignals.length).toBeGreaterThan(0);
    expect(agentSignals.every((s) => TEST_SYMBOLS.includes(s.symbol))).toBe(true);
    const orders = (await env.service.handle('orders.list', { limit: 500 })).orders.filter((o) => o.role === 'entry');
    expect(orders.length).toBeGreaterThan(0);
    for (const o of orders) {
      const s = signals.find((x) => x.id === o.signalId)!;
      expect(s.source).toBe('agent');
      expect(o.account).toBe('paper');
      expect(o.qty).toBe(s.size); // size came from the risk engine
    }
  }, 60_000);

  it('a garbage reply places nothing and does not abort the tick', async () => {
    env = await makeTrader({
      now: START,
      data: marketData(START + 10 * 86_400_000, undefined, '1h', 290),
      config: testConfig({ llm: { enabled: true } }),
      handler: () => ({ text: 'buy buy buy' }),
    });
    await backfill(env);
    await env.service.handle('consent.accept', { text: 'I UNDERSTAND' });
    await env.service.handle('autopilot.set', { enabled: true });
    const t = barCloses(START, 1)[0]!;
    env.clock.set(new Date(t + 30_000));
    const c = await env.service.runTick('schedule');
    expect(c!.status).not.toBe('aborted');
    expect((await env.service.handle('orders.list', { limit: 50 })).orders).toEqual([]);
  }, 60_000);
});
