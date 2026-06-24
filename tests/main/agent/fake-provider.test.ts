import { describe, it, expect } from 'vitest';
import { FakeProvider } from '@main/agent/fake-provider';
import type { ProviderDelta } from '@main/agent/llm-provider';

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

const opts = { model: 'fake', messages: [], tools: [] };

describe('FakeProvider', () => {
  it('yields a text + done sequence on first call', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'hi' },
      { type: 'done', promptTokens: 1, completionTokens: 2 },
    ]);
    const events = await collect(p.chatStream(opts));
    expect(events).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'done', promptTokens: 1, completionTokens: 2 },
    ]);
  });

  it('advances to next done across multiple calls', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'turn1' },
      { type: 'done' },
      { type: 'text', text: 'turn2' },
      { type: 'done' },
    ]);
    const turn1 = await collect(p.chatStream(opts));
    const turn2 = await collect(p.chatStream(opts));
    expect(turn1.map((e) => e.type)).toEqual(['text', 'done']);
    expect(turn2.map((e) => e.type)).toEqual(['text', 'done']);
    if (turn2[0]?.type === 'text') expect(turn2[0].text).toBe('turn2');
  });

  it('throws if script runs out', async () => {
    const p = new FakeProvider([{ type: 'done' }]);
    await collect(p.chatStream(opts));
    await expect(collect(p.chatStream(opts))).rejects.toThrow(/script exhausted/);
  });

  it('listModels returns the provided fake models', async () => {
    const p = new FakeProvider([], { models: [{ name: 'fake-coder:1b' }] });
    expect(await p.listModels()).toEqual([{ name: 'fake-coder:1b' }]);
  });

  it('isReachable defaults to true', async () => {
    const p = new FakeProvider([]);
    expect(await p.isReachable()).toBe(true);
  });

  it('emits tool-call deltas verbatim', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'reading' },
      { type: 'tool-call', name: 'read_file', args: { path: 'x' }, id: 'c1' },
      { type: 'done' },
    ]);
    const events = await collect(p.chatStream(opts));
    const calls = events.filter((e: ProviderDelta) => e.type === 'tool-call');
    expect(calls).toHaveLength(1);
  });

  it('respects abort signal', async () => {
    const p = new FakeProvider([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'done' },
    ]);
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(p.chatStream({ ...opts, signal: ctrl.signal }));
    expect(events).toEqual([]);
  });
});
