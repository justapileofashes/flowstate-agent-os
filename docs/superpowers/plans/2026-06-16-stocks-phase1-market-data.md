# Stocks Phase 1 — Market-Data Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, tested backend that powers stock research/analysis — price data, indicators, trade math, forecast, pattern detection, multi-factor signal synthesis, and an agent tool to expose it.

**Architecture:** Six small modules. Five are pure (`src/shared/`) and fully unit-tested with no IO: `indicators`, `trade-math`, `forecast`, `patterns`, `signal`. One does IO (`src/main/services/market-data.ts`) and is tested with mocked `fetch` + a CSV fixture. A new `stock_data` agent tool wires `market-data` + `indicators` + `patterns` into the existing `ToolDispatcher`. A new `stocks` entitlement key is added (gate enforced later in Phase 3).

**Tech Stack:** TypeScript (ESM, `"type": "module"`), vitest, zod. Path aliases: `@shared/*` → `src/shared/*`, `@main/*` → `src/main/*`. Tests live under `tests/` mirroring source, importing via relative paths (e.g. `../../src/shared/x`). Run all tests: `npm test` (alias `vitest run`). Run one file: `npx vitest run tests/shared/x.test.ts`.

**Conventions to follow (read first):**
- Existing pure-shared example: `src/shared/entitlements.ts` + `tests/shared/entitlements.test.ts`.
- Tool wiring pattern: `src/main/agent/tool-specs.ts` (specs) + `src/main/agent/tool-dispatcher.ts` (zod schema in `argsSchemas`, a `case` in the `switch`). Tool failures return `ERROR: ...` strings via the `failure()` helper; successes JSON-stringify via `ok()`.
- Do NOT commit unless the human running the plan asks; if they do, branch off `main` first.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/market-types.ts` | Shared types: `Bar`, `Range`, `Quote`. Imported by every other unit. |
| `src/shared/indicators.ts` | Pure TA math: SMA, EMA, RSI, MACD, ATR, Bollinger, swingLevels, trend. |
| `src/shared/trade-math.ts` | Pure risk math: position size, ATR stop, take-profits, reward:risk. |
| `src/shared/forecast.ts` | Pure forward projection cone (bull/base/bear paths). |
| `src/shared/patterns.ts` | Pure chart-pattern detection → drawable line segments. |
| `src/shared/signal.ts` | Pure multi-factor synthesis → direction + confidence + drift. |
| `src/main/services/market-data.ts` | Fetch OHLCV (Stooq CSV / optional Alpha Vantage) + disk cache. |
| `src/main/agent/tool-specs.ts` (modify) | Add `STOCK_DATA_TOOL_SPEC` + include it in `getToolSpecsForAgent`. |
| `src/main/agent/tool-dispatcher.ts` (modify) | Add `stock_data` zod schema + switch case. |
| `src/shared/entitlements.ts` (modify) | Add `stocks` feature key at `pro`. |

Tests mirror under `tests/shared/*.test.ts` and `tests/main/services/market-data.test.ts`.

Build order: types → indicators → trade-math → forecast → patterns → signal → market-data → tool → entitlement. Each task is independently testable and committable.

---

## Task 1: Shared market types

**Files:**
- Create: `src/shared/market-types.ts`

- [ ] **Step 1: Write the types module** (no test — type-only file, verified by `npm run typecheck` and by consumers in later tasks)

```ts
// src/shared/market-types.ts
// Shared price-data shapes. Pure types, no runtime — imported by every
// stocks unit (indicators, forecast, patterns, signal) and the market-data service.

export interface Bar {
  time: string; // ISO date 'YYYY-MM-DD' (daily) or ISO datetime (intraday)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Range = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max';

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  asOf: string; // ISO timestamp
}

/** Approx calendar days per range — used to slice history. 'max' = Infinity. */
export const RANGE_DAYS: Record<Range, number> = {
  '1m': 31,
  '3m': 93,
  '6m': 186,
  '1y': 372,
  '2y': 744,
  '5y': 1860,
  max: Infinity,
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/market-types.ts
git commit -m "feat(stocks): shared market-data types"
```

---

## Task 2: Indicators (TA math)

**Files:**
- Create: `src/shared/indicators.ts`
- Test: `tests/shared/indicators.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/indicators.test.ts
import { describe, it, expect } from 'vitest';
import { sma, ema, rsi, macd, atr, bollinger, swingLevels, trend } from '../../src/shared/indicators';
import type { Bar } from '../../src/shared/market-types';

function bar(close: number, high = close + 1, low = close - 1, open = close): Bar {
  return { time: '2020-01-01', open, high, low, close, volume: 100 };
}

describe('sma', () => {
  it('nulls until the window fills, then averages', () => {
    expect(sma([2, 4, 6, 8], 2)).toEqual([null, 3, 5, 7]);
  });
});

describe('ema', () => {
  it('seeds from the first value and smooths', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2, 5); // seed = sma of first 3
    expect(out[3]!).toBeGreaterThan(2);
  });
});

describe('rsi', () => {
  it('is 100 for a monotonic rise', () => {
    const bars = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].map((c) => bar(c));
    const out = rsi(bars, 14);
    expect(out[14]).toBeCloseTo(100, 5);
  });
  it('warms up with nulls', () => {
    const bars = [10, 11, 12].map((c) => bar(c));
    expect(rsi(bars, 14)[2]).toBeNull();
  });
});

describe('macd', () => {
  it('returns macd/signal/histogram arrays aligned to input length', () => {
    const bars = Array.from({ length: 40 }, (_, i) => bar(10 + i));
    const out = macd(bars, 12, 26, 9);
    expect(out).toHaveLength(40);
    expect(out[39]!.histogram).toBeCloseTo(out[39]!.macd! - out[39]!.signal!, 6);
  });
});

describe('atr', () => {
  it('equals the constant true range when every bar has the same range', () => {
    const bars = Array.from({ length: 20 }, () => bar(10, 11, 9, 10)); // TR = 2 each
    expect(atr(bars, 14)[14]).toBeCloseTo(2, 5);
  });
});

describe('bollinger', () => {
  it('mid equals SMA and bands are symmetric', () => {
    const bars = Array.from({ length: 25 }, (_, i) => bar(10 + (i % 2))); // alternating 10/11
    const b = bollinger(bars, 20, 2)[24]!;
    expect(b.upper - b.mid).toBeCloseTo(b.mid - b.lower, 6);
  });
});

describe('swingLevels', () => {
  it('finds a pivot high and low', () => {
    // up to 20, down to 5, back up — 20 is resistance, 5 is support
    const closes = [10, 12, 14, 16, 18, 20, 18, 14, 10, 7, 5, 7, 10, 13, 16];
    const bars = closes.map((c) => bar(c));
    const { supports, resistances } = swingLevels(bars, 3);
    expect(resistances).toContain(20 + 1); // pivot uses highs (close+1)
    expect(supports).toContain(5 - 1); // pivot uses lows (close-1)
  });
});

describe('trend', () => {
  it('reads a steady rise as up and a steady fall as down', () => {
    const up = Array.from({ length: 40 }, (_, i) => bar(10 + i));
    const down = Array.from({ length: 40 }, (_, i) => bar(50 - i));
    expect(trend(up)).toBe('up');
    expect(trend(down)).toBe('down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/indicators.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/indicators'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/indicators.ts
// Pure technical-analysis math over Bar[] / number[]. No IO. Leading values are
// null until the period warms up — callers must handle nulls.
import type { Bar } from './market-types';

type N = number | null;

export function sma(values: number[], period: number): N[] {
  const out: N[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): N[] {
  const out: N[] = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period; // seed = SMA
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function rsi(bars: Bar[], period = 14): N[] {
  const out: N[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = bars[i]!.close - bars[i - 1]!.close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i]!.close - bars[i - 1]!.close;
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdPoint {
  macd: N;
  signal: N;
  histogram: N;
}

export function macd(bars: Bar[], fast = 12, slow = 26, signal = 9): MacdPoint[] {
  const closes = bars.map((b) => b.close);
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const macdLine: N[] = closes.map((_, i) =>
    ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null,
  );
  // signal EMA over the defined portion of macdLine
  const defined = macdLine.map((v) => (v === null ? 0 : v));
  const firstIdx = macdLine.findIndex((v) => v !== null);
  const sigRaw = firstIdx < 0 ? [] : ema(defined.slice(firstIdx), signal);
  const sig: N[] = new Array(bars.length).fill(null);
  for (let i = 0; i < sigRaw.length; i++) sig[firstIdx + i] = sigRaw[i]!;
  return macdLine.map((m, i) => ({
    macd: m,
    signal: sig[i]!,
    histogram: m !== null && sig[i] !== null ? m - (sig[i] as number) : null,
  }));
}

export function atr(bars: Bar[], period = 14): N[] {
  const out: N[] = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;
  const tr: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    const pc = bars[i - 1]!.close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export interface BollingerPoint {
  upper: number;
  mid: number;
  lower: number;
}

export function bollinger(bars: Bar[], period = 20, mult = 2): (BollingerPoint | null)[] {
  const closes = bars.map((b) => b.close);
  const mids = sma(closes, period);
  return mids.map((mid, i) => {
    if (mid === null) return null;
    const slice = closes.slice(i - period + 1, i + 1);
    const variance = slice.reduce((a, c) => a + (c - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: mid + mult * sd, mid, lower: mid - mult * sd };
  });
}

export interface SwingLevels {
  supports: number[];
  resistances: number[];
}

/** Pivot highs/lows: a bar whose high (low) is the max (min) of +/-lookback neighbors. */
export function swingLevels(bars: Bar[], lookback = 10): SwingLevels {
  const supports: number[] = [];
  const resistances: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const win = bars.slice(i - lookback, i + lookback + 1);
    const h = bars[i]!.high;
    const l = bars[i]!.low;
    if (h === Math.max(...win.map((b) => b.high))) resistances.push(h);
    if (l === Math.min(...win.map((b) => b.low))) supports.push(l);
  }
  return { supports, resistances };
}

export type Trend = 'up' | 'down' | 'sideways';

/** EMA(slow) slope over the last quarter of bars decides the trend. */
export function trend(bars: Bar[], period = 20): Trend {
  const closes = bars.map((b) => b.close);
  const e = ema(closes, period).filter((v): v is number => v !== null);
  if (e.length < 2) return 'sideways';
  const recent = e.slice(-Math.max(2, Math.floor(e.length / 4)));
  const slope = (recent[recent.length - 1]! - recent[0]!) / recent[0]!;
  if (slope > 0.01) return 'up';
  if (slope < -0.01) return 'down';
  return 'sideways';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/indicators.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/indicators.ts tests/shared/indicators.test.ts
git commit -m "feat(stocks): technical indicators (sma/ema/rsi/macd/atr/bollinger/swing/trend)"
```

---

## Task 3: Trade math (risk levels)

**Files:**
- Create: `src/shared/trade-math.ts`
- Test: `tests/shared/trade-math.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/trade-math.test.ts
import { describe, it, expect } from 'vitest';
import { positionSize, atrStop, takeProfits, rewardRisk } from '../../src/shared/trade-math';

describe('positionSize', () => {
  it('risks the right dollar amount and shares', () => {
    // $10k account, risk 1% = $100, entry 50 stop 45 => $5 risk/share => 20 shares
    expect(positionSize({ account: 10000, riskPct: 1, entry: 50, stop: 45 })).toEqual({
      shares: 20,
      riskAmount: 100,
    });
  });
  it('throws when entry equals stop', () => {
    expect(() => positionSize({ account: 1000, riskPct: 1, entry: 50, stop: 50 })).toThrow();
  });
});

describe('atrStop', () => {
  it('places a long stop below entry by mult*atr', () => {
    expect(atrStop({ entry: 100, atr: 2, mult: 1.5, side: 'long' })).toBeCloseTo(97, 5);
  });
  it('places a short stop above entry', () => {
    expect(atrStop({ entry: 100, atr: 2, mult: 1.5, side: 'short' })).toBeCloseTo(103, 5);
  });
});

describe('takeProfits', () => {
  it('projects R-multiples in the trade direction (long)', () => {
    // entry 50 stop 45 => R = 5 ; targets at 1R,2R,3R => 55,60,65
    expect(takeProfits({ entry: 50, stop: 45, rMultiples: [1, 2, 3] })).toEqual([55, 60, 65]);
  });
  it('projects downward for a short (stop above entry)', () => {
    expect(takeProfits({ entry: 50, stop: 55, rMultiples: [1, 2] })).toEqual([45, 40]);
  });
});

describe('rewardRisk', () => {
  it('is reward over risk', () => {
    expect(rewardRisk({ entry: 50, stop: 45, target: 65 })).toBeCloseTo(3, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/trade-math.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/trade-math.ts
// Pure risk math, shared by the analyst agents and the Stocks screen's risk
// calculator so both agree exactly. No IO.

export interface PositionSizeInput {
  account: number;
  riskPct: number; // percent, e.g. 1 = 1%
  entry: number;
  stop: number;
}

export function positionSize(i: PositionSizeInput): { shares: number; riskAmount: number } {
  const perShare = Math.abs(i.entry - i.stop);
  if (perShare === 0) throw new Error('entry and stop cannot be equal');
  if (i.account < 0 || i.riskPct < 0) throw new Error('account and riskPct must be non-negative');
  const riskAmount = (i.account * i.riskPct) / 100;
  return { shares: Math.floor(riskAmount / perShare), riskAmount };
}

export interface AtrStopInput {
  entry: number;
  atr: number;
  mult?: number;
  side: 'long' | 'short';
}

export function atrStop(i: AtrStopInput): number {
  const mult = i.mult ?? 1.5;
  const dist = i.atr * mult;
  return i.side === 'long' ? i.entry - dist : i.entry + dist;
}

export interface TakeProfitInput {
  entry: number;
  stop: number;
  rMultiples?: number[];
}

export function takeProfits(i: TakeProfitInput): number[] {
  const r = Math.abs(i.entry - i.stop);
  const dir = i.stop < i.entry ? 1 : -1; // stop below = long = targets above
  return (i.rMultiples ?? [1, 2, 3]).map((m) => i.entry + dir * r * m);
}

export function rewardRisk(i: { entry: number; stop: number; target: number }): number {
  const risk = Math.abs(i.entry - i.stop);
  if (risk === 0) throw new Error('entry and stop cannot be equal');
  return Math.abs(i.target - i.entry) / risk;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/trade-math.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/trade-math.ts tests/shared/trade-math.test.ts
git commit -m "feat(stocks): trade math (position size, ATR stop, take-profits, R:R)"
```

---

## Task 4: Forecast cone

**Files:**
- Create: `src/shared/forecast.ts`
- Test: `tests/shared/forecast.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/forecast.test.ts
import { describe, it, expect } from 'vitest';
import { forecastCone } from '../../src/shared/forecast';

const base = { lastClose: 100, atr: 2, drift: 0.5, horizon: 10, confidence: 0.5 };

describe('forecastCone', () => {
  it('produces horizon points per scenario, ordered bull >= base >= bear', () => {
    const c = forecastCone(base);
    expect(c.base).toHaveLength(10);
    const last = 9;
    expect(c.bull[last]!.value).toBeGreaterThanOrEqual(c.base[last]!.value);
    expect(c.base[last]!.value).toBeGreaterThanOrEqual(c.bear[last]!.value);
  });
  it('widens monotonically with time', () => {
    const c = forecastCone(base);
    const width = (i: number) => c.bull[i]!.value - c.bear[i]!.value;
    expect(width(9)).toBeGreaterThan(width(0));
  });
  it('narrows the band as confidence rises', () => {
    const low = forecastCone({ ...base, confidence: 0.1 });
    const high = forecastCone({ ...base, confidence: 0.9 });
    const w = (c: ReturnType<typeof forecastCone>) => c.bull[9]!.value - c.bear[9]!.value;
    expect(w(high)).toBeLessThan(w(low));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/forecast.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/forecast.ts
// Pure forward projection. base path follows drift; bull/bear widen with
// sqrt(time)*atr (uncertainty grows) and narrow as confidence rises. Shared by
// the analyst chart artifact and the Stocks screen.

export type Scenario = 'bull' | 'base' | 'bear';

export interface ForecastInput {
  lastClose: number;
  atr: number;
  drift: number; // per-bar expected move, signed
  horizon: number; // bars forward
  confidence: number; // 0..1
}

export interface ForecastPoint {
  time: number; // bars ahead (1..horizon)
  value: number;
}

export type ForecastCone = Record<Scenario, ForecastPoint[]>;

export function forecastCone(i: ForecastInput): ForecastCone {
  const conf = Math.min(1, Math.max(0, i.confidence));
  // higher confidence -> narrower band. k in [0.5 .. 2.0]
  const k = 2 - 1.5 * conf;
  const bull: ForecastPoint[] = [];
  const baseArr: ForecastPoint[] = [];
  const bear: ForecastPoint[] = [];
  for (let t = 1; t <= i.horizon; t++) {
    const mid = i.lastClose + i.drift * t;
    const spread = k * i.atr * Math.sqrt(t);
    bull.push({ time: t, value: mid + spread });
    baseArr.push({ time: t, value: mid });
    bear.push({ time: t, value: mid - spread });
  }
  return { bull, base: baseArr, bear };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/forecast.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/forecast.ts tests/shared/forecast.test.ts
git commit -m "feat(stocks): forward forecast cone (bull/base/bear)"
```

---

## Task 5: Pattern detection

**Files:**
- Create: `src/shared/patterns.ts`
- Test: `tests/shared/patterns.test.ts`

Scope note (YAGNI): implement the two most reliable, testable detectors now — **double-bottom**
and **trendline-support / trendline-resistance** (which together cover channels via two parallel
trendlines). The richer set (triangles, wedges, head-shoulders) is declared in the `PatternKind`
type for forward-compat but detected in a Phase-2 follow-up; detecting them reliably needs the live
agent in the loop. This keeps Phase 1 pure and fully tested.

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/patterns.test.ts
import { describe, it, expect } from 'vitest';
import { detectPatterns } from '../../src/shared/patterns';
import { swingLevels } from '../../src/shared/indicators';
import type { Bar } from '../../src/shared/market-types';

function bars(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: `2020-01-${String(i + 1).padStart(2, '0')}`,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: 100,
  }));
}

describe('detectPatterns', () => {
  it('flags a double-bottom (two similar lows with a peak between) as bullish', () => {
    const b = bars([20, 15, 10, 14, 18, 14, 10, 14, 19, 22]);
    const found = detectPatterns(b, swingLevels(b, 2));
    const db = found.find((p) => p.kind === 'double-bottom');
    expect(db).toBeDefined();
    expect(db!.bias).toBe('bullish');
    expect(db!.lines.length).toBeGreaterThan(0);
  });
  it('returns a falling resistance trendline for descending highs', () => {
    const b = bars([30, 25, 28, 22, 26, 19, 24, 16]);
    const found = detectPatterns(b, swingLevels(b, 1));
    const tl = found.find((p) => p.kind === 'trendline-resistance');
    expect(tl).toBeDefined();
    expect(tl!.lines[0]!.from.price).toBeGreaterThan(tl!.lines[0]!.to.price);
  });
  it('returns an empty array when there is no structure', () => {
    const b = bars([10, 10, 10, 10, 10]);
    expect(detectPatterns(b, swingLevels(b, 1))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/patterns.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/patterns.ts
// Pure chart-pattern detection -> drawable line segments. Built on swing pivots.
// Phase 1 detects double-bottom and support/resistance trendlines; the wider
// catalog is typed for forward-compat.
import type { Bar } from './market-types';
import type { SwingLevels } from './indicators';

export type PatternKind =
  | 'trendline-support'
  | 'trendline-resistance'
  | 'channel'
  | 'triangle-ascending'
  | 'triangle-descending'
  | 'triangle-symmetrical'
  | 'double-top'
  | 'double-bottom'
  | 'head-shoulders'
  | 'wedge';

export interface PatternLine {
  from: { time: string; price: number };
  to: { time: string; price: number };
}

export interface DetectedPattern {
  kind: PatternKind;
  lines: PatternLine[];
  label: string;
  confidence: number; // 0..1
  bias: 'bullish' | 'bearish' | 'neutral';
}

interface Pivot {
  index: number;
  price: number;
}

function pivotLows(bars: Bar[], lookback: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const win = bars.slice(i - lookback, i + lookback + 1);
    if (bars[i]!.low === Math.min(...win.map((b) => b.low))) out.push({ index: i, price: bars[i]!.low });
  }
  return out;
}

function pivotHighs(bars: Bar[], lookback: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const win = bars.slice(i - lookback, i + lookback + 1);
    if (bars[i]!.high === Math.max(...win.map((b) => b.high))) out.push({ index: i, price: bars[i]!.high });
  }
  return out;
}

export function detectPatterns(bars: Bar[], _pivots: SwingLevels, lookback = 2): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  if (bars.length < 5) return out;
  const lows = pivotLows(bars, lookback);
  const highs = pivotHighs(bars, lookback);

  // Double bottom: two lows within 3% of each other, with a higher pivot between them.
  for (let a = 0; a < lows.length; a++) {
    for (let b = a + 1; b < lows.length; b++) {
      const lo1 = lows[a]!;
      const lo2 = lows[b]!;
      const diff = Math.abs(lo1.price - lo2.price) / lo1.price;
      if (diff > 0.03) continue;
      const peakBetween = highs.find((h) => h.index > lo1.index && h.index < lo2.index);
      if (!peakBetween) continue;
      out.push({
        kind: 'double-bottom',
        bias: 'bullish',
        confidence: Math.max(0.4, 1 - diff * 10),
        label: 'Double bottom',
        lines: [
          { from: { time: bars[lo1.index]!.time, price: lo1.price }, to: { time: bars[lo2.index]!.time, price: lo2.price } },
        ],
      });
    }
  }

  // Trendlines through first/last pivot of each kind.
  if (highs.length >= 2) {
    const f = highs[0]!;
    const l = highs[highs.length - 1]!;
    out.push({
      kind: 'trendline-resistance',
      bias: l.price < f.price ? 'bearish' : 'neutral',
      confidence: 0.5,
      label: 'Resistance trendline',
      lines: [{ from: { time: bars[f.index]!.time, price: f.price }, to: { time: bars[l.index]!.time, price: l.price } }],
    });
  }
  if (lows.length >= 2) {
    const f = lows[0]!;
    const l = lows[lows.length - 1]!;
    out.push({
      kind: 'trendline-support',
      bias: l.price > f.price ? 'bullish' : 'neutral',
      confidence: 0.5,
      label: 'Support trendline',
      lines: [{ from: { time: bars[f.index]!.time, price: f.price }, to: { time: bars[l.index]!.time, price: l.price } }],
    });
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/patterns.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/patterns.ts tests/shared/patterns.test.ts
git commit -m "feat(stocks): chart-pattern detection (double-bottom + trendlines)"
```

---

## Task 6: Signal synthesis

**Files:**
- Create: `src/shared/signal.ts`
- Test: `tests/shared/signal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/signal.test.ts
import { describe, it, expect } from 'vitest';
import { synthesize, type Factor } from '../../src/shared/signal';

function f(key: Factor['key'], score: number, weight: number): Factor {
  return { key, score, weight, note: '' };
}

describe('synthesize', () => {
  it('calls a unanimous bullish set a buy with high confidence', () => {
    const r = synthesize([f('trend', 1, 1), f('momentum', 1, 1), f('fundamentals', 1, 1)]);
    expect(r.direction).toBe('buy');
    expect(r.confidence).toBeGreaterThan(0.7);
  });
  it('lowers confidence when factors conflict', () => {
    const agree = synthesize([f('trend', 1, 1), f('momentum', 1, 1)]);
    const conflict = synthesize([f('trend', 1, 1), f('momentum', -1, 1)]);
    expect(conflict.confidence).toBeLessThan(agree.confidence);
  });
  it('does not let a lone pattern override an opposing trend', () => {
    // strong bearish trend (heavy), single bullish pattern (light)
    const r = synthesize([f('trend', -1, 2), f('momentum', -1, 2), f('pattern', 1, 1)]);
    expect(r.direction).not.toBe('buy');
  });
  it('defaults missing factors to nothing (neutral hold on empty)', () => {
    expect(synthesize([]).direction).toBe('hold');
  });
  it('derives drift with the same sign as the composite', () => {
    expect(synthesize([f('trend', 1, 1)]).drift).toBeGreaterThan(0);
    expect(synthesize([f('trend', -1, 1)]).drift).toBeLessThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/signal.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/signal.ts
// Pure multi-factor synthesis. Patterns are ONE weighted factor among many — no
// single factor decides. Output drives the signal card and forecast drift.

export type Direction = 'buy' | 'hold' | 'sell';

export type FactorKey =
  | 'trend'
  | 'momentum'
  | 'volatility'
  | 'levels'
  | 'volume'
  | 'pattern'
  | 'fundamentals'
  | 'sentiment';

export interface Factor {
  key: FactorKey;
  score: number; // -1..+1
  weight: number; // >= 0
  note: string;
}

export interface SignalResult {
  direction: Direction;
  confidence: number; // 0..1
  composite: number; // -1..+1
  factors: Factor[];
  drift: number; // per-bar drift for forecast.ts
}

const BUY_THRESHOLD = 0.25;
const DRIFT_SCALE = 0.005; // composite of 1 => 0.5% per-bar drift fraction-of-price proxy

export function synthesize(factors: Factor[]): SignalResult {
  const totalWeight = factors.reduce((a, f) => a + Math.max(0, f.weight), 0);
  if (totalWeight === 0) {
    return { direction: 'hold', confidence: 0, composite: 0, factors, drift: 0 };
  }
  const composite = factors.reduce((a, f) => a + clamp(f.score) * Math.max(0, f.weight), 0) / totalWeight;

  // Agreement: 1 when all factors point the same way, lower when they conflict.
  const weightedAbs = factors.reduce((a, f) => a + Math.abs(clamp(f.score)) * Math.max(0, f.weight), 0) / totalWeight;
  const agreement = weightedAbs === 0 ? 0 : Math.abs(composite) / weightedAbs;
  const confidence = clampUnit(Math.abs(composite) * 0.5 + agreement * 0.5);

  const direction: Direction =
    composite >= BUY_THRESHOLD ? 'buy' : composite <= -BUY_THRESHOLD ? 'sell' : 'hold';

  return { direction, confidence, composite, factors, drift: composite * DRIFT_SCALE };
}

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
function clampUnit(v: number): number {
  return Math.min(1, Math.max(0, v));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/signal.test.ts`
Expected: PASS.

Note: `drift` here is a price-fraction proxy; the agent multiplies it by `lastClose` before
passing to `forecastCone` so `drift` is in absolute price units. Document this in the Phase-2 agent
prompt (out of scope for this task).

- [ ] **Step 5: Commit**

```bash
git add src/shared/signal.ts tests/shared/signal.test.ts
git commit -m "feat(stocks): multi-factor signal synthesis"
```

---

## Task 7: Market-data service (Stooq + cache)

**Files:**
- Create: `src/main/services/market-data.ts`
- Test: `tests/main/services/market-data.test.ts`

- [ ] **Step 1: Write the failing test** (mocks global `fetch`; uses a temp dir for cache)

```ts
// tests/main/services/market-data.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarketDataService, MarketDataError, normalizeSymbol } from '../../../src/main/services/market-data';

const CSV = `Date,Open,High,Low,Close,Volume
2024-01-02,10,11,9,10.5,1000
2024-01-03,10.5,12,10,11.5,1200
2024-01-04,11.5,12.5,11,12,900`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mkt-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('normalizeSymbol', () => {
  it('appends .us to a bare US ticker, passes through suffixed/index/forex', () => {
    expect(normalizeSymbol('AAPL')).toBe('aapl.us');
    expect(normalizeSymbol('^spx')).toBe('^spx');
    expect(normalizeSymbol('eurusd')).toBe('eurusd');
    expect(normalizeSymbol('aapl.us')).toBe('aapl.us');
  });
});

describe('MarketDataService.history', () => {
  it('parses Stooq CSV into oldest->newest bars', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(CSV, { status: 200 })));
    const svc = new MarketDataService({ cacheDir: dir });
    const bars = await svc.history('AAPL', '1y');
    expect(bars).toHaveLength(3);
    expect(bars[0]!.close).toBe(10.5);
    expect(bars[2]!.high).toBe(12.5);
  });

  it('serves the second call from cache (fetch called once)', async () => {
    const spy = vi.fn(async () => new Response(CSV, { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const svc = new MarketDataService({ cacheDir: dir });
    await svc.history('AAPL', '1y');
    await svc.history('AAPL', '1y');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('throws unknown-symbol when Stooq returns the no-data marker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('No data', { status: 200 })));
    const svc = new MarketDataService({ cacheDir: dir });
    await expect(svc.history('NOPE', '1y')).rejects.toBeInstanceOf(MarketDataError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/services/market-data.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/main/services/market-data.ts
// Fetches OHLCV from Stooq (CSV, no key) with a small disk cache. Optional
// Alpha Vantage path activates when an apiKey is provided. Pure-ish: all IO is
// fetch + fs; injectable cacheDir keeps it testable.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Bar, Range, Quote } from '@shared/market-types';
import { RANGE_DAYS } from '@shared/market-types';

export type MarketErrorKind = 'unknown-symbol' | 'rate-limited' | 'network' | 'parse';

export class MarketDataError extends Error {
  constructor(
    public readonly kind: MarketErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'MarketDataError';
  }
}

/** Bare US tickers get `.us`; symbols with a suffix, index (^) or forex/crypto pass through. */
export function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();
  if (s.startsWith('^')) return s;
  if (s.includes('.')) return s;
  if (/^[a-z]{6}$/.test(s)) return s; // forex like eurusd / crypto like btcusd
  return `${s}.us`;
}

const HISTORY_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const QUOTE_TTL_MS = 5 * 60 * 1000; // 5m

interface CacheEnvelope<T> {
  fetchedAt: number;
  data: T;
}

export interface MarketDataOptions {
  cacheDir: string;
  alphaVantageKey?: string;
}

export class MarketDataService {
  constructor(private readonly opts: MarketDataOptions) {
    mkdirSync(opts.cacheDir, { recursive: true });
  }

  async history(symbol: string, range: Range): Promise<Bar[]> {
    const sym = normalizeSymbol(symbol);
    const cacheFile = join(this.opts.cacheDir, `stooq-${sym}-${range}.json`);
    const cached = this.readCache<Bar[]>(cacheFile, HISTORY_TTL_MS);
    if (cached) return cached;

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
    const text = await this.fetchText(url);
    const bars = this.parseStooqCsv(text);
    const sliced = this.sliceRange(bars, range);
    this.writeCache(cacheFile, sliced);
    return sliced;
  }

  async quote(symbol: string): Promise<Quote> {
    const sym = normalizeSymbol(symbol);
    const cacheFile = join(this.opts.cacheDir, `quote-${sym}.json`);
    const cached = this.readCache<Quote>(cacheFile, QUOTE_TTL_MS);
    if (cached) return cached;
    const bars = await this.history(symbol, '1m');
    if (bars.length < 1) throw new MarketDataError('unknown-symbol', `no data for ${symbol}`);
    const last = bars[bars.length - 1]!;
    const prev = bars[bars.length - 2] ?? last;
    const change = last.close - prev.close;
    const quote: Quote = {
      symbol: sym,
      price: last.close,
      change,
      changePct: prev.close === 0 ? 0 : (change / prev.close) * 100,
      asOf: new Date().toISOString(),
    };
    this.writeCache(cacheFile, quote);
    return quote;
  }

  private async fetchText(url: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'flowstate-stocks/0.1' } });
    } catch (err) {
      throw new MarketDataError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 429) throw new MarketDataError('rate-limited', 'provider rate-limited');
    if (!res.ok) throw new MarketDataError('network', `HTTP ${res.status}`);
    return res.text();
  }

  private parseStooqCsv(text: string): Bar[] {
    const trimmed = text.trim();
    if (!/^date,/i.test(trimmed)) {
      throw new MarketDataError('unknown-symbol', 'no data (symbol not found or no history)');
    }
    const lines = trimmed.split(/\r?\n/).slice(1);
    const bars: Bar[] = [];
    for (const line of lines) {
      const [date, open, high, low, close, volume] = line.split(',');
      if (!date || close === undefined) continue;
      const b: Bar = {
        time: date,
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume ?? 0),
      };
      if ([b.open, b.high, b.low, b.close].some((n) => Number.isNaN(n))) continue;
      bars.push(b);
    }
    if (bars.length === 0) throw new MarketDataError('parse', 'no parseable rows');
    return bars; // Stooq returns oldest->newest already
  }

  private sliceRange(bars: Bar[], range: Range): Bar[] {
    const days = RANGE_DAYS[range];
    if (!Number.isFinite(days)) return bars;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return bars.filter((b) => new Date(b.time).getTime() >= cutoff);
  }

  private readCache<T>(file: string, ttl: number): T | null {
    if (!existsSync(file)) return null;
    try {
      const env = JSON.parse(readFileSync(file, 'utf8')) as CacheEnvelope<T>;
      if (Date.now() - env.fetchedAt > ttl) return null;
      return env.data;
    } catch {
      return null;
    }
  }

  private writeCache<T>(file: string, data: T): void {
    try {
      writeFileSync(file, JSON.stringify({ fetchedAt: Date.now(), data } satisfies CacheEnvelope<T>));
    } catch {
      // cache write is best-effort
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/services/market-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/market-data.ts tests/main/services/market-data.test.ts
git commit -m "feat(stocks): market-data service (Stooq CSV + disk cache)"
```

---

## Task 8: `stock_data` agent tool

**Files:**
- Modify: `src/main/agent/tool-specs.ts` (add spec + register)
- Modify: `src/main/agent/tool-dispatcher.ts` (add schema + case)
- Test: `tests/main/agent/stock-data-tool.test.ts`

- [ ] **Step 1: Add the tool spec** in `src/main/agent/tool-specs.ts` — insert after `WEB_SEARCH_TOOL_SPEC` (around line 111):

```ts
export const STOCK_DATA_TOOL_SPEC: ToolSpec = {
  name: 'stock_data',
  description:
    'Fetch real OHLCV price history for a stock/ETF/index/forex/crypto symbol plus computed technical indicators and detected chart patterns. Use this for any market analysis — never guess prices. Returns JSON {symbol, range, bars, indicators, patterns, quote}. Symbols: US tickers like AAPL, indices like ^spx, forex like eurusd, crypto like btcusd.',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker, e.g. AAPL, ^spx, eurusd, btcusd.' },
      range: { type: 'string', enum: ['1m', '3m', '6m', '1y', '2y', '5y', 'max'], description: 'History window. Default 1y.' },
      indicators: {
        type: 'array',
        items: { type: 'string', enum: ['rsi', 'macd', 'atr', 'bollinger', 'sma', 'ema', 'patterns'] },
        description: 'Which indicators/patterns to compute. Default: rsi, macd, atr.',
      },
    },
    required: ['symbol'],
  },
};
```

- [ ] **Step 2: Register it** in `getToolSpecsForAgent` in the same file — add after the `WEB_SEARCH_TOOL_SPEC` push (line 234):

```ts
  result.push(STOCK_DATA_TOOL_SPEC);
```

- [ ] **Step 3: Wire the dispatcher** in `src/main/agent/tool-dispatcher.ts`.

3a. Add imports near the top (after the `model-3d` import, line 19):

```ts
import { MarketDataService } from '@main/services/market-data';
import { app } from 'electron';
import { join } from 'node:path';
import { rsi, macd, atr, bollinger, sma, ema, swingLevels, trend } from '@shared/indicators';
import { detectPatterns } from '@shared/patterns';
import type { Range } from '@shared/market-types';
```

3b. Add the zod schema to `argsSchemas` (after `web_search`, line 60):

```ts
  stock_data: z.object({
    symbol: z.string().min(1).max(20),
    range: z.enum(['1m', '3m', '6m', '1y', '2y', '5y', 'max']).optional(),
    indicators: z.array(z.enum(['rsi', 'macd', 'atr', 'bollinger', 'sma', 'ema', 'patterns'])).optional(),
  }),
```

3c. Add a lazily-constructed service field on the class (after `private lastCheckpointTs = 0;`, line 105):

```ts
  private marketData?: MarketDataService;
  private getMarketData(): MarketDataService {
    if (!this.marketData) {
      const cacheDir = join(app.getPath('userData'), 'market-cache');
      this.marketData = new MarketDataService({ cacheDir });
    }
    return this.marketData;
  }
```

3d. Add the switch case (after the `web_search` case, around line 279):

```ts
        case 'stock_data': {
          const a = parsed.data as z.infer<typeof argsSchemas.stock_data>;
          try {
            const range = (a.range ?? '1y') as Range;
            const bars = await this.getMarketData().history(a.symbol, range);
            const want = new Set(a.indicators ?? ['rsi', 'macd', 'atr']);
            const closes = bars.map((b) => b.close);
            const indicators: Record<string, unknown> = {};
            if (want.has('rsi')) indicators.rsi = lastDefined(rsi(bars, 14));
            if (want.has('macd')) {
              const m = macd(bars);
              indicators.macd = m[m.length - 1] ?? null;
            }
            if (want.has('atr')) indicators.atr = lastDefined(atr(bars, 14));
            if (want.has('bollinger')) {
              const b = bollinger(bars);
              indicators.bollinger = b[b.length - 1] ?? null;
            }
            if (want.has('sma')) indicators.sma = lastDefined(sma(closes, 20));
            if (want.has('ema')) indicators.ema = lastDefined(ema(closes, 20));
            const swings = swingLevels(bars);
            const patterns = want.has('patterns') ? detectPatterns(bars, swings) : undefined;
            const last = bars[bars.length - 1];
            return ok(
              toolCallId,
              name,
              JSON.stringify({
                symbol: a.symbol,
                range,
                trend: trend(bars),
                bars: bars.slice(-400),
                indicators,
                swingLevels: swings,
                ...(patterns ? { patterns } : {}),
                quote: last ? { price: last.close, asOf: last.time } : null,
              }),
            );
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
```

3e. Add the helper near the bottom of the file (after `serializeResult`, ~line 447):

```ts
function lastDefined<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i] as T;
  return null;
}
```

- [ ] **Step 4: Write the test** — exercises the dispatcher path with a mocked service.

```ts
// tests/main/agent/stock-data-tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// electron's app.getPath is needed by the lazy service constructor path; stub it.
vi.mock('electron', () => ({ app: { getPath: () => '.' } }));
// Stub the market-data service so no network/disk is touched.
const sampleBars = Array.from({ length: 40 }, (_, i) => ({
  time: `2024-02-${String(i + 1).padStart(2, '0')}`,
  open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000,
}));
vi.mock('../../../src/main/services/market-data', () => ({
  MarketDataService: class {
    async history() { return sampleBars; }
  },
}));

import { ToolDispatcher } from '../../../src/main/agent/tool-dispatcher';

function makeDispatcher(): ToolDispatcher {
  // Minimal deps — stock_data needs none of the file/approval plumbing.
  return new ToolDispatcher({ fileTools: {} as never, workspaceRoot: '.' });
}

describe('stock_data tool', () => {
  let d: ToolDispatcher;
  beforeEach(() => { d = makeDispatcher(); });

  it('returns bars + requested indicators as JSON', async () => {
    const res = await d.call('c1', 'stock_data', { symbol: 'AAPL', range: '1y', indicators: ['rsi', 'patterns'] });
    expect(res.ok).toBe(true);
    const json = JSON.parse(res.content);
    expect(json.symbol).toBe('AAPL');
    expect(json.bars.length).toBe(40);
    expect(json.indicators.rsi).not.toBeUndefined();
    expect(json.trend).toBe('up');
    expect(Array.isArray(json.patterns)).toBe(true);
  });

  it('rejects an empty symbol with an ERROR string', async () => {
    const res = await d.call('c2', 'stock_data', { symbol: '' });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/^ERROR:/);
  });
});
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run tests/main/agent/stock-data-tool.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent/tool-specs.ts src/main/agent/tool-dispatcher.ts tests/main/agent/stock-data-tool.test.ts
git commit -m "feat(stocks): stock_data agent tool (prices + indicators + patterns)"
```

---

## Task 9: `stocks` entitlement key

**Files:**
- Modify: `src/shared/entitlements.ts` (add key + min tier)
- Modify: `tests/shared/entitlements.test.ts` (assert gating)

- [ ] **Step 1: Add the failing assertion** in `tests/shared/entitlements.test.ts` inside the existing `describe('feature gating', ...)` block:

```ts
  it('gates stocks at pro', () => {
    expect(isFeatureAllowed('free', 'stocks')).toBe(false);
    expect(isFeatureAllowed('pro', 'stocks')).toBe(true);
    expect(isFeatureAllowed('power', 'stocks')).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/shared/entitlements.test.ts`
Expected: FAIL — TS error / `stocks` not assignable to `FeatureKey`.

- [ ] **Step 3: Add the key** in `src/shared/entitlements.ts`. In the `FeatureKey` union add `| 'stocks'`, and in `FEATURE_MIN_TIER` add `stocks: 'pro',`:

```ts
// in the FeatureKey union, alongside the others:
  | 'teamRun'
  | 'stocks';

// in FEATURE_MIN_TIER:
  teamRun: 'power',
  stocks: 'pro',
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/shared/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/entitlements.ts tests/shared/entitlements.test.ts
git commit -m "feat(stocks): add 'stocks' entitlement key (pro)"
```

---

## Task 10: Full suite + typecheck gate

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — all existing tests plus the six new files (indicators, trade-math, forecast, patterns, signal, market-data, stock-data-tool, entitlements).

- [ ] **Step 2: Typecheck the whole project**

Run: `npm run typecheck`
Expected: PASS (no errors in node or web tsconfig).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS (fix any new-file lint errors before finishing).

- [ ] **Step 4: Final commit (if lint/typecheck required fixes)**

```bash
git add -A
git commit -m "chore(stocks): phase 1 lint + typecheck clean"
```

---

## Done criteria for Phase 1

- `src/shared/{indicators,trade-math,forecast,patterns,signal,market-types}.ts` exist, pure, tested.
- `src/main/services/market-data.ts` fetches + caches Stooq data, tested with mocked fetch.
- `stock_data` agent tool is registered and returns prices + indicators + patterns.
- `stocks` entitlement key gates at `pro`.
- `npm test`, `npm run typecheck`, `npm run lint` all green.

Phase 2 (analyst seed agents) and Phase 3 (Stocks screen) follow as their own plans, built on these
units. `signal.synthesize()`, `forecastCone()`, `trade-math`, and `detectPatterns()` are the shared
contracts those phases consume.

---

## Self-review notes

- **Spec coverage:** indicators, trade-math, forecast, patterns, signal, market-data, stock_data
  tool, entitlement — all Phase-1 spec units have a task. Pattern catalog intentionally narrowed to
  double-bottom + trendlines for Phase 1 (noted in Task 5); richer patterns deferred to Phase 2 with
  the agent in the loop — this is the one deliberate scope trim from the spec's full `PatternKind` list.
- **Type consistency:** `Bar`/`Range`/`Quote` from `market-types`; `SwingLevels` consumed by
  `detectPatterns`; `Factor`/`SignalResult` stable across signal task + tests; `forecastCone` input
  matches the spec. `drift` units caveat documented in Task 6 for Phase 2.
- **No placeholders:** every code step is complete and runnable.
