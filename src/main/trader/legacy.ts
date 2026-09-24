// One-time import from the pre-2.0 autopilot (migration 007 tables
// `strategies` / `trades`, left in place). Strategies map onto the new
// composer (trend requirement → regime filter, factor minimums → feature
// filters); trades land in the ledger flagged legacy (excluded from risk
// stats and never managed by the OMS). A "Model default" strategy is seeded
// so model signals are tradeable out of the box.

import type { Database } from 'better-sqlite3';
import type { StrategyParams } from '@shared/trader/types';
import type { TraderDb } from './db';
import { parseJson, type Row } from './db/util';

const DONE_KEY = 'legacy_imported';

export const DEFAULT_STRATEGY = {
  name: 'Model default',
  description: 'Takes every model signal that clears the confidence and edge gates; stops/targets from the risk config (1.5×/3× ATR). Retire it to trade only through the filtered strategies.',
  inspiration: 'Tickeron-style signal agents: the model decides, fixed-fractional risk sizes, the stop is mechanical.',
};

function tableExists(raw: Database, name: string): boolean {
  return Boolean(raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function importLegacy(db: TraderDb, now: number): { strategies: number; trades: number } {
  if (db.ops.get<boolean>(DONE_KEY, false)) return { strategies: 0, trades: 0 };
  const raw = db.raw;
  let strategies = 0;
  let trades = 0;
  db.tx(() => {
    if (tableExists(raw, 'strategies')) {
      for (const r of raw.prepare('SELECT * FROM strategies ORDER BY created_at').all() as Row[]) {
        const old = parseJson<Record<string, unknown>>(r.params, {});
        const minFactor = (old['minFactorScores'] ?? {}) as Record<string, number>;
        const stop = typeof old['stopAtrMult'] === 'number' ? (old['stopAtrMult'] as number) : 1.5;
        const tpR = typeof old['takeProfitR'] === 'number' ? (old['takeProfitR'] as number) : 2;
        const filters: StrategyParams['featureFilters'] = [];
        if ((minFactor['momentum'] ?? 0) > 0) filters.push({ feature: 'roc_15', op: '>', value: 0 });
        if ((minFactor['volume'] ?? 0) > 0) filters.push({ feature: 'vol_z', op: '>', value: 0 });
        if ((minFactor['levels'] ?? 0) > 0) filters.push({ feature: 'bb_pctb', op: '<', value: 0.5 });
        const params: StrategyParams = {
          timeframes: [],
          minConfidence: Math.min(0.99, Math.max(0.5, typeof old['minConfidence'] === 'number' ? (old['minConfidence'] as number) : 0.62)),
          sides: ['long'],
          regimes: old['requireTrend'] === 'up' || (minFactor['trend'] ?? 0) > 0 ? ['trend_up'] : old['requireTrend'] === 'down' ? ['trend_down'] : [],
          featureFilters: filters,
          stopAtrMult: Math.min(10, Math.max(0.3, stop)),
          takeProfitAtrMult: Math.min(20, Math.max(0.3, stop * tpR)),
          maxHoldBars: null,
        };
        db.runs.createStrategy(
          {
            name: String(r.name),
            description: String(r.description ?? ''),
            inspiration: String(r.inspiration ?? ''),
            params,
            legacy: true,
            stats: {
              wins: Number(r.wins ?? 0),
              losses: Number(r.losses ?? 0),
              totalPnl: Number(r.total_pnl ?? 0),
              lessons: parseJson<string[]>(r.lessons, []),
              status: r.status === 'retired' ? 'retired' : 'active',
            },
          },
          Number(r.created_at ?? now),
        );
        strategies += 1;
      }
    }
    if (!db.runs.strategies().some((s) => s.name === DEFAULT_STRATEGY.name)) {
      db.runs.createStrategy({ ...DEFAULT_STRATEGY, params: {} }, now);
    }
    if (tableExists(raw, 'trades')) {
      for (const r of raw.prepare('SELECT * FROM trades ORDER BY opened_at').all() as Row[]) {
        const t = db.ledger.openTrade({
          signalId: null,
          account: r.paper === 0 ? 'live' : 'paper',
          symbol: String(r.symbol),
          side: r.side === 'sell' ? 'short' : 'long',
          timeframe: '1d',
          qty: Number(r.qty),
          entryPrice: Number(r.entry_price),
          stop: r.stoploss ?? null,
          takeProfit: r.take_profit ?? null,
          fees: 0,
          modelVersion: 'legacy-factor-v1',
          strategyId: null,
          maxHoldUntil: null,
          legacy: true,
          now: Number(r.opened_at),
        });
        if (r.status === 'closed' && r.exit_price !== null) {
          db.ledger.closeTrade(t.id, { exitPrice: Number(r.exit_price), fees: 0, reason: 'legacy', review: r.review ?? null, now: Number(r.closed_at ?? r.opened_at) });
        } else if (r.status !== 'open') {
          db.ledger.cancelTrade(t.id, 'legacy: canceled', Number(r.closed_at ?? r.opened_at));
        }
        trades += 1;
      }
    }
    db.ops.set(DONE_KEY, true, now);
  });
  return { strategies, trades };
}
