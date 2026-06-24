// Scheduled tasks — recurring agent runs. Stored in a JSON file under
// userData. A single ticker checks every minute for due jobs; each tick
// invokes the orchestrator with the saved prompt and the configured agent.

import { app, ipcMain } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';

interface ScheduleRow {
  id: string;
  agentId: string;
  prompt: string;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
}

class ScheduleStore {
  private items: ScheduleRow[] = [];
  private readonly path: string;

  constructor() {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'schedules.json');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return;
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) this.items = parsed as ScheduleRow[];
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.path, JSON.stringify(this.items), 'utf8');
    } catch {
      // best-effort
    }
  }

  list(): ScheduleRow[] {
    return this.items.slice();
  }

  create(input: { agentId: string; prompt: string; intervalMinutes: number }): ScheduleRow {
    const row: ScheduleRow = {
      id: randomUUID(),
      agentId: input.agentId,
      prompt: input.prompt,
      intervalMinutes: input.intervalMinutes,
      enabled: true,
      nextRunAt: Date.now() + input.intervalMinutes * 60_000,
      lastRunAt: null,
    };
    this.items.push(row);
    this.persist();
    return row;
  }

  delete(id: string): void {
    this.items = this.items.filter((s) => s.id !== id);
    this.persist();
  }

  toggle(id: string, enabled: boolean): void {
    const found = this.items.find((s) => s.id === id);
    if (!found) return;
    found.enabled = enabled;
    if (enabled) found.nextRunAt = Date.now() + found.intervalMinutes * 60_000;
    this.persist();
  }

  markRan(id: string): void {
    const found = this.items.find((s) => s.id === id);
    if (!found) return;
    const now = Date.now();
    found.lastRunAt = now;
    found.nextRunAt = now + found.intervalMinutes * 60_000;
    this.persist();
  }

  due(now: number): ScheduleRow[] {
    return this.items.filter((s) => s.enabled && s.nextRunAt <= now);
  }
}

let store: ScheduleStore | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

export function registerScheduleHandlers(deps: {
  repo: ChatRepository;
  manager: AgentSessionManager;
}): void {
  store = new ScheduleStore();

  ipcMain.handle(CHANNELS.SCHEDULES_LIST, () => ({ items: store!.list() }));

  ipcMain.handle(CHANNELS.SCHEDULES_CREATE, (_e, raw) => {
    const args = schemas.schedulesCreateRequest.parse(raw);
    const row = store!.create(args);
    return { id: row.id };
  });

  ipcMain.handle(CHANNELS.SCHEDULES_DELETE, (_e, raw) => {
    const args = schemas.schedulesDeleteRequest.parse(raw);
    store!.delete(args.id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.SCHEDULES_TOGGLE, (_e, raw) => {
    const args = schemas.schedulesToggleRequest.parse(raw);
    store!.toggle(args.id, args.enabled);
    return { ok: true };
  });

  // Fire due jobs once a minute. Cheap because `due()` is an O(n) scan
  // over the in-memory list (capped at a few dozen rows in practice).
  if (ticker) clearInterval(ticker);
  ticker = setInterval(async () => {
    if (!store) return;
    const due = store.due(Date.now());
    for (const job of due) {
      try {
        // Create a fresh chat for each tick so streams don't pile up.
        const chat = deps.repo.createChat(job.agentId, `Scheduled · ${new Date().toLocaleString()}`);
        const { session } = await deps.manager.start(chat.id);
        void session.run(job.prompt);
        store.markRan(job.id);
      } catch {
        // skip this tick; try again next minute
      }
    }
  }, 60_000);
}
