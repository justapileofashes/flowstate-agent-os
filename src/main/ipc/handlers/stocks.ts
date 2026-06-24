// IPC glue for the Stocks screen. Thin over the tested services: MarketDataService
// (Stooq fetch + cache) and analyzeSymbol (deterministic multi-factor analysis).
import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import { MarketDataService } from '@main/services/market-data';
import { analyzeSymbol } from '@main/services/stock-analysis';

const WATCHLIST_KEY = 'stocks_watchlist';
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'SPY', 'BTCUSD'];

export function registerStocksHandlers(deps: {
  settings: SettingsService;
}): void {
  const cacheDir = join(app.getPath('userData'), 'market-cache');
  const market = new MarketDataService({
    cacheDir,
    ...(deps.settings.get('alpha_vantage_key')
      ? { alphaVantageKey: deps.settings.get('alpha_vantage_key')! }
      : {}),
  });

  ipcMain.handle(CHANNELS.STOCKS_QUOTE, async (_e, raw) => {
    const { symbol } = schemas.stocksSymbolRequest.parse(raw);
    return market.quote(symbol);
  });

  ipcMain.handle(CHANNELS.STOCKS_HISTORY, async (_e, raw) => {
    const { symbol, range } = schemas.stocksSymbolRequest.parse(raw);
    const bars = await market.history(symbol, range ?? '1y');
    return { symbol, range: range ?? '1y', bars };
  });

  ipcMain.handle(CHANNELS.STOCKS_ANALYZE, async (_e, raw) => {
    const args = schemas.stocksAnalyzeRequest.parse(raw);
    const analysis = await analyzeSymbol(market, args.symbol, {
      ...(args.range ? { range: args.range } : {}),
      ...(args.account ? { account: args.account } : {}),
      ...(args.riskPct ? { riskPct: args.riskPct } : {}),
      ...(args.horizon ? { horizon: args.horizon } : {}),
    });
    // Trim the heavy forecast points off the IPC payload — the chart HTML already
    // bakes them in; the renderer reads levels + factors + chartHtml.
    const { forecast: _forecast, ...rest } = analysis;
    return rest;
  });

  ipcMain.handle(CHANNELS.STOCKS_WATCHLIST_GET, () => {
    const raw = deps.settings.get(WATCHLIST_KEY);
    if (!raw) return { symbols: DEFAULT_WATCHLIST };
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return { symbols: parsed as string[] };
      }
    } catch {
      // fall through to default
    }
    return { symbols: DEFAULT_WATCHLIST };
  });

  ipcMain.handle(CHANNELS.STOCKS_WATCHLIST_SET, (_e, raw) => {
    const { symbols } = schemas.stocksWatchlistSetRequest.parse(raw);
    const cleaned = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
    deps.settings.set(WATCHLIST_KEY, JSON.stringify(cleaned));
    return { symbols: cleaned };
  });
}
