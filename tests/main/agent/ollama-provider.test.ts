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

describe('OllamaProvider.chatStream — image history vs. model capabilities', () => {
  const imageOpts = {
    model: 'llama3.1:8b',
    messages: [
      { role: 'user' as const, content: 'look ![shot](data:image/png;base64,QUJD)' },
    ],
    tools: [],
  };

  /** Routes /api/show to `capabilities`, /api/chat to a one-line done stream. */
  function router(show: () => Response) {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/show')) return show();
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        ndjsonStream([JSON.stringify({ message: { content: 'ok' }, done: true })]),
        { status: 200 },
      );
    });
    return { fetchMock, bodies };
  }

  const caps = (capabilities: string[]) =>
    new Response(JSON.stringify({ capabilities }), { status: 200 });
  const firstMessage = (bodies: Array<Record<string, unknown>>) =>
    (bodies[0]!['messages'] as Array<Record<string, unknown>>)[0]!;

  it('drops images for a text-only model but keeps the marker', async () => {
    const { fetchMock, bodies } = router(() => caps(['completion']));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await collect(p.chatStream(imageOpts));
    const msg = firstMessage(bodies);
    expect(msg['images']).toBeUndefined();
    expect(msg['content']).toContain('[image attached]');
  });

  it('keeps images for a vision model', async () => {
    const { fetchMock, bodies } = router(() => caps(['completion', 'vision']));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await collect(p.chatStream({ ...imageOpts, model: 'llava:7b' }));
    expect(firstMessage(bodies)['images']).toEqual(['QUJD']);
  });

  it('keeps images when /api/show fails — an unknown model is not downgraded', async () => {
    const { fetchMock, bodies } = router(() => new Response('nope', { status: 404 }));
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await collect(p.chatStream(imageOpts));
    expect(firstMessage(bodies)['images']).toEqual(['QUJD']);
  });

  it('keeps images when /api/show throws', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/show')) throw new Error('ECONNREFUSED');
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        ndjsonStream([JSON.stringify({ message: { content: 'ok' }, done: true })]),
        { status: 200 },
      );
    });
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await collect(p.chatStream(imageOpts));
    expect(firstMessage(bodies)['images']).toEqual(['QUJD']);
  });

  it('probes /api/show once per model', async () => {
    let probes = 0;
    const { fetchMock } = router(() => {
      probes += 1;
      return caps(['completion']);
    });
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await collect(p.chatStream(imageOpts));
    await collect(p.chatStream(imageOpts));
    expect(probes).toBe(1);
  });

  it('does not probe at all when the turn has no images', async () => {
    let probes = 0;
    const { fetchMock } = router(() => {
      probes += 1;
      return caps(['completion']);
    });
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await collect(p.chatStream(baseOpts));
    expect(probes).toBe(0);
  });
});

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

  it('includes Ollama\'s error body in HTTP failures', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: 'model "nope" not found, try pulling it first' }), { status: 404 }),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/404: model "nope" not found/);
  });

  it('throws on a mid-stream {"error"} line instead of ignoring it', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          ndjsonStream([
            JSON.stringify({ message: { content: 'par' }, done: false }),
            JSON.stringify({ error: 'model runner has unexpectedly stopped' }),
          ]),
          { status: 200 },
        ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/unexpectedly stopped/);
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
      async (_url: string, _init?: RequestInit) =>
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

describe('OllamaProvider.pullModel', () => {
  it('fails the pull when Ollama streams an error line (was reported as success)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          ndjsonStream([
            JSON.stringify({ status: 'pulling manifest' }),
            JSON.stringify({ error: 'pull model manifest: file does not exist' }),
          ]),
          { status: 200 },
        ),
    );
    const p = new OllamaProvider('http://localhost:11434', fetchMock);
    await expect(collect(p.pullModel('nope:1b'))).rejects.toThrow(/file does not exist/);
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
