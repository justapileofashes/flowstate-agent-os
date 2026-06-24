# Claude Design handoff — Stocks screen

Build the **Stocks** screen for the FlowState desktop app (Electron + React + Tailwind, dark
theme using the app's CSS vars: `--bg`, `--surface`, `--ink`, `--ink-muted`, `--ink-faint`,
`--accent`, `--good`, `--bad`, `--border`). Match the visual language of the existing Business and
Flowclaw screens. This screen lets a user research, analyse, and predict a stock/crypto/forex/ETF
symbol, see when to buy, where to put stoploss / take-profit, and view a candlestick chart with the
AI's forward forecast and detected patterns.

**This is educational analysis, NOT financial advice.** A persistent, visible disclaimer banner is
required on the screen at all times.

## Gating

Pro-tier feature. Reuse the existing paywall pattern (`useUpsell` / `LockBadge` from
`src/renderer/src/lib/paywall.tsx`, feature key `'stocks'`). Free users: show the screen chrome
with a locked overlay + upgrade CTA; do not call the IPC. Add a **Stocks** item to the left nav
(`Sidebar.tsx` / `App.tsx`) with a chart/candlestick icon, placed near Business.

## Data — all via the typed `ipc.stocks.*` surface (already implemented)

```ts
import { ipc } from '../lib/ipc';

ipc.stocks.getWatchlist(): Promise<{ symbols: string[] }>
ipc.stocks.setWatchlist(symbols: string[]): Promise<{ symbols: string[] }>
ipc.stocks.quote(symbol): Promise<{ symbol; price; change; changePct; asOf }>
ipc.stocks.history(symbol, range?): Promise<{ symbol; range; bars: Bar[] }>
//   Bar = { time, open, high, low, close, volume }
//   range = '1m'|'3m'|'6m'|'1y'|'2y'|'5y'|'max'
ipc.stocks.analyze({ symbol, range?, account?, riskPct?, horizon? }): Promise<StockAnalysisResponse>
```

`StockAnalysisResponse` (the heart of the screen):

```ts
{
  symbol; range; asOf; price;
  direction: 'buy' | 'hold' | 'sell';
  confidence: number;            // 0..1
  factors: { key; score; weight; note }[];   // key ∈ trend|momentum|volatility|levels|volume|pattern|fundamentals|sentiment
  entry; stoploss;
  takeProfit: number[];          // 1R/2R/3R targets
  rewardRisk: number;
  positionShares?: number;       // present when account+riskPct were passed
  rsi: number | null;
  macdHistogram: number | null;
  patterns: { kind; label; bias; confidence }[];
  chartHtml: string;             // a complete, self-contained HTML candlestick chart — see below
}
```

Errors: `analyze`/`quote`/`history` reject with an Error (e.g. unknown symbol, not enough history,
network). Catch and show an inline retry state with the message — never a blank chart.

## Layout

Three regions:

1. **Left: Watchlist** (~220px). List of symbols from `getWatchlist`. Each row: symbol + live
   `quote` price + colored change %. Add/remove symbols (input + ✕). Selecting a row loads it into
   the main panel. Persist edits via `setWatchlist`.

2. **Center: Chart + signal.**
   - Header: symbol, current price, change %, a range selector (1m/3m/6m/1y/2y/5y/max), an
     **Analyze** button.
   - **Chart:** render `chartHtml` inside a sandboxed `<iframe srcDoc={chartHtml} sandbox="allow-scripts">`
     exactly like `ViewPanel.tsx`'s artifact pane. The chart already contains all 5 layers:
     candlesticks, entry/SL/TP lines, the 3-line bull/base/bear forecast projected forward, pattern
     lines, and the confidence + "not advice" label. Do not re-draw it yourself.
     (Optionally, also keep an interactive `lightweight-charts` candlestick view for the raw
     `history` bars; the `chartHtml` is the source of truth for the analysis overlay.)
   - **Signal card:** big `direction` badge (BUY=green, SELL=red, HOLD=neutral) + confidence as a
     bar/percent. Below it: Entry, Stoploss, Take-profit (TP1/TP2/TP3), Reward:Risk — each a labeled
     stat. If `positionShares` present, show "Suggested size: N shares".

3. **Right (or below): Factors + Patterns + Risk calculator.**
   - **Factors:** list every `factors[]` row — name, a -1…+1 score shown as a diverging bar
     (red↔green), and the `note`. This is the "why", so the user sees it's not just one signal.
   - **Patterns:** chips for each detected pattern (`label` + `bias`-colored).
   - **Risk calculator:** inputs for account size + risk %. On change, re-call
     `analyze({ symbol, account, riskPct })` (debounced) so `positionShares` + levels update.

## Disclaimer (required)

A slim persistent banner, e.g. top or bottom of the screen:
> *Educational analysis from public data — not financial advice. Forecasts are illustrative
> scenarios, not predictions of actual price.*

## Interaction notes

- On selecting a symbol: call `quote` + `history` immediately for the header/chart; call `analyze`
  on demand (Analyze button) or auto on select — your call, but show a loading state.
- Debounce watchlist quote fetches; they can be lazy/sequential (the backend caches).
- Keep everything keyboard-accessible and responsive down to a narrow window.

## Out of scope

No broker/order placement, no real-money actions, no live streaming ticks. Read-only analysis.
