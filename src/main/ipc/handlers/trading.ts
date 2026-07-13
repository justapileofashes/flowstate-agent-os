// IPC glue for the autonomous-trading panel on the Stocks screen. Thin over
// TradingService — connect/disconnect Alpaca keys, guardrail config, the
// autopilot toggle, manual cycle runs, and journal/strategy queries. All
// order paths live in the service behind the shared risk gate.
import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { TradingService } from '@main/services/trading-service';

export function registerTradingHandlers(deps: { trading: TradingService }): void {
  const { trading } = deps;

  ipcMain.handle(CHANNELS.TRADING_STATUS, () => trading.status());

  ipcMain.handle(CHANNELS.TRADING_CONNECT, async (_e, raw) => {
    const { keyId, secret, paper } = schemas.tradingConnectRequest.parse(raw);
    return trading.connect(keyId, secret, paper);
  });

  ipcMain.handle(CHANNELS.TRADING_DISCONNECT, () => {
    trading.disconnect();
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TRADING_LIVE_ACK, (_e, raw) => {
    const { ack } = schemas.tradingLiveAckRequest.parse(raw);
    trading.setLiveAck(ack);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TRADING_ACCOUNT, async () => {
    const account = await trading.account();
    return { ...account, dayStats: trading.dayStats() };
  });

  ipcMain.handle(CHANNELS.TRADING_GUARDRAILS_SET, (_e, raw) => {
    const patch = schemas.tradingGuardrailsSetRequest.parse(raw);
    return { guardrails: trading.setGuardrails({ ...trading.guardrails(), ...patch }) };
  });

  ipcMain.handle(CHANNELS.TRADING_AUTOPILOT, (_e, raw) => {
    const { enabled } = schemas.tradingAutopilotRequest.parse(raw);
    if (enabled && !trading.isConfigured()) {
      return { ok: false, error: 'Connect Alpaca API keys first' };
    }
    trading.setAutopilot(enabled);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TRADING_RUN_CYCLE, async () => {
    try {
      return { ok: true, report: await trading.runCycle() };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.TRADING_TRADES, (_e, raw) => {
    const { limit } = schemas.tradingTradesRequest.parse(raw ?? {});
    return {
      trades: trading.trades(limit ?? 100).map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        entryPrice: t.entryPrice,
        stoploss: t.stoploss,
        takeProfit: t.takeProfit,
        exitPrice: t.exitPrice,
        status: t.status,
        outcome: t.outcome,
        pnl: t.pnl,
        strategyId: t.strategyId,
        review: t.review,
        paper: t.paper,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
      })),
      lessons: trading.recentLessons(10),
    };
  });

  ipcMain.handle(CHANNELS.TRADING_STRATEGIES, () => ({
    strategies: trading.strategies().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      inspiration: s.inspiration,
      status: s.status,
      wins: s.wins,
      losses: s.losses,
      totalPnl: s.totalPnl,
      lessons: s.lessons,
      params: s.params,
    })),
  }));

  ipcMain.handle(CHANNELS.TRADING_STRATEGY_STATUS, (_e, raw) => {
    const { id, status } = schemas.tradingStrategyStatusRequest.parse(raw);
    trading.setStrategyStatus(id, status);
    return { ok: true };
  });
}
