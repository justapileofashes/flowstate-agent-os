import { describe, it, expect, vi } from 'vitest';
import {
  FlowclawConnections,
  type FlowclawConnection,
  type ConnectionStore,
} from '@main/agent/flowclaw-connections';
import type { WebSocketLike } from '@main/agent/openclaw-client';

function fakeStore(conns: FlowclawConnection[], secrets: Record<string, string>): ConnectionStore {
  return {
    list: () => conns,
    get: (id) => conns.find((c) => c.id === id),
    getSecret: (id) => secrets[id] ?? '',
  };
}

const hermes: FlowclawConnection = {
  id: 'h1',
  kind: 'hermes',
  label: 'Local Hermes',
  baseUrl: 'http://127.0.0.1:9090',
  model: 'llama3.1:8b',
  enabled: true,
};
const openclaw: FlowclawConnection = {
  id: 'o1',
  kind: 'openclaw',
  label: 'Local OpenClaw',
  baseUrl: 'http://127.0.0.1:18789',
  enabled: true,
};

describe('FlowclawConnections.testConnection', () => {
  it('tests a Hermes connection via /v1/models', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request) => new Response('{"data":[]}', { status: 200 }),
    );
    const reg = new FlowclawConnections(fakeStore([hermes], { h1: 'key' }), {
      fetchImpl: fetchMock,
    });
    const res = await reg.testConnection('h1');
    expect(res.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/models');
  });

  it('tests an OpenClaw connection and surfaces a 401 as not-ok', async () => {
    const fetchMock = vi.fn(async () => new Response('no', { status: 401 }));
    const reg = new FlowclawConnections(fakeStore([openclaw], { o1: 'bad' }), {
      fetchImpl: fetchMock,
    });
    const res = await reg.testConnection('o1');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it('returns not-ok for an unknown connection id', async () => {
    const reg = new FlowclawConnections(fakeStore([], {}), { fetchImpl: vi.fn() });
    const res = await reg.testConnection('nope');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown/i);
  });
});

describe('FlowclawConnections.providerFor', () => {
  it('returns a working Hermes provider that streams', async () => {
    const enc = new TextEncoder();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n'),
              );
              controller.enqueue(enc.encode('data: [DONE]\n'));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
    const reg = new FlowclawConnections(fakeStore([hermes], { h1: 'key' }), {
      fetchImpl: fetchMock,
    });
    const provider = reg.providerFor('h1');
    const out: string[] = [];
    for await (const d of provider.chatStream({ model: 'llama3.1:8b', messages: [], tools: [] })) {
      if (d.type === 'text') out.push(d.text);
    }
    expect(out.join('')).toBe('hi');
  });

  it('throws for an OpenClaw connection (not a chat provider yet)', () => {
    const reg = new FlowclawConnections(fakeStore([openclaw], { o1: 't' }), { fetchImpl: vi.fn() });
    expect(() => reg.providerFor('o1')).toThrow(/openclaw/i);
  });
});

describe('FlowclawConnections.run', () => {
  it('runs a Hermes connection and yields normalized text + done events', async () => {
    const enc = new TextEncoder();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'hey' } }] }) + '\n'),
              );
              controller.enqueue(enc.encode('data: [DONE]\n'));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
    const reg = new FlowclawConnections(fakeStore([hermes], { h1: 'key' }), { fetchImpl: fetchMock });
    const out: unknown[] = [];
    for await (const e of reg.run('h1', 'hi')) out.push(e);
    expect(out).toEqual([{ type: 'text', text: 'hey' }, { type: 'done' }]);
  });

  it('runs an OpenClaw connection over the injected WS factory', async () => {
    const reg = new FlowclawConnections(fakeStore([openclaw], { o1: 'tok' }), {
      wsFactory: (url) => {
        // Minimal faithful gateway: ack connect, emit one text event, finish ok.
        const listeners: Record<string, Array<(ev: unknown) => void>> = {};
        const on = (t: string, l: (ev: unknown) => void): void => {
          (listeners[t] ??= []).push(l);
        };
        const emit = (t: string, ev: unknown): void => {
          for (const l of listeners[t] ?? []) l(ev);
        };
        const srv = (f: unknown): void => emit('message', { data: JSON.stringify(f) });
        const ws: WebSocketLike = {
          addEventListener: on as WebSocketLike['addEventListener'],
          close: () => queueMicrotask(() => emit('close', {})),
          send: (data: string) => {
            const f = JSON.parse(data) as Record<string, unknown>;
            queueMicrotask(() => {
              if (f['method'] === 'connect') {
                srv({ type: 'res', id: f['id'], ok: true });
              } else {
                srv({ type: 'event', event: 'message.delta', payload: { text: 'pong' } });
                srv({ type: 'res', id: f['id'], ok: true, payload: { done: true } });
              }
            });
          },
        };
        queueMicrotask(() => emit('open', undefined));
        return ws;
      },
    });
    const out: unknown[] = [];
    for await (const e of reg.run('o1', 'ping')) out.push(e);
    expect(out).toEqual([
      { type: 'text', text: 'pong' },
      { type: 'done', payload: { done: true } },
    ]);
  });

  it('runToText collects streamed text for the routine dispatcher', async () => {
    const enc = new TextEncoder();
    const fetchMock = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of ['one ', 'two ', 'three']) {
                controller.enqueue(
                  enc.encode(
                    'data: ' + JSON.stringify({ choices: [{ delta: { content: chunk } }] }) + '\n',
                  ),
                );
              }
              controller.enqueue(enc.encode('data: [DONE]\n'));
              controller.close();
            },
          }),
          { status: 200 },
        ),
    );
    const reg = new FlowclawConnections(fakeStore([hermes], { h1: 'key' }), { fetchImpl: fetchMock });
    expect(await reg.runToText('h1', 'hi')).toBe('one two three');
  });

  it('errors when a Hermes connection has no model', async () => {
    const noModel: FlowclawConnection = { ...hermes, model: undefined as unknown as string };
    delete (noModel as { model?: string }).model;
    const reg = new FlowclawConnections(fakeStore([noModel], { h1: 'k' }), { fetchImpl: vi.fn() });
    const out: unknown[] = [];
    for await (const e of reg.run('h1', 'hi')) out.push(e);
    expect(out).toEqual([{ type: 'error', error: 'connection h1 has no model selected' }]);
  });
});
