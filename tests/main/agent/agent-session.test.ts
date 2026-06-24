import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import { FakeProvider } from '@main/agent/fake-provider';
import { AgentSessionManager } from '@main/agent/agent-session-manager';
import { ApprovalGate } from '@main/agent/approval-gate';
import type { ProviderDelta } from '@main/agent/llm-provider';
import { chatEventChannel, chatEventEndChannel } from '@shared/ipc-channels';

let dir: string;
let workspace: string;
let db: Database;
let repo: ChatRepository;
let chatId: string;
let events: Array<{ channel: string; payload: unknown }>;
let send: (channel: string, payload: unknown) => void;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-session-'));
  workspace = join(dir, 'ws');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');

  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, workspace);
  repo = new ChatRepository(db);
  const chat = repo.createChat('agent-code-helper');
  chatId = chat.id;

  events = [];
  send = (channel, payload) => {
    events.push({ channel, payload });
  };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function buildManager(provider: FakeProvider): AgentSessionManager {
  const approvalGate = new ApprovalGate(send, 50);
  return new AgentSessionManager({
    provider,
    repo,
    approvalGate,
    send,
  });
}

describe('AgentSession — single text turn', () => {
  it('persists user + final assistant, emits text-delta + turn-done', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'Hi' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    await session.run('hello');

    const ms = repo.getMessages(chatId);
    expect(ms.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(ms[1]?.content).toBe('Hi');

    const channels = events.map((e) => e.channel);
    expect(channels).toContain(chatEventChannel(streamId));
    expect(channels).toContain(chatEventEndChannel(streamId));
  });
});

describe('AgentSession — one tool call success', () => {
  it('persists user, assistant(toolCalls), tool, assistant(final)', async () => {
    const provider = new FakeProvider([
      { type: 'tool-call', name: 'read_file', args: { path: 'a.txt' }, id: 'c1' },
      { type: 'done' },
      { type: 'text', text: 'File says hello' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { session } = await manager.start(chatId);
    await session.run('read it');

    const roles = repo.getMessages(chatId).map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'tool', 'assistant']);
  });
});

describe('AgentSession — abort', () => {
  it('persists only user message and emits aborted end', async () => {
    class SlowProvider extends FakeProvider {
      async *chatStream(opts: {
        signal?: AbortSignal;
      }): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'a' };
        await new Promise<void>((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () =>
            reject(new Error('AbortError')),
          );
        });
      }
    }
    const provider = new SlowProvider([]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    const runPromise = session.run('please abort');
    await new Promise((r) => setTimeout(r, 20));
    manager.abort(streamId);
    await runPromise;

    const roles = repo.getMessages(chatId).map((m) => m.role);
    expect(roles).toEqual(['user']);

    const endEvent = events.find((e) => e.channel === chatEventEndChannel(streamId));
    expect(endEvent).toBeDefined();
    expect(endEvent?.payload).toMatchObject({ reason: 'aborted' });
  });
});

describe('AgentSession — error', () => {
  it('persists only user message and emits error end', async () => {
    class ThrowingProvider extends FakeProvider {
      async *chatStream(): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'partial' };
        throw new Error('connection reset');
      }
    }
    const provider = new ThrowingProvider([]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    await session.run('hi');

    const roles = repo.getMessages(chatId).map((m) => m.role);
    expect(roles).toEqual(['user']);

    const endEvent = events.find((e) => e.channel === chatEventEndChannel(streamId));
    expect(endEvent?.payload).toMatchObject({ reason: 'error' });
  });
});

describe('AgentSession — history rebuild', () => {
  it('passes prior persisted messages to the provider', async () => {
    repo.appendMessage(chatId, { role: 'user', content: 'earlier' });
    repo.appendMessage(chatId, { role: 'assistant', content: 'earlier reply' });

    const seenMessageCounts: number[] = [];
    class CountingProvider extends FakeProvider {
      async *chatStream(opts: {
        messages: { role: string }[];
      }): AsyncGenerator<ProviderDelta> {
        seenMessageCounts.push(opts.messages.length);
        yield { type: 'text', text: 'k' };
        yield { type: 'done' };
      }
    }

    const provider = new CountingProvider([]);
    const manager = buildManager(provider);
    const { session } = await manager.start(chatId);
    await session.run('next');

    // system + earlier user + earlier assistant + current user = 4
    expect(seenMessageCounts[0]).toBe(4);
  });
});

describe('AgentSessionManager', () => {
  it('tracks active streams and supports abort/has', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'a' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { streamId } = await manager.start(chatId);
    expect(manager.has(streamId)).toBe(true);
    expect(manager.abort('not-a-real-id')).toBe(false);
  });

  it('deregisters session after run completes', async () => {
    const provider = new FakeProvider([
      { type: 'text', text: 'a' },
      { type: 'done' },
    ]);
    const manager = buildManager(provider);
    const { streamId, session } = await manager.start(chatId);
    await session.run('hi');
    expect(manager.has(streamId)).toBe(false);
  });
});
