import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();
let userData = '';
vi.mock('electron', () => ({
  app: { getPath: () => userData },
  ipcMain: { handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => handlers.set(ch, fn) },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import { registerRoutineHandlers } from '../../../src/main/ipc/handlers/routines';
import { CHANNELS } from '../../../src/shared/ipc-channels';

interface Msg {
  role: string;
  content: string;
}

function fakeRepo() {
  const chats = new Map<string, Msg[]>();
  let n = 0;
  return {
    chats,
    createChat: (_agentId: string, _title?: string) => {
      const id = `chat-${++n}`;
      chats.set(id, []);
      return { id };
    },
    appendMessage: (chatId: string, m: Msg) => void chats.get(chatId)!.push(m),
  };
}

beforeEach(() => {
  handlers.clear();
  userData = mkdtempSync(join(tmpdir(), 'routines-'));
});
afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

async function create(prompt: string): Promise<string> {
  const res = (await handlers.get(CHANNELS.ROUTINES_CREATE)!({}, {
    name: 'r',
    agentId: 'a',
    prompt,
    schedule: { frequency: 'daily', time: '23:59' },
  })) as { id: string };
  return res.id;
}

describe('routines', () => {
  it('runNow stores the prompt once (session.run persists it itself)', async () => {
    const repo = fakeRepo();
    const manager = {
      start: async (chatId: string) => ({
        session: { run: async (text: string) => repo.appendMessage(chatId, { role: 'user', content: text }) },
      }),
    };
    registerRoutineHandlers({ repo: repo as never, manager: manager as never, settings: { get: () => null } as never });
    const id = await create('SUMMARISE');
    const res = (await handlers.get(CHANNELS.ROUTINES_RUN_NOW)!({}, { id })) as { ok: boolean; chatId: string };
    await new Promise((r) => setTimeout(r, 10));
    expect(res.ok).toBe(true);
    expect(repo.chats.get(res.chatId)!.filter((m) => m.role === 'user')).toHaveLength(1);
  });

  it('a failed run still advances to the next slot (no retry every 30 s)', async () => {
    const repo = fakeRepo();
    const manager = {
      start: async () => {
        throw new Error('unknown agent');
      },
    };
    registerRoutineHandlers({ repo: repo as never, manager: manager as never, settings: { get: () => null } as never });
    const id = await create('X');
    const before = ((await handlers.get(CHANNELS.ROUTINES_LIST)!({}, {})) as { items: Array<{ id: string; nextRunAt: number }> }).items[0]!;
    // Pretend it was due a minute ago.
    before.nextRunAt = Date.now() - 60_000;
    const res = (await handlers.get(CHANNELS.ROUTINES_RUN_NOW)!({}, { id })) as { ok: boolean };
    expect(res.ok).toBe(false);
    const after = ((await handlers.get(CHANNELS.ROUTINES_LIST)!({}, {})) as { items: Array<{ nextRunAt: number }> }).items[0]!;
    expect(after.nextRunAt).toBeGreaterThan(Date.now());
  });
});
