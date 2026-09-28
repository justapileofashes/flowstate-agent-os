import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from 'better-sqlite3';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import { FakeProvider } from '@main/agent/fake-provider';
import { ApprovalGate } from '@main/agent/approval-gate';
import { Coordinator, type TeamEvent } from '@main/agent/coordinator';

let dir: string;
let db: Database;
let repo: ChatRepository;
let plannerModelCalls = 0;

beforeEach(() => {
  plannerModelCalls = 0;
  dir = mkdtempSync(join(tmpdir(), 'flowstate-coord-'));
  const ws = join(dir, 'ws');
  mkdirSync(ws, { recursive: true });
  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, ws);
  repo = new ChatRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function coordinator(): Coordinator {
  const plan = JSON.stringify({
    summary: 'one task',
    tasks: [{ agent_id: 'agent-code-helper', instruction: 'say done' }],
    synthesizer_agent_id: 'agent-code-helper',
  });
  const provider = new FakeProvider(
    [
      { type: 'text', text: 'task output\n<<TASK_COMPLETE>>' },
      { type: 'done' },
      { type: 'text', text: 'final answer' },
      { type: 'done' },
    ],
    { chatOnceResponses: [plan] },
  );
  return new Coordinator({
    provider,
    plannerModel: async () => {
      plannerModelCalls += 1;
      return 'fake-model:1b';
    },
    repo,
    approvalGate: new ApprovalGate(() => {}, 50),
  });
}

async function run(c: Coordinator, opts?: { persist?: boolean }): Promise<TeamEvent[]> {
  const events: TeamEvent[] = [];
  const { done } = c.start('do the thing', (e) => events.push(e), opts);
  await done;
  return events;
}

describe('Coordinator planner model', () => {
  // Resolved per run, so changing the setting doesn't need an app restart.
  it('asks for the planner model on every run', async () => {
    const events = await run(coordinator());
    expect(events.at(-1)).toMatchObject({ type: 'run-end', reason: 'ok' });
    expect(plannerModelCalls).toBe(1);
  });
});

describe('Coordinator model substitution', () => {
  it('runs subtasks and synthesis on an installed model when the agent asks for a missing one', async () => {
    // The seeded helper asks for qwen2.5-coder:14b. On a machine that never
    // pulled it the coordinator 404s — unlike AgentSession it has no failover
    // chain, so the subtask and then synthesis both die. Map onto what is there.
    const plan = JSON.stringify({
      summary: 'one task',
      tasks: [{ agent_id: 'agent-code-helper', instruction: 'say done' }],
      synthesizer_agent_id: 'agent-code-helper',
    });
    const provider = new FakeProvider(
      [
        { type: 'text', text: 'task output\n<<TASK_COMPLETE>>' },
        { type: 'done' },
        { type: 'text', text: 'final answer' },
        { type: 'done' },
      ],
      { chatOnceResponses: [plan], models: [{ name: 'llama3.1:8b' }] },
    );
    const seen: string[] = [];
    const inner = provider.chatStream.bind(provider);
    provider.chatStream = (o) => {
      seen.push(o.model);
      return inner(o);
    };
    const events = await run(
      new Coordinator({
        provider,
        plannerModel: async () => 'llama3.1:8b',
        repo,
        approvalGate: new ApprovalGate(() => {}, 50),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'run-end', reason: 'ok' });
    expect(seen).toEqual(['llama3.1:8b', 'llama3.1:8b']);
  });
});

describe('Coordinator persistence', () => {
  it('writes the run as its own "Team · …" chat by default', async () => {
    const events = await run(coordinator());
    expect(events.at(-1)).toMatchObject({ type: 'run-end', reason: 'ok' });
    const chats = repo.listRecentChats(10);
    expect(chats).toHaveLength(1);
    expect(chats[0]!.title).toMatch(/^Team · /);
  });

  it('adds no chat of its own with persist:false (the Ask-box route records it)', async () => {
    const events = await run(coordinator(), { persist: false });
    expect(events.at(-1)).toMatchObject({ type: 'run-end', reason: 'ok' });
    expect(repo.listRecentChats(10)).toHaveLength(0);
  });
});
