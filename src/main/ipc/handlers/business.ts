// IPC glue for the business agent. Thin over BusinessAgentService: wires the
// OS keychain (vault KEK), desktop notifications, broadcast to all windows,
// and the app-wide usage meter, then serves every RPC method on one channel.
// Export is handled here because it needs a folder picker.

import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { ZodError } from 'zod';
import { CHANNELS } from '@shared/ipc-channels';
import type { BizEvent, BizMethod } from '@shared/business/api';
import type { SettingsService } from '@main/services/settings-service';
import type { LLMProvider } from '@main/agent/llm-provider';
import type { McpManager } from '@main/services/mcp-manager';
import { BusinessAgentService } from '@main/business/service';
import { electronKeyWrapper } from '@main/business/crypto/vault';
import { exportCompany } from '@main/business/export';
import { recordUsage } from './usage';

function errorMessage(err: unknown): string {
  if (err instanceof ZodError) {
    return `invalid request: ${err.errors.map((e) => `${e.path.join('.') || 'params'}: ${e.message}`).join('; ')}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function registerBusinessHandlers(deps: {
  db: Database;
  settings: SettingsService;
  provider: LLMProvider;
  mcpManager?: McpManager;
}): BusinessAgentService {
  const broadcast = (ev: BizEvent): void => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CHANNELS.BUSINESS_EVENT, ev);
  };
  const desktopNotify = (title: string, body: string): void => {
    if (deps.settings.get('notifications_enabled') === 'false' || !Notification.isSupported()) return;
    const win = BrowserWindow.getAllWindows()[0];
    if (win && win.isFocused() && !win.isMinimized()) return; // the live feed already shows it
    const n = new Notification({ title, body });
    n.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      if (w.isMinimized()) w.restore();
      w.focus();
    });
    n.show();
  };

  const service = new BusinessAgentService({
    raw: deps.db,
    provider: deps.provider,
    settings: deps.settings,
    keyWrapper: electronKeyWrapper(),
    ...(deps.mcpManager ? { mcp: deps.mcpManager } : {}),
    ollamaHost: () => deps.settings.get('ollama_host') ?? 'http://localhost:11434',
    openaiKey: () => deps.settings.get('openai_api_key') ?? '',
    desktopNotify,
    broadcast,
    recordGlobalUsage: (row) => recordUsage(row),
    legacyDir: join(app.getPath('userData'), 'business'),
  });
  void service
    .init()
    .then(() => service.start())
    .catch((err) => console.warn('[business] init failed:', err));
  app.on('before-quit', () => service.stop());

  async function exportToFolder(companyId: string): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> {
    const company = service.db.companies.get(companyId);
    if (!company) return { ok: false, error: 'unknown company' };
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const pick = await (win
      ? dialog.showOpenDialog(win, { title: 'Export company data', properties: ['openDirectory', 'createDirectory'] })
      : dialog.showOpenDialog({ title: 'Export company data', properties: ['openDirectory', 'createDirectory'] }));
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    const slug = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';
    const dir = join(pick.filePaths[0], `${slug}-export-${new Date().toISOString().slice(0, 10)}`);
    const { json, csv } = exportCompany(service.db, companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'company.json'), JSON.stringify(json, null, 2), 'utf8');
    for (const [name, body] of Object.entries(csv)) writeFileSync(join(dir, name), body, 'utf8');
    service.db.ops.audit({ companyId, actorType: 'user', actorId: 'owner', action: 'companies.export', resourceType: 'company', resourceId: companyId, metadata: { dir } });
    return { ok: true, path: dir };
  }

  ipcMain.handle(CHANNELS.BUSINESS_RPC, async (_e, raw: unknown) => {
    const req = (raw ?? {}) as { method?: unknown; params?: unknown };
    const method = typeof req.method === 'string' ? (req.method as BizMethod) : null;
    if (!method) return { ok: false, error: 'missing method' };
    try {
      if (method === 'companies.export') {
        const p = (req.params ?? {}) as { companyId?: unknown };
        if (typeof p.companyId !== 'string') return { ok: false, error: 'companyId required' };
        return { ok: true, data: await exportToFolder(p.companyId) };
      }
      return { ok: true, data: await service.handle(method, req.params) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  return service;
}
