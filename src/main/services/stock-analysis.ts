// Deterministic stock analysis used by the Stocks screen's Analyze action.
// Builds the multi-factor signal from the Phase-1 pure modules (no LLM), derives
// entry/stoploss/take-profit, the forward forecast, detected patterns, and a
// ready chart. Fast + fully testable. The Phase-2 LLM agents add fundamentals/
// news depth on top; this is the technical backbone the UI calls directly.
import type { MarketDataService } from './market-data';
import type { Bar, Range } from '@shared/market-types';
import { rsi, macd, atr, bollinger, swingLevels, trend } from '@shared/indicators';
import { detectPatterns, type DetectedPattern } from '@shared/patterns';
import { synthesize, type Factor, type Direction } from '@shared/signal';
import { atrStop, takeProfits, rewardRisk, positionSize } from '@shared/trade-math';
import { forecastCone, type ForecastCone } from '@shared/forecast';
import { buildStockChart } from '@shared/stock-chart';

export interface AnalyzeOptions {
  range?: Range;
  account?: number; // for position sizing
  riskPct?: number; // for position sizing
  horizon?: number; // forecast bars
}

export interface StockAnalysis {
  symbol: string;
  range: Range;
  asOf: string;
  price: number;
  direction: Direction;
  confidence: number;
  factors: Factor[];
  entry: number;
  stoploss: number;
  takeProfit: number[];
  rewardRisk: number;
  positionShares?: number;
  forecast: ForecastCone;
  patterns: DetectedPattern[];
  rsi: number | null;
  macdHistogram: number | null;
  chartHtml: string;
}

function lastDefined<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i] as T;
  return null;
}

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}

export async function analyzeSymbol(
  market: MarketDataService,
  symbol: string,
  opts: AnalyzeOptions = {},
): Promise<StockAnalysis> {
  const range: Range = opts.range ?? '1y';
  const bars = await market.history(symbol, range);
  if (bars.length < 30) {
    throw new Error(`not enough history for ${symbol} (need 30+ bars, got ${bars.length})`);
  }
  const last = bars[bars.length - 1]!;
  const price = last.close;

  const rsiNow = lastDefined(rsi(bars, 14));
  const macdSeries = macd(bars);
  const macdHist = macdSeries[macdSeries.length - 1]?.histogram ?? null;
  const atrNow = lastDefined(atr(bars, 14)) ?? Math.max(0.01, price * 0.02);
  const boll = lastDefined(bollinger(bars));
  const swings = swingLevels(bars);
  const patterns = detectPatterns(bars, swings);
  const tr = trend(bars);

  // ── Factors (each score -1..+1) ──
  const factors: Factor[] = [];

  // Trend (heaviest)
  const trendScore = tr === 'up' ? 0.7 : tr === 'down' ? -0.7 : 0;
  factors.push({ key: 'trend', score: trendScore, weight: 2, note: `trend ${tr}` });

  // Momentum: MACD histogram sign + RSI tilt
  const momScore = clamp(
    (macdHist !== null ? Math.sign(macdHist) * 0.5 : 0) + (rsiNow !== null ? (rsiNow - 50) / 100 : 0),
  );
  factors.push({
    key: 'momentum',
    score: momScore,
    weight: 2,
    note: `rsi ${rsiNow?.toFixed(0) ?? 'n/a'}, macd hist ${macdHist?.toFixed(3) ?? 'n/a'}`,
  });

  // Volatility / Bollinger position (mild, mean-aware): above mid = upside bias
  let volScore = 0;
  if (boll) {
    const span = boll.upper - boll.mid || 1;
    volScore = clamp(((price - boll.mid) / span) * 0.5);
  }
  factors.push({ key: 'volatility', score: volScore, weight: 1, note: 'bollinger position' });

  // Levels: nearer support = bullish, nearer resistance = bearish
  const support = swings.supports.length ? Math.max(...swings.supports.filter((s) => s <= price)) : undefined;
  const resistance = swings.resistances.length
    ? Math.min(...swings.resistances.filter((r) => r >= price))
    : undefined;
  let levelScore = 0;
  if (support !== undefined && resistance !== undefined && resistance > support) {
    const pos = (price - support) / (resistance - support); // 0 at support, 1 at resistance
    levelScore = clamp((0.5 - pos) * 1.0); // near support -> +, near resistance -> -
  }
  factors.push({ key: 'levels', score: levelScore, weight: 1, note: 'support/resistance proximity' });

  // Volume confirmation: recent volume vs average, signed by trend
  const vols = bars.map((b) => b.volume);
  const avgVol = vols.reduce((a, v) => a + v, 0) / vols.length;
  const recentVol = vols.slice(-5).reduce((a, v) => a + v, 0) / 5;
  const volConfirm = clamp((recentVol > avgVol ? 0.4 : -0.2) * (trendScore >= 0 ? 1 : -1));
  factors.push({ key: 'volume', score: volConfirm, weight: 1, note: 'volume vs average' });

  // Pattern bias (confidence-weighted mean), one factor among many
  let patScore = 0;
  if (patterns.length) {
    patScore = clamp(
      patterns.reduce((a, p) => a + (p.bias === 'bullish' ? 1 : p.bias === 'bearish' ? -1 : 0) * p.confidence, 0) /
        patterns.length,
    );
  }
  factors.push({ key: 'pattern', score: patScore, weight: 1, note: `${patterns.length} pattern(s)` });

  const signal = synthesize(factors);

  // ── Trade levels ──
  const side: 'long' | 'short' = signal.direction === 'sell' ? 'short' : 'long';
  const entry = price;
  const stoploss = atrStop({ entry, atr: atrNow, mult: 1.5, side });
  const tps = takeProfits({ entry, stop: stoploss, rMultiples: [1, 2, 3] });
  const rr = rewardRisk({ entry, stop: stoploss, target: tps[tps.length - 1]! });

  let positionShares: number | undefined;
  if (typeof opts.account === 'number' && typeof opts.riskPct === 'number') {
    positionShares = positionSize({ account: opts.account, riskPct: opts.riskPct, entry, stop: stoploss }).shares;
  }

  // ── Forecast cone (drift from composite, in price units) ──
  const horizon = opts.horizon ?? 20;
  const drift = signal.composite * atrNow * 0.5;
  const forecast = forecastCone({ lastClose: price, atr: atrNow, drift, horizon, confidence: signal.confidence });

  const chartHtml = buildStockChart({
    symbol,
    bars,
    entry,
    stoploss,
    takeProfit: tps,
    forecast,
    patterns,
    confidence: signal.confidence,
  });

  return {
    symbol,
    range,
    asOf: new Date().toISOString(),
    price,
    direction: signal.direction,
    confidence: signal.confidence,
    factors: signal.factors,
    entry,
    stoploss,
    takeProfit: tps,
    rewardRisk: rr,
    ...(positionShares !== undefined ? { positionShares } : {}),
    forecast,
    patterns,
    rsi: rsiNow,
    macdHistogram: macdHist,
    chartHtml,
  };
}
