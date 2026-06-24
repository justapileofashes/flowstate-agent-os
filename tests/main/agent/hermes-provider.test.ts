import { describe, it, expect, vi } from 'vitest';
import { HermesProvider } from '@main/agent/hermes-provider';
import type { ProviderDelta } from '@main/agent/llm-provider';

// Hermes Agent is OpenAI-compatible, so chatStream consumes the OpenAI
// Server-Sent-Events format: `data: {json}\n` lines, terminated by `data: [DONE]`.
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
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
  model: 'hermes-local',
  messages: [{ role: 'user' as const, content: 'hi' }],
  tools: [],
};

const BASE = 'http://127.0.0.1:9090';

function dataLine(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}`;
}

describe('HermesProvider.chatStream', () => {
  it('parses OpenAI-style SSE text deltas and emits done with usage', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          sseStream([
            dataLine({ choices: [{ delta: { content: 'Hel' } }] }),
            dataLine({ choices: [{ delta: { content: 'lo' } }] }),
            dataLine({
              choices: [{ delta: {}, finish_reason: 'stop' }],
              usage: { prompt_tokens: 7, completion_tokens: 3 },
            }),
            'data: [DONE]',
          ]),
          { status: 200 },
        ),
    );
    const p = new HermesProvider(() => 'key', BASE, { fetchImpl: fetchMock });
    const events = await collect(p.chatStream(baseOpts));
    expect(events).toEqual<ProviderDelta[]>([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'done', promptTokens: 7, completionTokens: 3 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/v1/chat/completions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends Authorization and X-Hermes-Session-Id when a session id is provided', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(sseStream([dataLine({ choices: [{ delta: {} }] }), 'data: [DONE]']), {
          status: 200,
        }),
    );
    const p = new HermesProvider(() => 'secret-key', BASE, {
      fetchImpl: fetchMock,
      getSessionId: () => 'sess-123',
    });
    await collect(p.chatStream(baseOpts));
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer secret-key');
    expect(headers['X-Hermes-Session-Id']).toBe('sess-123');
  });

  it('omits the session header when no session id is configured', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(sseStream([dataLine({ choices: [{ delta: {} }] }), 'data: [DONE]']), {
          status: 200,
        }),
    );
    const p = new HermesProvider(() => 'k', BASE, { fetchImpl: fetchMock });
    await collect(p.chatStream(baseOpts));
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-Hermes-Session-Id']).toBeUndefined();
  });

  it('throws on non-200', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const p = new HermesProvider(() => 'k', BASE, { fetchImpl: fetchMock });
    await expect(collect(p.chatStream(baseOpts))).rejects.toThrow(/500/);
  });
});

describe('HermesProvider.listModels / isReachable', () => {
  it('lists ALL models (local + remote), unfiltered', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: 'llama3.1:8b' }, { id: 'gpt-4o' }, { id: 'hermes-3' }] }),
          { status: 200 },
        ),
    );
    const p = new HermesProvider(() => 'k', BASE, { fetchImpl: fetchMock });
    const ms = await p.listModels();
    expect(ms.map((m) => m.name)).toEqual(['llama3.1:8b', 'gpt-4o', 'hermes-3']);
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/v1/models`, expect.anything());
  });

  it('isReachable true on /v1/models 200, false on throw', async () => {
    const ok = new HermesProvider(() => 'k', BASE, {
      fetchImpl: vi.fn(async () => new Response('{"data":[]}', { status: 200 })),
    });
    expect(await ok.isReachable()).toBe(true);
    const bad = new HermesProvider(() => 'k', BASE, {
      fetchImpl: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    expect(await bad.isReachable()).toBe(false);
  });
});
