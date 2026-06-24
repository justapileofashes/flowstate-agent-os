// Usage / cost meter — append-only JSON ledger of token usage per chat.
// Pricing table covers the cloud providers we ship; Ollama (local) costs 0.
// The renderer reads aggregated rows for a chat or all chats.

import { app, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import { summarizeUsage } from '@main/services/usage-summary';

interface UsageRow {
  chatId: string;
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  at: number;
}

/**
 * USD per 1M tokens, separated by prompt vs completion. Verified as of
 * 2026-05 against each provider's public pricing page. Local models map
 * to 0 so they appear in the meter but never inflate the bill.
 */
const PRICING: Record<string, { prompt: number; completion: number }> = {
  // Anthropic
  'claude-opus-4': { prompt: 15, completion: 75 },
  'claude-opus-4-5': { prompt: 15, completion: 75 },
  'claude-sonnet-4': { prompt: 3, completion: 15 },
  'claude-sonnet-4-5': { prompt: 3, completion: 15 },
  'claude-sonnet-4.5': { prompt: 3, completion: 15 },
  'claude-haiku-4': { prompt: 0.8, completion: 4 },
  // OpenAI
  'gpt-5': { prompt: 5, completion: 15 },
  'gpt-4.1': { prompt: 3, completion: 12 },
  'gpt-4o': { prompt: 2.5, completion: 10 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'o4': { prompt: 15, completion: 60 },
  'o3-mini': { prompt: 1.1, completion: 4.4 },
  // Google
  'gemini-2.5-pro': { prompt: 1.25, completion: 5 },
  'gemini-2.5-flash': { prompt: 0.15, completion: 0.6 },
  'gemini-2.0-flash': { prompt: 0.1, completion: 0.4 },
  // Perplexity
  'sonar-pro': { prompt: 3, completion: 15 },
  'sonar': { prompt: 1, completion: 1 },
  'sonar-reasoning-pro': { prompt: 2, completion: 8 },
  // Groq
  'llama-3.3-70b-versatile': { prompt: 0.59, completion: 0.79 },
  'llama-3.1-8b-instant': { prompt: 0.05, completion: 0.08 },
  'qwen-2.5-32b': { prompt: 0.29, completion: 0.39 },
  'deepseek-r1-distill-llama-70b': { prompt: 0.75, completion: 0.99 },
  // Mistral
  'mistral-large-latest': { prompt: 2, completion: 6 },
  'mistral-small-latest': { prompt: 0.2, completion: 0.6 },
  'codestral-latest': { prompt: 0.3, completion: 0.9 },
  // xAI
  'grok-4': { prompt: 5, completion: 15 },
  'grok-3': { prompt: 3, completion: 15 },
  'grok-3-mini': { prompt: 0.3, completion: 0.5 },
};

function priceFor(model: string): { prompt: number; completion: number } {
  if (PRICING[model]) return PRICING[model]!;
  // Prefix match (e.g. claude-sonnet-4.5-20251002 → claude-sonnet-4.5).
  const lower = model.toLowerCase();
  for (const k of Object.keys(PRICING)) {
    if (lower.startsWith(k.toLowerCase())) return PRICING[k]!;
  }
  return { prompt: 0, completion: 0 };
}

function costFor(model: string, prompt: number, completion: number): number {
  const p = priceFor(model);
  return (prompt / 1_000_000) * p.prompt + (completion / 1_000_000) * p.completion;
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
