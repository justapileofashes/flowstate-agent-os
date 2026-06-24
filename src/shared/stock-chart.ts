// Pure builder: turns price bars + trade levels + forecast cone + detected
// patterns into a self-contained HTML candlestick chart (inline SVG, no external
// libs). Used by the stock_chart agent tool so a local model never hand-writes
// fragile chart code. The same 5 layers the Stocks screen renders:
//   1 candlesticks  2 entry/SL/TP lines  3 forecast lines (bull/base/bear)
//   4 pattern lines  5 confidence + "not advice" label
import type { Bar } from './market-types';
import type { ForecastCone } from './forecast';
import type { DetectedPattern } from './patterns';

export interface StockChartInput {
  symbol: string;
  bars: Bar[];
  entry?: number;
  stoploss?: number;
  takeProfit?: number[];
  forecast?: ForecastCone;
  patterns?: DetectedPattern[];
  confidence?: number; // 0..1
}

const W = 900;
const H = 480;
const M = { top: 28, right: 70, bottom: 56, left: 16 };
const UP = '#4cae8a';
const DOWN = '#d9605f';
const INK = '#ece5d6';
const MUTED = '#8a8275';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildStockChart(input: StockChartInput): string {
  const bars = input.bars;
  const horizon = input.forecast?.base.length ?? 0;
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  // Collect every price that must fit on the y-axis.
  const prices: number[] = [];
  for (const b of bars) prices.push(b.high, b.low);
  for (const v of [input.entry, input.stoploss, ...(input.takeProfit ?? [])]) {
    if (typeof v === 'number') prices.push(v);
  }
  if (input.forecast) {
    for (const s of ['bull', 'base', 'bear'] as const) {
      for (const p of input.forecast[s]) prices.push(p.value);
    }
  }
  for (const pat of input.patterns ?? []) {
    for (const ln of pat.lines) prices.push(ln.from.price, ln.to.price);
  }
  const maxP = Math.max(...prices);
  const minP = Math.min(...prices);
  const pad = (maxP - minP) * 0.05 || 1;
  const hi = maxP + pad;
  const lo = minP - pad;

  const n = bars.length;
  const slots = Math.max(1, n + horizon);
  const slotW = plotW / slots;
  const x = (slot: number): number => M.left + slot * slotW + slotW / 2;
  const y = (p: number): number => M.top + ((hi - p) / (hi - lo)) * plotH;
  const indexByTime = new Map(bars.map((b, i) => [b.time, i] as const));

  const parts: string[] = [];

  // ── Layer 1: candlesticks ──
  const candleW = Math.max(1, slotW * 0.6);
  bars.forEach((b, i) => {
    const cx = x(i);
    const up = b.close >= b.open;
    const color = up ? UP : DOWN;
    const yo = y(b.open);
    const yc = y(b.close);
    const bodyTop = Math.min(yo, yc);
    const bodyH = Math.max(1, Math.abs(yc - yo));
    parts.push(
      `<line x1="${cx.toFixed(1)}" y1="${y(b.high).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${y(b.low).toFixed(1)}" stroke="${color}" stroke-width="1"/>`,
      `<rect x="${(cx - candleW / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${candleW.toFixed(1)}" height="${bodyH.toFixed(1)}" fill="${color}"/>`,
    );
  });

  // ── Layer 2: entry / stoploss / take-profit ──
  const level = (p: number, color: string, label: string): string => {
    const yy = y(p);
    return (
      `<line x1="${M.left}" y1="${yy.toFixed(1)}" x2="${W - M.right}" y2="${yy.toFixed(1)}" stroke="${color}" stroke-width="1" stroke-dasharray="2 3"/>` +
      `<text x="${W - M.right + 4}" y="${(yy + 3).toFixed(1)}" fill="${color}" font-size="11">${esc(label)} ${p.toFixed(2)}</text>`
    );
  };
  if (typeof input.entry === 'number') parts.push(level(input.entry, INK, 'Entry'));
  if (typeof input.stoploss === 'number') parts.push(level(input.stoploss, DOWN, 'SL'));
  (input.takeProfit ?? []).forEach((tp, i) => parts.push(level(tp, UP, `TP${i + 1}`)));

  // ── Layer 3: forecast lines (bull / base / bear) + cone ──
  if (input.forecast && n > 0) {
    const startX = x(n - 1);
    const startY = y(bars[n - 1]!.close);
    const fx = (t: number): number => x(n - 1 + t);
    const path = (pts: { time: number; value: number }[]): string =>
      `M ${startX.toFixed(1)} ${startY.toFixed(1)} ` +
      pts.map((p) => `L ${fx(p.time).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    const bull = input.forecast.bull;
    const bear = input.forecast.bear;
    // shaded cone (bull forward, bear back)
    const conePts =
      bull.map((p) => `${fx(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') +
      ' ' +
      [...bear].reverse().map((p) => `${fx(p.time).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    parts.push(
      `<polygon points="${startX.toFixed(1)},${startY.toFixed(1)} ${conePts}" fill="${UP}" fill-opacity="0.08" stroke="none"/>`,
    );
    parts.push(`<path d="${path(input.forecast.bull)}" fill="none" stroke="${UP}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="${path(input.forecast.base)}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    parts.push(`<path d="${path(input.forecast.bear)}" fill="none" stroke="${DOWN}" stroke-width="1.5" stroke-dasharray="4 3"/>`);
    // end-point price labels
    const endLabel = (arr: { time: number; value: number }[], color: string, name: string): void => {
      const last = arr[arr.length - 1]!;
      parts.push(
        `<circle cx="${fx(last.time).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="2.5" fill="${color}"/>`,
        `<text x="${(fx(last.time) + 4).toFixed(1)}" y="${(y(last.value) + 3).toFixed(1)}" fill="${color}" font-size="10">${name} ${last.value.toFixed(2)}</text>`,
      );
    };
    endLabel(input.forecast.bull, UP, 'Bull');
    endLabel(input.forecast.base, INK, 'Base');
    endLabel(input.forecast.bear, DOWN, 'Bear');
  }

  // ── Layer 4: pattern lines ──
  for (const pat of input.patterns ?? []) {
    const color = pat.bias === 'bullish' ? UP : pat.bias === 'bearish' ? DOWN : MUTED;
    for (const ln of pat.lines) {
      const i1 = indexByTime.get(ln.from.time);
      const i2 = indexByTime.get(ln.to.time);
      if (i1 === undefined || i2 === undefined) continue;
      parts.push(
        `<line x1="${x(i1).toFixed(1)}" y1="${y(ln.from.price).toFixed(1)}" x2="${x(i2).toFixed(1)}" y2="${y(ln.to.price).toFixed(1)}" stroke="${color}" stroke-width="1.5" stroke-opacity="0.8"/>`,
      );
    }
    const mid = pat.lines[0];
    if (mid) {
      parts.push(
        `<text x="${x(indexByTime.get(mid.from.time) ?? 0).toFixed(1)}" y="${(y(mid.from.price) - 5).toFixed(1)}" fill="${color}" font-size="10">${esc(pat.label)}</text>`,
      );
    }
  }

  // ── Layer 5: title + confidence + disclaimer ──
  const conf =
    typeof input.confidence === 'number' ? ` · confidence ${Math.round(input.confidence * 100)}%` : '';
  parts.push(
    `<text x="${M.left}" y="18" fill="${INK}" font-size="13" font-weight="600">${esc(input.symbol)}${conf}</text>`,
  );
  parts.push(
    `<text x="${M.left}" y="${H - 34}" fill="${MUTED}" font-size="10">Forecast is illustrative — educational analysis, not financial advice.</text>`,
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" font-family="Inter,system-ui,sans-serif">` +
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#0e0d0c"/>` +
    parts.join('') +
    `</svg>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;background:#0e0d0c}</style></head><body>${svg}</body></html>`
  );
}
