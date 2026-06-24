import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools';
import { AgentRuntime } from '@main/agent/agent-runtime';
import { ToolDispatcher } from '@main/agent/tool-dispatcher';
import { FakeProvider } from '@main/agent/fake-provider';
import { FILE_TOOL_SPECS } from '@main/agent/tool-specs';
import type { AgentEvent } from '@main/agent/types';
import type { ProviderDelta } from '@main/agent/llm-provider';

let workspace: string;
let tools: FileTools;
let dispatcher: ToolDispatcher;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-runtime-'));
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  tools = new FileTools(workspace);
  dispatcher = new ToolDispatcher({ fileTools: tools, workspaceRoot: workspace });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

function build(script: ProviderDelta[]): AgentRuntime {
  return new AgentRuntime({
    provider: new FakeProvider(script),
    model: 'fake',
    systemPrompt: 'you are a helpful test agent',
    tools: FILE_TOOL_SPECS,
    dispatcher,
  });
}

describe('AgentRuntime — single text turn', () => {
  it('emits text-delta events and a turn-done end', async () => {
    const rt = build([
      { type: 'text', text: 'Hi ' },
      { type: 'text', text: 'there' },
      { type: 'done' },
    ]);
    const events = await collect(rt.send('hello'));
    expect(events.map((e) => e.type)).toEqual(['text-delta', 'text-delta', 'turn-done']);
    expect(events[2]).toMatchObject({ type: 'turn-done', reason: 'end' });
    const history = rt.getHistory();
    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
    expect(history[2]?.content).toBe('Hi there');
  });
});

describe('AgentRuntime — one tool call success', () => {
  it('runs read_file then continues to a final assistant message', async () => {
    const rt = build([
      { type: 'tool-call', name: 'read_file', args: { path: 'a.txt' }, id: 'c1' },
      { type: 'done' },
      { type: 'text', text: 'File says hello' },
      { type: 'done' },
    ]);
    const events = await collect(rt.send('read it'));
    const types = events.map((e: AgentEvent) => e.type);
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types[types.length - 1]).toBe('turn-done');
    const tr = events.find((e) => e.type === 'tool-result');
    if (tr?.type === 'tool-result') {
      expect(tr.result.ok).toBe(true);
      expect(tr.result.content).toBe('hello');
    }
    const finalText = events.filter((e) => e.type === 'text-delta');
    expect(finalText).toHaveLength(1);
    const history = rt.getHistory();
    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
  });
});

describe('AgentRuntime — malformed tool args, model recovers', () => {
  it('feeds failure back, model retries, succeeds', async () => {
    const rt = build([
      { type: 'tool-call', name: 'read_file', args: { wrongKey: 'a.txt' }, id: 'c1' },
      { type: 'done' },
      { type: 'tool-call', name: 'read_file', args: { path: 'a.txt' }, id: 'c2' },
      { type: 'done' },
      { type: 'text', text: 'done' },
      { type: 'done' },
    ]);
    const events = await collect(rt.send('please retry'));
    const failures = events.filter(
      (e) => e.type === 'tool-result' && !e.result.ok,
    );
    const successes = events.filter(
      (e) => e.type === 'tool-result' && e.result.ok,
    );
    expect(failures).toHaveLength(1);
    expect(successes).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ type: 'turn-done', reason: 'end' });
  });
});

describe('AgentRuntime — max tool calls', () => {
  it('stops at the cap with reason max-tools', async () => {
    const script: ProviderDelta[] = [];
    for (let i = 0; i < 30; i++) {
      script.push({ type: 'tool-call', name: 'list_dir', args: { path: '.' }, id: `c${i}` });
      script.push({ type: 'done' });
    }
    const rt = new AgentRuntime({
      provider: new FakeProvider(script),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
      maxToolCallsPerTurn: 5,
    });
    const events = await collect(rt.send('loop please'));
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'turn-done', reason: 'max-tools' });
    const calls = events.filter((e) => e.type === 'tool-call');
    expect(calls.length).toBe(5);
  });
});

describe('AgentRuntime — provider mid-stream throw', () => {
  it('emits turn-done error and rolls back history', async () => {
    class ThrowingProvider extends FakeProvider {
      async *chatStream(): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'partial' };
        throw new Error('connection reset');
      }
    }
    const rt = new AgentRuntime({
      provider: new ThrowingProvider([]),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
    });
    const before = rt.getHistory().length;
    const events = await collect(rt.send('hi'));
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'turn-done', reason: 'error' });
    if (last?.type === 'turn-done') {
      expect(last.error).toMatch(/connection reset/);
    }
    expect(rt.getHistory().length).toBe(before);
  });
});

describe('AgentRuntime — abort during streaming', () => {
  it('emits turn-done aborted and rolls back history', async () => {
    class SlowProvider extends FakeProvider {
      async *chatStream(opts: {
        signal?: AbortSignal;
      }): AsyncGenerator<ProviderDelta> {
        yield { type: 'text', text: 'a' };
        await new Promise<void>((resolve, reject) => {
          if (opts.signal?.aborted) reject(new Error('AbortError'));
          opts.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        });
      }
    }
    const rt = new AgentRuntime({
      provider: new SlowProvider([]),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
    });
    const ctrl = new AbortController();
    const before = rt.getHistory().length;
    const stream = rt.send('please abort me', ctrl.signal);
    const events: AgentEvent[] = [];
    const reader = (async () => {
      for await (const e of stream) {
        events.push(e);
        if (e.type === 'text-delta') ctrl.abort();
      }
    })();
    await reader;
    const last = events[events.length - 1];
    expect(last).toMatchObject({ type: 'turn-done', reason: 'aborted' });
    expect(rt.getHistory().length).toBe(before);
  });
});

describe('AgentRuntime — empty user message', () => {
  it('rejects synchronously', () => {
    const rt = build([{ type: 'done' }]);
    expect(() => rt.send('')).toThrow(/empty/i);
  });
  it('rejects whitespace-only', () => {
    const rt = build([{ type: 'done' }]);
    expect(() => rt.send('   \n  ')).toThrow(/empty/i);
  });
});

describe('AgentRuntime — history resumption', () => {
  it('starts with provided history visible to provider', async () => {
    const seenMessagesPerTurn: number[] = [];
    class CountingProvider extends FakeProvider {
      async *chatStream(opts: {
        messages: { role: string }[];
      }): AsyncGenerator<ProviderDelta> {
        seenMessagesPerTurn.push(opts.messages.length);
        yield { type: 'text', text: 'k' };
        yield { type: 'done' };
      }
    }
    const rt = new AgentRuntime({
      provider: new CountingProvider([]),
      model: 'fake',
      systemPrompt: 'sys',
      tools: FILE_TOOL_SPECS,
      dispatcher,
      history: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'earlier' },
        { role: 'assistant', content: 'earlier reply' },
      ],
    });
    await collect(rt.send('next'));
    expect(seenMessagesPerTurn[0]).toBe(4);
  });
});
