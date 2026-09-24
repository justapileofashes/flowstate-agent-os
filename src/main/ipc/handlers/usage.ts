// Usage / cost meter — append-only JSON ledger of token usage per chat.
// Pricing lives in services/model-pricing (shared with the business agent).
// The renderer reads aggregated rows for a chat or all chats.

import { app, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import { summarizeUsage } from '@main/services/usage-summary';
import { costFor } from '@main/services/model-pricing';

interface UsageRow {
  chatId: string;
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  at: number;
}

class UsageStore {
  private rows: UsageRow[] = [];
  private readonly path: string;

  constructor() {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'usage.json');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return;
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.rows = parsed as UsageRow[];
    } catch {
      this.rows = [];
    }
  }

  private persist(): void {
    try {
      // Keep last 10k rows to bound file size.
      const tail = this.rows.length > 10_000 ? this.rows.slice(-10_000) : this.rows;
      writeFileSync(this.path, JSON.stringify(tail), 'utf8');
      this.rows = tail;
    } catch {
      // best-effort
    }
  }

  record(row: Omit<UsageRow, 'costUsd' | 'at'>): UsageRow {
    const at = Date.now();
    const costUsd = costFor(row.model, row.promptTokens, row.completionTokens);
    const full: UsageRow = { ...row, costUsd, at };
    this.rows.push(full);
    this.persist();
    return full;
  }

  list(chatId?: string): { rows: UsageRow[]; totalUsd: number } {
    const filtered = chatId ? this.rows.filter((r) => r.chatId === chatId) : this.rows;
    const totalUsd = filtered.reduce((s, r) => s + r.costUsd, 0);
    return { rows: filtered, totalUsd };
  }
}

let store: UsageStore | null = null;

export function registerUsageHandlers(): void {
  store = new UsageStore();

  ipcMain.handle(CHANNELS.USAGE_RECORD, (_e, raw) => {
    const args = schemas.usageRecordRequest.parse(raw);
    store!.record(args);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.USAGE_LIST, (_e, raw) => {
    const args = schemas.usageListRequest.parse(raw);
    return store!.list(args.chatId);
  });

  ipcMain.handle(CHANNELS.USAGE_SUMMARY, () => {
    return summarizeUsage(store!.list().rows);
  });
}

/** Used by the agent runtime when it gets usage back from the provider. */
export function recordUsage(row: Omit<UsageRow, 'costUsd' | 'at'>): void {
  store?.record(row);
}

/**
 * Spend snapshot for the budget guard: total for one chat and total since the
 * local start of today. Returns zeros when usage hasn't been initialized.
 */
export function querySpend(chatId?: string): { chatUsd: number; dayUsd: number } {
  if (!store) return { chatUsd: 0, dayUsd: 0 };
  const chatUsd = chatId ? store.list(chatId).totalUsd : 0;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dayUsd = store
    .list()
    .rows.filter((r) => r.at >= startOfDay.getTime())
    .reduce((s, r) => s + r.costUsd, 0);
  return { chatUsd, dayUsd };
}
