import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import { FakeProvider } from '@main/agent/fake-provider';
import { AgentSessionManager } from '@main/agent/agent-session-manager';
import { ApprovalGate } from '@main/agent/approval-gate';
import { CHANNELS } from '@shared/ipc-channels';

let dir: string;
let db: Database;
let repo: ChatRepository;
let chatId: string;
let events: Array<{ channel: string; payload: unknown }>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-broadcast-'));
  const ws = join(dir, 'ws');
  mkdirSync(ws, { recursive: true });
  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, ws);
  repo = new ChatRepository(db);
  const c = repo.createChat('agent-code-helper');
  chatId = c.id;
  events = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('AgentSessionManager broadcasts active streams', () => {
  it('emits chat:active-streams on start and on completion', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'hi' },
      { type: 'done' },
    ]);
    const send = (channel: string, payload: unknown) =>
      events.push({ channel, payload });
    const approvalGate = new ApprovalGate(send, 50);
    const manager = new AgentSessionManager({
      provider,
      repo,
      approvalGate,
      send,
    });
    const { session } = await manager.start(chatId);
    await session.run('hello');

    const broadcasts = events.filter((e) => e.channel === CHANNELS.CHAT_ACTIVE_STREAMS);
    expect(broadcasts.length).toBeGreaterThanOrEqual(2);
    const first = broadcasts[0]!.payload as { active: Array<{ agentId: string }> };
    expect(first.active).toHaveLength(1);
    expect(first.active[0]?.agentId).toBe('agent-code-helper');
    const last = broadcasts[broadcasts.length - 1]!.payload as { active: unknown[] };
    expect(last.active).toEqual([]);
  });
});
