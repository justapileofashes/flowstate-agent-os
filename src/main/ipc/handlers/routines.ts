// Routines — cron-style recurring agent runs (Claude-Code-style).
// Each routine fires its agent on a friendly schedule (hourly / daily /
// weekdays / weekly / every-N-minutes / raw cron). A 30s ticker checks for
// due routines, spins up a fresh chat per fire, and runs the agent with the
// saved prompt. Persisted to userData/routines.json.

import { app, ipcMain, BrowserWindow } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { RoutineDto, RoutineSchedule, RoutineTarget } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';
import type { SettingsService } from '@main/services/settings-service';
import { SecretStore, electronSafeStorageBackend } from '@main/services/secret-store';
import { SettingsConnectionStore } from '@main/services/flowclaw-store';
import { FlowclawConnections } from '@main/agent/flowclaw-connections';
import { nextCron } from '@main/util/cron';

// ── Schedule math ───────────────────────────────────────────────────────────

function parseHM(time: string | undefined, fallbackH = 9, fallbackM = 0): { h: number; m: number } {
  if (!time) return { h: fallbackH, m: fallbackM };
  const [hs, ms] = time.split(':');
  const h = Math.max(0, Math.min(23, Number(hs) || fallbackH));
  const m = Math.max(0, Math.min(59, Number(ms) || fallbackM));
  return { h, m };
}

/** Next fire time (epoch ms) for a schedule, strictly after `from`. */
export function computeNextRun(schedule: RoutineSchedule, from: number): number {
  const base = new Date(from);
  switch (schedule.frequency) {
    case 'interval': {
      const mins = schedule.intervalMinutes ?? 60;
      return from + mins * 60_000;
    }
    case 'hourly': {
      // Fire at minute :MM of every hour.
      const { m } = parseHM(schedule.time, 0, 0);
      const d = new Date(base);
      d.setSeconds(0, 0);
      d.setMinutes(m);
      if (d.getTime() <= from) d.setHours(d.getHours() + 1);
      return d.getTime();
    }
    case 'daily': {
      const { h, m } = parseHM(schedule.time);
      const d = new Date(base);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= from) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    case 'weekdays': {
      const { h, m } = parseHM(schedule.time);
      const d = new Date(base);
      d.setHours(h, m, 0, 0);
      if (d.getTime() <= from) d.setDate(d.getDate() + 1);
      // Skip Sat (6) + Sun (0).
      while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    case 'weekly': {
      const { h, m } = parseHM(schedule.time);
      const target = schedule.dayOfWeek ?? 1; // default Monday
      const d = new Date(base);
      d.setHours(h, m, 0, 0);
      let delta = (target - d.getDay() + 7) % 7;
      if (delta === 0 && d.getTime() <= from) delta = 7;
      d.setDate(d.getDate() + delta);
      return d.getTime();
    }
    case 'cron':
      return nextCron(schedule.cron ?? '0 9 * * *', from);
    default:
      return from + 60 * 60_000;
  }
}

export { nextCron };

// ── Store ───────────────────────────────────────────────────────────────────

class RoutineStore {
  private items: RoutineDto[] = [];
  private readonly path: string;

  constructor() {
    const dir = app.getPath('userData');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, 'routines.json');
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return;
      const parsed = JSON.parse(readFileSync(this.path, 'utf8'));
      if (Array.isArray(parsed)) this.items = parsed as RoutineDto[];
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

  list(): RoutineDto[] {
    return this.items.slice();
  }

  create(input: {
    name: string;
    agentId: string;
    prompt: string;
    schedule: RoutineSchedule;
    target?: RoutineTarget;
  }): RoutineDto {
    const now = Date.now();
    const row: RoutineDto = {
      id: randomUUID(),
      name: input.name,
      agentId: input.agentId,
      prompt: input.prompt,
      schedule: input.schedule,
      ...(input.target ? { target: input.target } : {}),
      enabled: true,
      nextRunAt: computeNextRun(input.schedule, now),
      lastRunAt: null,
      lastChatId: null,
      runCount: 0,
    };
    this.items.push(row);
    this.persist();
    return row;
  }

  update(
    id: string,
    patch: {
      name?: string;
      prompt?: string;
      agentId?: string;
      schedule?: RoutineSchedule;
      target?: RoutineTarget | null;
    },
  ): RoutineDto | null {
    const r = this.items.find((x) => x.id === id);
    if (!r) return null;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.prompt !== undefined) r.prompt = patch.prompt;
    if (patch.agentId !== undefined) r.agentId = patch.agentId;
    if (patch.schedule !== undefined) {
      r.schedule = patch.schedule;
      r.nextRunAt = computeNextRun(patch.schedule, Date.now());
    }
    if (patch.target !== undefined) {
      if (patch.target === null) delete r.target;
      else r.target = patch.target;
    }
    this.persist();
    return r;
  }

  delete(id: string): void {
    this.items = this.items.filter((x) => x.id !== id);
    this.persist();
  }

  toggle(id: string, enabled: boolean): RoutineDto | null {
    const r = this.items.find((x) => x.id === id);
    if (!r) return null;
    r.enabled = enabled;
    if (enabled) r.nextRunAt = computeNextRun(r.schedule, Date.now());
    this.persist();
    return r;
  }

  markRan(id: string, chatId: string): void {
    const r = this.items.find((x) => x.id === id);
    if (!r) return;
    const now = Date.now();
    r.lastRunAt = now;
    r.lastChatId = chatId;
    r.runCount += 1;
    r.nextRunAt = computeNextRun(r.schedule, now);
    this.persist();
  }

  get(id: string): RoutineDto | undefined {
    return this.items.find((x) => x.id === id);
  }

  due(now: number): RoutineDto[] {
    return this.items.filter((r) => r.enabled && r.nextRunAt <= now);
  }
}

let store: RoutineStore | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;

export function registerRoutineHandlers(deps: {
  repo: ChatRepository;
  manager: AgentSessionManager;
  settings: SettingsService;
}): void {
  store = new RoutineStore();

  // flowclaw registry, lazily reused for routines whose target is a gateway.
  const flowclaw = new FlowclawConnections(
    new SettingsConnectionStore(deps.settings, new SecretStore(electronSafeStorageBackend())),
  );

  async function fire(routine: RoutineDto): Promise<string | null> {
    try {
      const chat = deps.repo.createChat(
        routine.agentId,
        `${routine.name} · ${new Date().toLocaleString()}`,
      );
      // Persist the prompt as the user message so the run reads naturally.
      deps.repo.appendMessage(chat.id, { role: 'user', content: routine.prompt });

      if (routine.target?.kind === 'flowclaw') {
        // Run on a gateway connection (Hermes/OpenClaw) and persist the result.
        const text = await flowclaw.runToText(routine.target.connectionId, routine.prompt, {
          ...(routine.target.model ? { model: routine.target.model } : {}),
        });
        deps.repo.appendMessage(chat.id, {
          role: 'assistant',
          content: text || '[no output]',
        });
      } else {
        const { session } = await deps.manager.start(chat.id);
        void session.run(routine.prompt);
      }

      store!.markRan(routine.id, chat.id);
      // Nudge any open window to refresh its recent-chats list.
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send('routines:fired', { id: routine.id, chatId: chat.id });
      return chat.id;
    } catch {
      return null;
    }
  }

  ipcMain.handle(CHANNELS.ROUTINES_LIST, () => ({ items: store!.list() }));

  ipcMain.handle(CHANNELS.ROUTINES_CREATE, (_e, raw) => {
    const args = schemas.routinesCreateRequest.parse(raw);
    const r = store!.create(args);
    return { id: r.id, nextRunAt: r.nextRunAt };
  });

  ipcMain.handle(CHANNELS.ROUTINES_UPDATE, (_e, raw) => {
    const args = schemas.routinesUpdateRequest.parse(raw);
    const r = store!.update(args.id, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
      ...(args.agentId !== undefined ? { agentId: args.agentId } : {}),
      ...(args.schedule !== undefined ? { schedule: args.schedule } : {}),
      ...(args.target !== undefined ? { target: args.target } : {}),
    });
    return { ok: !!r, ...(r ? { nextRunAt: r.nextRunAt } : {}) };
  });

  ipcMain.handle(CHANNELS.ROUTINES_DELETE, (_e, raw) => {
    const args = schemas.routinesDeleteRequest.parse(raw);
    store!.delete(args.id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.ROUTINES_TOGGLE, (_e, raw) => {
    const args = schemas.routinesToggleRequest.parse(raw);
    const r = store!.toggle(args.id, args.enabled);
    return { ok: !!r, ...(r ? { nextRunAt: r.nextRunAt } : {}) };
  });

  ipcMain.handle(CHANNELS.ROUTINES_RUN_NOW, async (_e, raw) => {
    const args = schemas.routinesRunNowRequest.parse(raw);
    const r = store!.get(args.id);
    if (!r) return { ok: false };
    const chatId = await fire(r);
    return { ok: !!chatId, ...(chatId ? { chatId } : {}) };
  });

  // Tick every 30s. Routines are minute-granular, so 30s guarantees we
  // never miss a minute boundary.
  if (ticker) clearInterval(ticker);
  ticker = setInterval(async () => {
    if (!store) return;
    for (const r of store.due(Date.now())) {
      await fire(r);
    }
  }, 30_000);
}
