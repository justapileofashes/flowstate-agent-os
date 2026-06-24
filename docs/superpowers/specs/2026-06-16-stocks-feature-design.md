# Stocks: research, analysis, prediction + visuals — Design

Date: 2026-06-16
Status: approved (Phase 1 ready to plan)

## Goal

Add the ability to research, analyse, and predict stocks (and other assets), show
**when to buy**, **where to set stoploss / take-profit**, and render the analysis as
**visual charts in the View UI**. Delivered as three independent, ship-able phases.

## Non-negotiable framing

This is **educational analysis, not financial advice**. It is enforced, not assumed:

- Every agent output and the Stocks screen carry a visible "Not financial advice" disclaimer.
- Agents never use the word "guaranteed" or promise returns.
- Every prediction must output: **signal**, **confidence**, **invalidation level (stoploss)**,
  **take-profit target(s) with reward:risk**, and the **assumptions** behind it.
- The forward forecast (projected path) is a model opinion, drawn as a scenario range, never a
  single certain line. It is always labeled with confidence and an "illustrative" caveat.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Data source | **Stooq** CSV (no key, default) + optional **Alpha Vantage** key in Settings for intraday |
| Markets | Everything Stooq covers: stocks, ETFs, indices (`^spx`), forex (`eurusd`), crypto (`btcusd`); CoinGecko can fill crypto gaps later |
| Tier gate | New `stocks` feature key at **pro** (tiers are `free | pro | power`) |
| Chart lib (screen) | **lightweight-charts** (TradingView, MIT, ~45kb) — new dependency |
| Chart in agent artifacts | Self-contained HTML via existing `design_artifact` → View/Artifact iframe |
| UI build | Backend + IPC + `ipc.ts` types written here; screen visuals via Claude Design handoff (`docs/claude-design-prompt-stocks.md`) |

## Architecture overview

```
Phase 1  Market-data backbone (no UI)
  MarketDataService ── Stooq CSV / Alpha Vantage ── disk cache
  indicators.ts (pure)        trade-math.ts (pure, shared)
  stock_data agent tool (open)   entitlement key 'stocks' (gate enforced P3)

Phase 2  Stock analyst agents (seed agents)
  Stock Researcher · Technical Analyst · Trade Strategist
  use: web_search + stock_data + run_code + design_artifact

Phase 3  Stocks screen (tab)
  ipc/handlers/stocks.ts ── STOCKS_QUOTE / HISTORY / ANALYZE / WATCHLIST_*
  ipc.stocks.* (renderer)     Stocks.tsx (lightweight-charts)
  risk calculator · signal card · watchlist · disclaimer banner
```

Build order is strict: **P1 → P2 → P3**. Each phase gets its own spec → plan → build cycle.
This document details Phase 1 to implementation depth; Phases 2–3 are scoped as roadmap and
will be expanded into their own specs when reached.

---

## Phase 1 — Market-data backbone (implementation-ready)

No UI. Pure backend + one agent tool. This is the foundation everything else stands on.

### Unit: `MarketDataService` — `src/main/services/market-data.ts`

What it does: fetches OHLCV price history and latest quote for a symbol, with caching.

Interface:

```ts
type Bar = { time: string; open: number; high: number; low: number; close: number; volume: number };
type Range = '1m' | '3m' | '6m' | '1y' | '2y' | '5y' | 'max';

interface MarketDataService {
  history(symbol: string, range: Range): Promise<Bar[]>;   // daily bars, oldest→newest
  quote(symbol: string): Promise<{ symbol: string; price: number; change: number; changePct: number; asOf: string }>;
}
```

- Default provider: **Stooq** — `https://stooq.com/q/d/l/?s=<sym>&i=d` returns CSV
  `Date,Open,High,Low,Close,Volume`. Parse, slice to the requested range.
- Symbol normalization (`normalizeSymbol`): US equity/ETF → `aapl.us`; index passthrough `^spx`;
  forex `eurusd`; crypto `btcusd`. A small mapping table + heuristics; unknown → try as-is.
- Optional **Alpha Vantage**: if `settings.get('alpha_vantage_key')` is set, use it for intraday
  ranges and richer quotes; otherwise Stooq only. Provider selection is internal, not exposed.
- **Cache**: `userData/market-cache/<provider>/<symbol>-<range>.json` with a stored `fetchedAt`.
  Daily bars TTL ~12h; quote TTL ~5m. Cache read is best-effort; on parse/IO error, refetch.
- Errors: typed `MarketDataError` with `kind: 'unknown-symbol' | 'rate-limited' | 'network' | 'parse'`.
  Politeness: serialize requests, single retry with backoff on `rate-limited`/`network`.

Depends on: `node:https`/`fetch`, `SettingsService` (for the optional key), `node:fs` (cache).

### Unit: `indicators.ts` — `src/main/services/indicators.ts`

Pure functions over `Bar[]` / `number[]`. No IO. The math core.

```ts
sma(values, period): (number|null)[]
ema(values, period): (number|null)[]
rsi(bars, period=14): (number|null)[]
macd(bars, fast=12, slow=26, signal=9): { macd; signal; histogram }[]
atr(bars, period=14): (number|null)[]
bollinger(bars, period=20, mult=2): { upper; mid; lower }[]
swingLevels(bars, lookback=10): { supports: number[]; resistances: number[] }   // pivot highs/lows
trend(bars): 'up' | 'down' | 'sideways'                                          // from EMA slope + structure
```

Fully unit-tested against known/golden values (hand-computed fixtures). Leading values are
`null` until the period warms up — callers must handle nulls.

### Unit: `trade-math.ts` — `src/shared/trade-math.ts`

Pure, **shared** (renderer + main) so agent output and the screen's risk calculator agree exactly.

```ts
positionSize({ account, riskPct, entry, stop }): { shares: number; riskAmount: number }
atrStop({ entry, atr, mult=1.5, side }): number                      // side: 'long'|'short'
takeProfits({ entry, stop, rMultiples=[1,2,3] }): number[]           // R-multiple targets
rewardRisk({ entry, stop, target }): number                          // R:R ratio
```

Guards: reject `entry === stop` (infinite size), negative inputs. Tested.

### Unit: `forecast.ts` — `src/shared/forecast.ts`

Pure, shared. Turns a direction + volatility into the **forward projection path** the chart draws.

```ts
type Scenario = 'bull' | 'base' | 'bear';
interface ForecastInput {
  lastClose: number;
  atr: number;           // recent ATR — volatility per bar
  drift: number;         // per-bar expected move (from trend/EMA slope), signed
  horizon: number;       // bars to project forward (e.g. 20)
  confidence: number;    // 0..1, from the agent/indicators
}
// base path = lastClose + drift*t ; bull/bear = base ± k(confidence)*atr*sqrt(t)
forecastCone(input: ForecastInput): Record<Scenario, { time: number; value: number }[]>
```

The cone **widens with time** (`atr*sqrt(t)`) — honest about growing uncertainty — and **narrows
with higher confidence**. The agent supplies `drift` + `confidence` (its opinion); the cone shape
comes from real ATR. Tested: monotonic widening, bull ≥ base ≥ bear, confidence narrows the band.

### Unit: `patterns.ts` — `src/shared/patterns.ts`

Pure, shared. Detects classic chart patterns from swing pivots and returns them as **drawable line
segments** so the chart can show the pattern, not just name it. Especially valued for crypto (heavy
technical-pattern trading), but runs for any asset.

```ts
type PatternKind =
  | 'trendline-support' | 'trendline-resistance' | 'channel'
  | 'triangle-ascending' | 'triangle-descending' | 'triangle-symmetrical'
  | 'double-top' | 'double-bottom' | 'head-shoulders' | 'wedge';
interface PatternLine { from: { time: string; price: number }; to: { time: string; price: number } }
interface DetectedPattern {
  kind: PatternKind;
  lines: PatternLine[];        // the segments to draw (e.g. two converging lines for a triangle)
  label: string;               // e.g. "Ascending triangle"
  confidence: number;          // 0..1 fit quality
  bias: 'bullish' | 'bearish' | 'neutral';
}
detectPatterns(bars: Bar[], pivots: { supports; resistances }): DetectedPattern[]
```

Built on `swingLevels` pivots: fit trendlines through consecutive pivot highs/lows (least-squares
+ touch count), then classify (converging → triangle/wedge, parallel → channel, two equal
pivots → double top/bottom, three-peak with lower shoulders → head-shoulders). Each returns the
exact endpoints to draw. Tested with synthetic fixtures (a hand-built ascending triangle, a
double-bottom, etc.) asserting kind + line endpoints + bias.

The `stock_data` tool gains an optional `'patterns'` indicator that returns `DetectedPattern[]`.

### Unit: `signal.ts` — `src/shared/signal.ts`

Pure, shared. The synthesis core: **patterns are one input among many**. Combines weighted factors
into a composite signal + confidence, so no single factor (least of all patterns) decides alone.

```ts
type Direction = 'buy' | 'hold' | 'sell';
interface Factor { key: FactorKey; score: number; weight: number; note: string } // score -1..+1
type FactorKey =
  | 'trend'        // EMA slope / price vs EMA stack
  | 'momentum'     // RSI + MACD histogram
  | 'volatility'   // ATR regime, Bollinger width/position
  | 'levels'       // proximity to support/resistance
  | 'volume'       // volume trend / confirmation
  | 'pattern'      // detected-pattern bias (one factor, weighted like the rest)
  | 'fundamentals' // the BUSINESS behind the ticker (see FundamentalsInput) — agent-supplied
  | 'sentiment';   // market mood: news flow, social/analyst tone — agent-supplied
interface SignalResult {
  direction: Direction;
  confidence: number;          // 0..1, from weighted agreement + factor dispersion
  composite: number;           // -1..+1 weighted sum
  factors: Factor[];           // every factor shown, so the user sees the full reasoning
  drift: number;               // per-bar drift for forecast.ts, derived from composite + ATR
}
synthesize(factors: Factor[]): SignalResult
```

- Technical factors (trend, momentum, volatility, levels, volume, pattern) are computed from
  `indicators.ts` + `patterns.ts`. `fundamentals` + `sentiment` are passed in by the agent from
  research — defaulting to neutral/zero weight if absent (e.g. a pure technical scan).

#### The `fundamentals` factor — the business behind the ticker

The Stock Researcher (Phase 2) builds a structured `FundamentalsInput` and scores it into the
`fundamentals` factor. This is the company/project itself, not its chart:

```ts
interface FundamentalsInput {
  health: {            // how the business is doing NOW
    revenueTrend?: 'rising'|'flat'|'falling'; profitable?: boolean;
    margins?: 'expanding'|'stable'|'compressing'; debtLoad?: 'low'|'moderate'|'high';
    cashRunwayNote?: string;
  };
  roadmap?: string[];     // future projects / product pipeline / catalysts ahead
  partners?: string[];    // key partnerships, customers, distribution deals
  supplyChain?: {         // materials / inputs for the product or service
    keyInputs?: string[]; risks?: string[]; // shortages, cost spikes, single-supplier exposure
  };
  competition?: 'leader'|'contender'|'laggard';
  sources: string[];      // every claim cited (web_search URLs, filings, Alpha Vantage OVERVIEW)
}
```

- Sourced from `web_search` (news, filings, product announcements, supplier reports) and, when an
  Alpha Vantage key is set, the `OVERVIEW` / `EARNINGS` endpoints for hard financials.
- For **crypto**, "the business" maps to the project/protocol: team + roadmap, tokenomics, treasury
  health, partnerships/integrations, and on-chain activity as the "supply chain / usage" analog.
- Every fundamental claim is **cited** (`sources`) and labeled FACT (sourced) vs ESTIMATE.
  Fundamentals shift the signal and confidence but, like patterns, cannot solely override a
  strongly opposing technical picture — they are weighted, shown, and explained.
- Confidence reflects **factor agreement**: aligned factors → high; conflicting → low. A lone
  bullish pattern against a bearish trend yields low confidence, not a buy.
- Output drives both the signal card and `forecast.ts` drift — the forecast follows the *whole*
  analysis, not the pattern.
- Tested: weighting math, conflicting factors lower confidence, pattern alone cannot flip the call.

The signal card (Phase 3) and the agent reply (Phase 2) both **list every factor with its score**,
so the user sees the full basis — technicals, levels, volume, pattern, and context — not a verdict.

### Chart visual contract (shared by Phase 2 artifact + Phase 3 screen)

Both the View-panel artifact (Technical Analyst's `design_artifact` HTML) and the Stocks-screen
chart render the **same layered picture** so they read identically:

1. **Historical candlesticks** (OHLC).
2. **Horizontal levels** — entry (neutral), stoploss (red), take-profit(s) (green), labeled.
3. **Forward forecast — explicit prediction lines.** Three distinct, labeled line series drawn
   forward from the last candle onto future x-slots:
   - **Base** (most-likely) — solid dashed, accent color, end-point dot + price label.
   - **Bull** (upside) — green dashed, end-point price label.
   - **Bear** (downside) — red dashed, end-point price label.
   A light shaded cone fills bull↔bear so the range reads at a glance, but the three lines are
   always individually visible — the user sees exactly where the AI thinks price goes in each case.
4. **Pattern lines** — detected chart patterns drawn as their defining segments over the candles:
   trendlines, channel rails, triangle/wedge converging lines, double-top/bottom necklines,
   head-&-shoulders neckline. Each segment labeled with the pattern name + bias (bullish/bearish).
   On by default for crypto symbols; toggled by an indicator panel control for any asset.
5. **Confidence % + "illustrative forecast, not advice"** label anchored on the projection.

Phase 2 emits this as self-contained HTML (inline SVG/canvas, no external lib) for the iframe.
Phase 3 renders it with `lightweight-charts` (candles + price lines + a line series per scenario).

### Unit: `stock_data` agent tool — `tool-specs.ts` + `tool-dispatcher.ts`

New `ToolSpec` added in `getToolSpecsForAgent` (available to all agents, like `web_search`):

```
name: stock_data
args: { symbol: string, range?: Range, indicators?: ('rsi'|'macd'|'atr'|'bollinger'|'sma'|'ema')[] }
returns (JSON string): { symbol, range, bars: Bar[], indicators: {...}, quote, meta }
```

- Dispatcher path computes requested indicators via `indicators.ts` and returns a compact JSON.
- **Gating**: the tool itself is open (public market data — like `web_search`). The paid `stocks`
  gate is enforced where it monetizes: the Stocks-screen IPC handlers (Phase 3) call
  `requireFeature('stocks')`. The entitlement key is still defined here in Phase 1.
- Bars capped (e.g. last 400) to keep tool payload reasonable.

### Unit: entitlement — `src/shared/entitlements.ts`

Add `stocks` to `FeatureKey` union and `FEATURE_MIN_TIER` as `stocks: 'pro'`. The
`entitlements.test.ts` snapshot/expectations update accordingly.

### Phase 1 tests

- `indicators.test.ts` — golden values for RSI/MACD/ATR/SMA/EMA/Bollinger; null warmup; swing pivots.
- `trade-math.test.ts` — position sizing, ATR stop both sides, R-multiple targets, R:R, guards.
- `forecast.test.ts` — cone widens monotonically, bull ≥ base ≥ bear, higher confidence narrows band.
- `patterns.test.ts` — synthetic fixtures (ascending triangle, double-bottom, channel, head-shoulders)
  assert detected kind, line endpoints, and bias.
- `signal.test.ts` — weighted composite math; conflicting factors lower confidence; a lone pattern
  cannot override an opposing trend; missing sentiment defaults neutral.
- `market-data.test.ts` — Stooq CSV parse from a fixture; range slicing; cache hit/miss/expiry;
  unknown-symbol error. Network mocked — no live calls in tests.
- `entitlements.test.ts` — `stocks` gated at pro.

---

## Phase 2 — Stock analyst agents (roadmap)

Append three agents to `SEED_AGENTS` (`src/main/seed-agents.ts`), grouped under a
"Stocks pack" comment block (exportable via existing agent-packs). Each carries the shared
disclaimer/output-contract prompt block.

1. **Stock Researcher** (`agent-stock-researcher`) — `web_search` + `stock_data`. Builds the
   structured **`FundamentalsInput`** for the business behind the ticker: current health (revenue,
   profitability, margins, debt), roadmap / future projects, partners, supply chain & input
   materials, competitive position — every claim cited. Also captures market sentiment. No price
   levels, no signal — it hands fundamentals + sentiment to the synthesis.
2. **Technical Analyst** (`agent-technical-analyst`) — `stock_data` with indicators →
   `run_code` to verify the math → `design_artifact` renders a **candlestick chart (HTML)** with
   **entry / stoploss / take-profit overlay lines** into the View/Artifact panel → states the
   signal + the reasoning behind each level.
   The analyst scores `fundamentals` + `sentiment` from the Researcher's brief into the synthesis,
   so the signal reflects both the chart and the business.
3. **Trade Strategist** (`agent-trade-strategist`) — synthesizes researcher + analyst into
   scenarios (bull/base/bear), an **ATR-based stoploss**, **R-multiple take-profits**, and
   **position sizing** via `trade-math`. Maximum disclaimers.

`shell_enabled: false` for all three (data + reasoning roles). Model: existing default.
Update `seed-agents.test.ts` count/expectations.

## Phase 3 — Stocks screen (roadmap)

- Nav tab **Stocks** in `App.tsx` + `Sidebar.tsx`, gated `stocks` (locked + upsell for free,
  reusing the paywall pattern).
- `src/main/ipc/handlers/stocks.ts` + channels in `src/shared/ipc-channels.ts`:
  `STOCKS_QUOTE`, `STOCKS_HISTORY`, `STOCKS_ANALYZE`, `STOCKS_WATCHLIST_GET`, `STOCKS_WATCHLIST_SET`.
  - `STOCKS_ANALYZE` runs the Technical Analyst headless on a symbol and returns
    `{ signal, confidence, factors[], fundamentals, entry, stoploss, takeProfit[], forecast: {bull,base,bear}, patterns[], rsi, macd, summary, chartHtml }`
    — `factors[]` is the full multi-factor breakdown and `fundamentals` the cited business brief,
    both surfaced in the signal card / a "Business" panel on the screen.
  - Watchlist persisted (settings or a small store file).
- `ipc.stocks.*` typed surface in `src/renderer/src/lib/ipc.ts` + preload bridge.
- `docs/claude-design-prompt-stocks.md` — Claude Design handoff for the screen visuals.
  I write the handoff + IPC + a minimal `Stocks.tsx` wiring; design paints the pixels.
- Screen surfaces: watchlist, symbol search, **candlestick chart with entry/SL/TP bands**
  (`lightweight-charts`), indicator panel, **Analyze** button (streams the agent), **signal card**
  (BUY / HOLD / SELL + confidence), **risk calculator** (account size + risk% → position size,
  stoploss, take-profits via `trade-math`), persistent **"Not financial advice"** banner.

## Error handling (cross-phase)

- Provider fetch failure → typed `MarketDataError`; tool returns `ERROR:` string; screen shows
  a retry affordance with the failure kind.
- Unknown symbol → clear "couldn't find <symbol>" message, never a silent empty chart.
- Rate limiting → cache-first + serialized requests + single backoff retry.
- Null indicator warmup values handled at every consumer (chart skips, agent notes "insufficient history").

## Out of scope (YAGNI for now)

Live streaming ticks, options/greeks, backtesting engine, portfolio P&L tracking, broker
order placement, real-money execution of any kind.
