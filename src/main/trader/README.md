# AI Trader — operator runbook

Design, reference systems and deviations from the source plan:
`docs/superpowers/specs/2026-09-24-ai-trader-design.md`.

## Where things live

| Concern | Code | Tables |
|---|---|---|
| Config-as-code (limits, symbols, thresholds) | `src/shared/trader/types.ts` (`traderConfigSchema`) | `trader_config_versions` |
| Data pipeline (Alpaca / Yahoo → validate → store + lake) | `data/` | `trader_bars`, `trader_ticks`, `trader_data_issues` |
| Feature store | `features/engine.ts` | `trader_features_latest` |
| Models (GBDT, trainer, registry, shadow) | `model/` | `trader_models`, `trader_shadow_scores`, `trader_shadow_evals` |
| Backtests + Simulation Mode | `backtest/` | `trader_backtests` + `userData/trader/reports/*.json|csv` |
| Signal generator (quant core) | `signals/core.ts` | `trader_signals` |
| Risk engine | `risk/` | decisions in `trader_audit.risk_decision` |
| OMS, brokers, kill switch | `execution/` | `trader_orders`, `trader_fills`, `trader_positions`, `trader_sim_accounts`, `trader_trades` |
| Orchestrator (tick graph) | `orchestrator/` | `trader_cycles`, `trader_audit` |
| Monitoring | `monitor/` | `trader_metrics`, `trader_equity`, `trader_alerts` |
| Switches (autopilot, kill, breaker, consent, mode, leases) | `service.ts` | `trader_state`, `trader_ops_log` |

## First run

1. Trading → AI Trader → accept the disclosure.
2. Models → **Backfill** 15m and 1h (Yahoo without a key; Alpaca with a market-data key), then **Train**.
   A model becomes active only if, on data it never saw, it beats buy-and-hold and the momentum rule, has AUC ≥ `minAuc` and ≥ 5 simulated trades. On real large-cap data this often fails — that is the gate working. The rejection reasons are shown per model.
3. Backtests → run an event-driven backtest and a Simulation.
4. Switch **AI trading on**. It trades the paper simulator; ticks run ~20 s after each closed bar of the smallest enabled timeframe while a market is open.

## Kill switch

Header → **Kill switch**:
- **Halt** — persists the halted state first, then cancels every open order on every account. Positions stay open.
- **Flatten** — halt + close every position (simulator fills immediately at last price minus slippage; brokers get market orders).

The autopilot is switched off and stays off until **Resume trading**. A kill in paper mode (or *Test the kill switch*) satisfies the go-live check for 30 days.

## Circuit breaker

Trips when today's loss (realized + unrealized, vs start-of-day equity) reaches `risk.dailyLossLimitPct`. Checked every tick and on every proposal. New entries are blocked for the rest of the ET trading day; exits and reconciliation continue. It clears automatically the next day.

## Going live (real money)

All of these, in order:
1. Code change: `LIVE_TRADING_BUILD_ENABLED = true` in `src/main/trader/config.ts`, rebuild.
2. ≥ 14 days of paper activity, ≥ 10 closed paper trades, paper drawdown within `maxOpenDrawdownPct`.
3. Risk limits ≤ 0.5 % per trade and ≤ 2 % daily loss.
4. Kill switch tested within 30 days.
5. Market-data key and a *different* live trading key, the live key verified.
6. Brokers & go-live → **Go live…** → type `TRADE LIVE`.

Live mode starts with the autopilot off. Every live entry is mirrored to the `shadow` simulator account so fills and slippage can be compared per trade (Orders & fills → shadow; Overview equity chart shows both).

## Models over time

- Nightly (`models.nightlyRetrainCron`, default 02:30 local, weekdays): incremental update — warm-starts the active model with recent bars + the replay buffer (features at entry + outcome of every closed trade). Evaluated only on bars the parent never saw.
- Weekly (`models.weeklyRetrainCron`, default Saturday 04:00): full retrain.
- A new model shadows the incumbent (scored every tick, never traded). After each US session the daily review compares log-loss on realized outcomes; `shadowDays` consecutive wins (default 3) plus beating the incumbent at training time → promoted. Three losing days or 10 days without qualifying → rejected (incumbent stays).
- Manual promotion (Models → Promote…, typed `PROMOTE`) is paper-only.

## Alerts

`data_gap` (a symbol's next bar is > `monitor.dataGapMs` late — that symbol is not traded), `fill_failures` (N consecutive failed/rejected orders), `model_drift` (live confidence shifted > `driftThresholdPct` vs the prior week, or PSI > 0.25), `circuit_breaker`, `cycle_aborted` / `cycle_aborts`, `broker_errors`, `kill_switch`, `live_enabled`. Delivered in-app, as desktop notifications (non-info) and to `monitor.webhookUrl` if set.

## Prometheus

Set `monitor.metricsHttpPort` (e.g. 9464) → `http://127.0.0.1:<port>/metrics` and `/healthz`. The Monitor tab charts the same series from `trader_metrics` without Prometheus.

## Troubleshooting

| Symptom | Look at |
|---|---|
| No signals | Monitor → Ticks → open the tick → quant node lists every symbol's reason (threshold, edge, disagreement, strategy, stale data). |
| Signal rejected | Signals → Audit: every risk rule's verdict; the first ✗ is the blocker. |
| Orders never fill (simulator) | Fills happen on the next bar after the order; entries expire after `signals.expiryBars`. |
| "market data unavailable" aborts | Yahoo rate-limits bursts; add an Alpaca market-data key or retry. |
| Tick skipped | Kill switch, circuit breaker, consent, market closed or live gate — the skip reason says which. |

Tests: `tests/main/trader/phase{1..6}-*.test.ts` (each phase's Definition of Done).
