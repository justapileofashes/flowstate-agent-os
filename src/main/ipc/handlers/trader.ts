// IPC glue for the AI Trader. Thin over TraderService: injects the data dir,
// desktop notifications, broadcast to all windows and the app-wide usage
// meter, then serves every RPC method on one channel with structured errors.

import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import { join } from 'node:path';
import { ZodError } from 'zod';
import type { Database } from 'better-sqlite3';
import { CHANNELS } from '@shared/ipc-channels';
import type { TraderError, TraderEvent, TraderMethod } from '@shared/trader/api';
import type { SettingsService } from '@main/services/settings-service';
import type { LLMProvider } from '@main/agent/llm-provider';
import { TraderService, TraderRpcError, setTraderService } from '@main/trader/service';
import { duckDuckGoSearch } from '@main/services/web-search';
import { recordUsage } from './usage';

function toError(err: unknown): TraderError {
  if (err instanceof TraderRpcError) return { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) };
  if (err instanceof ZodError) return { code: 'bad_request', message: err.errors.map((e) => `${e.path.join('.') || 'params'}: ${e.message}`).join('; ') };
  return { code: 'internal', message: err instanceof Error ? err.message : String(err) };
}

export function registerTraderHandlers(deps: { db: Database; settings: SettingsService; provider: LLMProvider }): TraderService {
  const broadcast = (ev: TraderEvent): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CHANNELS.TRADER_EVENT, ev);
  };
  const desktopNotify = (title: string, body: string): void => {
    if (deps.settings.get('notifications_enabled') === 'false' || !Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      if (w.isMinimized()) w.restore();
      w.focus();
    });
    n.show();
  };

  const service = new TraderService({
    raw: deps.db,
    settings: deps.settings,
    provider: deps.provider,
    dataDir: join(app.getPath('userData'), 'trader'),
    broadcast,
    desktopNotify,
    recordGlobalUsage: (row) => recordUsage(row),
    news: async (symbol) => (await duckDuckGoSearch(`${symbol} stock news`, 5)).map((h) => h.title),
  });
  setTraderService(service);
  void service
    .init()
    .then(() => service.start())
    .catch((err) => console.warn('[trader] init failed:', err));
  app.on('before-quit', () => void service.stop());

  ipcMain.handle(CHANNELS.TRADER_RPC, async (_e, raw: unknown) => {
    const req = (raw ?? {}) as { method?: unknown; params?: unknown };
    const method = typeof req.method === 'string' ? (req.method as TraderMethod) : null;
    if (!method) return { ok: false, error: { code: 'bad_request', message: 'missing method' } };
    try {
      return { ok: true, data: await service.handle(method, req.params) };
    } catch (err) {
      return { ok: false, error: toError(err) };
    }
  });

  return service;
}
