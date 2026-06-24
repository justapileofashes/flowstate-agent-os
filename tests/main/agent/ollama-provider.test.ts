import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '@main/agent/ollama-provider';
import type { ProviderDelta } from '@main/agent/llm-provider';

function ndjsonStream(lines: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(enc.encode(line + '\n'));
      controller.close();
    },
  });
}

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

const baseOpts = {
  model: 'qwen2.5-coder:14b',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
};

describe('OllamaProvider.chatStream', () => {
  it('parses text deltas across chunks and emits done', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        ndjsonStream([
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: 'Hello' },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: ' world' },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: '' },
            done: true,
            prompt_eval_count: 5,
            eval_count: 2,
          }),
        ]),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const events = await collect(p.chatStream(baseOpts));
    expect(events).toEqual<ProviderDelta[]>([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', promptTokens: 5, completionTokens: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/chat',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('extracts tool_calls from a message chunk', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        ndjsonStream([
          JSON.stringify({
            model: 'm',
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                { function: { name: 'read_file', arguments: { path: 'a.txt' } } },
              ],
            },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: '' },
            done: true,
          }),
        ]),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const events = await collect(p.chatStream(baseOpts));
    const calls = events.filter((e) => e.type === 'tool-call');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      type: 'tool-call',
      name: 'read_file',
      args: { path: 'a.txt' },
    });
    if (calls[0]?.type === 'tool-call') {
      expect(typeof calls[0].id).toBe('string');
      expect(calls[0].id?.length).toBeGreaterThan(0);
    }
  });

  it('throws on HTTP non-200', async () => {
    const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/500/);
  });

  it('throws if response body is missing', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/body/);
  });

  it('ignores malformed JSON lines and continues parsing', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        ndjsonStream([
          '{not valid json',
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: 'ok' },
            done: false,
          }),
          JSON.stringify({
            model: 'm',
            message: { role: 'assistant', content: '' },
            done: true,
          }),
        ]),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const events = await collect(p.chatStream(baseOpts));
    expect(events.find((e) => e.type === 'text' && e.text === 'ok')).toBeDefined();
  });

  it('passes signal to fetch', async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          ndjsonStream([
            JSON.stringify({
              model: 'm',
              message: { role: 'assistant', content: '' },
              done: true,
            }),
          ]),
          { status: 200 },
        ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const ctrl = new AbortController();
    await collect(p.chatStream({ ...baseOpts, signal: ctrl.signal }));
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(ctrl.signal);
  });
});

describe('OllamaProvider.listModels and isReachable', () => {
  it('listModels parses /api/tags', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: 'qwen2.5-coder:14b', size: 9_000_000_000 },
            { name: 'llama3.1:8b', size: 5_000_000_000 },
          ],
        }),
        { status: 200 },
      ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    const ms = await p.listModels();
    expect(ms.map((m) => m.name)).toEqual(['qwen2.5-coder:14b', 'llama3.1:8b']);
  });

  it('isReachable returns true on /api/version 200', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 }),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    expect(await p.isReachable()).toBe(true);
  });

  it('isReachable returns false on fetch throw', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    expect(await p.isReachable()).toBe(false);
  });
});
