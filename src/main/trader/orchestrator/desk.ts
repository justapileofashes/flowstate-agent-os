// The agent desk: a portfolio-manager agent reads a compact market snapshot
// each tick and names trade ideas. It is how the AI Trader trades when no
// GBDT model has passed the promotion gate, and adds ideas the model didn't.
//
// The agent only picks symbol, side, conviction and a thesis. Software sets
// every number — entry at the last close, ATR-based stop and take-profit —
// and the idea then goes through the same risk engine, veto and OMS as model
// signals. A reply that doesn't parse, times out or names unknown symbols
// produces no trades.

import { z } from 'zod';
import { TIMEFRAME_MS, type Timeframe, type TraderConfig } from '@shared/trader/types';
import { extractJsonObject } from '@main/business/providers/gateway';
import type { HeldPosition, SignalProposal } from '../types';

export interface DeskSymbol {
  symbol: string;
  close: number;
  atr: number;
  regime: string;
  barTs: number;
  /** Named features (rsi_14, roc_15, …) for the snapshot. */
  named: Record<string, number>;
}

export interface DeskInput {
  config: TraderConfig;
  baseTf: Timeframe;
  symbols: DeskSymbol[];
  marketRegime: string;
  news: Record<string, string[]>;
  positions: HeldPosition[];
  /** Symbols the model already proposed this tick (the desk adds, not duplicates). */
  taken: ReadonlySet<string>;
}

const SNAPSHOT_FEATURES = ['rsi_14', 'roc_15', 'roc_60', 'macd_hist', 'bb_pctb', 'vol_z', 'atr_pct', 'trend_slope', 'sma20_dist'];

export const DESK_SYSTEM =
  'You are the portfolio manager of a systematic paper-trading desk. From the market snapshot, pick at most ' +
  '{max} trades with a clear edge right now — or none. Prefer trades aligned with the market regime; avoid ' +
  'symbols already held. You do NOT set prices or size: software places the stop and take-profit from ATR ' +
  'and a risk engine sizes and may reject the trade. Reply with ONLY a JSON object: ' +
  '{"trades":[{"symbol":"AAPL","side":"long"|"short","confidence":0.0-1.0,"thesis":"<one sentence citing the data>"}]}. ' +
  'confidence is your honest probability the trade reaches its target before its stop. Use {"trades":[]} when nothing qualifies.';

export function deskPrompt(input: DeskInput): { system: string; user: string } {
  const max = input.config.llm.desk.maxTradesPerTick;
  const held = new Set(input.positions.map((p) => p.symbol));
  const symbols = input.symbols
    .filter((s) => !input.taken.has(s.symbol))
    .map((s) => ({
      symbol: s.symbol,
      close: round(s.close),
      atrPct: round((s.atr / s.close) * 100),
      regime: s.regime,
      held: held.has(s.symbol),
      ...Object.fromEntries(
        SNAPSHOT_FEATURES.filter((f) => typeof s.named[f] === 'number').map((f) => [f, round(s.named[f]!)]),
      ),
      ...(input.news[s.symbol]?.length ? { news: input.news[s.symbol]!.slice(0, 3) } : {}),
    }));
  return {
    system: DESK_SYSTEM.replace('{max}', String(max)),
    user: JSON.stringify({
      timeframe: input.baseTf,
      marketRegime: input.marketRegime,
      shortingAllowed: input.config.risk.allowShort,
      positions: input.positions.map((p) => ({ symbol: p.symbol, qty: p.qty, avgPrice: round(p.avgPrice) })),
      symbols,
    }),
  };
}

const ideaSchema = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(['long', 'short']),
  confidence: z.number().min(0).max(1),
  thesis: z.string().max(600).default(''),
});
const replySchema = z.object({ trades: z.array(z.unknown()).max(20) });

export type DeskIdea = z.infer<typeof ideaSchema>;

/** Strictly parse the agent's reply. Throws on a malformed reply; individual
 *  bad ideas (unknown symbol, shorts when disabled, duplicates) are dropped. */
export function parseDeskReply(reply: string, input: DeskInput): DeskIdea[] {
  const parsed = replySchema.safeParse(extractJsonObject(reply));
  if (!parsed.success) throw new Error(`desk reply was not {"trades":[...]}: ${reply.slice(0, 200)}`);
  const known = new Map(input.symbols.map((s) => [s.symbol.toUpperCase(), s.symbol]));
  const out: DeskIdea[] = [];
  for (const raw of parsed.data.trades) {
    const idea = ideaSchema.safeParse(raw);
    if (!idea.success) continue;
    const symbol = known.get(idea.data.symbol.toUpperCase());
    if (!symbol || input.taken.has(symbol) || out.some((o) => o.symbol === symbol)) continue;
    if (idea.data.side === 'short' && !input.config.risk.allowShort) continue;
    if (idea.data.confidence < input.config.llm.desk.minConfidence) continue;
    out.push({ ...idea.data, symbol });
    if (out.length >= input.config.llm.desk.maxTradesPerTick) break;
  }
  return out;
}

/** Turn an idea into a proposal with software-set prices. */
export function ideaToProposal(idea: DeskIdea, sym: DeskSymbol, input: DeskInput, model: string): SignalProposal {
  const { config, baseTf } = input;
  const dir = idea.side === 'long' ? 1 : -1;
  const atr = sym.atr > 0 ? sym.atr : sym.close * 0.01;
  const horizonBars = config.llm.desk.horizonBars;
  return {
    symbol: sym.symbol,
    side: idea.side,
    timeframe: baseTf,
    baseTimeframe: baseTf,
    entry: sym.close,
    stop: sym.close - dir * config.risk.stopAtrMult * atr,
    takeProfit: sym.close + dir * config.risk.takeProfitAtrMult * atr,
    confidence: idea.confidence,
    // Expected edge implied by the agent's probability and the ATR bracket.
    edgePct:
      ((idea.confidence * config.risk.takeProfitAtrMult - (1 - idea.confidence) * config.risk.stopAtrMult) * atr * 100) /
      sym.close,
    horizonBars,
    horizonMin: Math.round((horizonBars * TIMEFRAME_MS[baseTf]) / 60_000),
    maxHoldBars: Math.round(horizonBars * config.execution.maxHoldBarsMult),
    atr,
    regime: sym.regime,
    barTs: sym.barTs,
    modelVersion: null,
    modelHash: null,
    strategyId: null,
    strategyName: 'Agent desk',
    perTimeframe: [],
    features: { ...sym.named, regime: sym.regime, desk_model: model },
    source: 'agent',
    drivers: `Agent desk: ${idea.thesis}`.slice(0, 600),
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
