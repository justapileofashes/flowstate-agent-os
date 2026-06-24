import { describe, it, expect, vi } from 'vitest';
import {
  OpenClawClient,
  toWsUrl,
  type WebSocketLike,
  type OpenClawEvent,
} from '@main/agent/openclaw-client';

const BASE = 'http://127.0.0.1:18789';

describe('OpenClawClient.testConnection', () => {
  it('reports ok on a 2xx response and sends the bearer token (header-only)', async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    const c = new OpenClawClient(() => 'tok-abc', BASE, { fetchImpl: fetchMock });
    const res = await c.testConnection();
    expect(res.ok).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-abc');
    // OpenClaw rejects query-string tokens — must never put the token in the URL.
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url.includes('tok-abc')).toBe(false);
  });

  it('reports not-ok with the status on 401 (reachable but unauthorized)', async () => {
    const fetchMock = vi.fn(
      async () => new Response('unauthorized', { status: 401 }),
    );
    const c = new OpenClawClient(() => 'bad', BASE, { fetchImpl: fetchMock });
    const res = await c.testConnection();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it('reports not-ok with an error when the gateway is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const c = new OpenClawClient(() => 'tok', BASE, { fetchImpl: fetchMock });
    const res = await c.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/ECONNREFUSED/);
  });
});

describe('OpenClawClient.isReachable', () => {
  it('true on 2xx, false on throw', async () => {
    const ok = new OpenClawClient(() => 't', BASE, {
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })),
    });
    expect(await ok.isReachable()).toBe(true);
    const bad = new OpenClawClient(() => 't', BASE, {
      fetchImpl: vi.fn(async () => {
        throw new Error('down');
      }),
    });
    expect(await bad.isReachable()).toBe(false);
  });
});

describe('toWsUrl', () => {
  it('maps http->ws and https->wss, defaulting the gateway path', () => {
    expect(toWsUrl('http://127.0.0.1:18789')).toBe('ws://127.0.0.1:18789/gateway');
    expect(toWsUrl('https://gw.example.com')).toBe('wss://gw.example.com/gateway');
  });
});

// ---------------------------------------------------------------------------
// In-process fake gateway speaking the OpenClaw WS RPC protocol faithfully:
// first frame must be a `connect` req (with auth.token), answered by a res;
// the run req is answered by zero-or-more event frames then a terminal res.
// ---------------------------------------------------------------------------
interface FakeOpts {
  rejectConnect?: boolean;
  events?: Array<{ event: string; payload?: unknown }>;
  runOk?: boolean;
  runError?: string;
}

class FakeGateway implements WebSocketLike {
  sent: Array<Record<string, unknown>> = [];
  receivedToken: string | undefined;
  private listeners: Record<string, Array<(ev: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };

  constructor(
    public readonly url: string,
    private readonly opts: FakeOpts,
  ) {
    queueMicrotask(() => this.emit('open', undefined));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, listener: any): void {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(frame);
    queueMicrotask(() => this.handle(frame));
  }

  close(): void {
    queueMicrotask(() => this.emit('close', { code: 1000 }));
  }

  private emit(type: string, ev: unknown): void {
    for (const l of this.listeners[type] ?? []) l(ev);
  }

  private srv(frame: unknown): void {
    this.emit('message', { data: JSON.stringify(frame) });
  }

  private handle(frame: Record<string, unknown>): void {
    if (frame['method'] === 'connect') {
      const params = frame['params'] as { auth?: { token?: string } };
      this.receivedToken = params?.auth?.token;
      if (this.opts.rejectConnect) {
        this.srv({ type: 'res', id: frame['id'], ok: false, error: { message: 'bad token' } });
        return;
      }
      this.srv({ type: 'res', id: frame['id'], ok: true, payload: { protocol: 1 } });
      return;
    }
    // The run request: emit events, then the terminal response.
    for (const e of this.opts.events ?? []) {
      this.srv({ type: 'event', event: e.event, payload: e.payload });
    }
    if (this.opts.runOk === false) {
      this.srv({ type: 'res', id: frame['id'], ok: false, error: this.opts.runError ?? 'run failed' });
    } else {
      this.srv({ type: 'res', id: frame['id'], ok: true, payload: { summary: 'complete' } });
    }
  }
}

async function collect(gen: AsyncGenerator<OpenClawEvent>): Promise<OpenClawEvent[]> {
  const out: OpenClawEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('OpenClawClient.submit (WS RPC)', () => {
  it('handshakes with in-band auth.token, streams text events, then done', async () => {
    let gw: FakeGateway | undefined;
    const c = new OpenClawClient(() => 'secret-token', BASE, {
      wsFactory: (url) => {
        gw = new FakeGateway(url, {
          events: [
            { event: 'message.delta', payload: { text: 'Hello' } },
            { event: 'message.delta', payload: { delta: ' world' } },
          ],
        });
        return gw;
      },
    });

    const events = await collect(c.submit('hi there', { model: 'qwen2.5' }));

    // The token went in-band in the connect frame (never an HTTP header).
    expect(gw?.receivedToken).toBe('secret-token');
    const connectFrame = gw?.sent[0];
    expect(connectFrame?.['method']).toBe('connect');
    const runFrame = gw?.sent[1] as { method: string; params: { prompt: string; model: string } };
    expect(runFrame.method).toBe('agent.run');
    expect(runFrame.params.prompt).toBe('hi there');
    expect(runFrame.params.model).toBe('qwen2.5');

    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'done', payload: { summary: 'complete' } },
    ]);
  });

  it('emits an error event when the connect handshake is rejected', async () => {
    const c = new OpenClawClient(() => 'bad', BASE, {
      wsFactory: (url) => new FakeGateway(url, { rejectConnect: true }),
    });
    const events = await collect(c.submit('hi'));
    expect(events).toEqual([{ type: 'error', error: 'connect rejected: bad token' }]);
  });

  it('emits an error event when the run response is not ok', async () => {
    const c = new OpenClawClient(() => 't', BASE, {
      wsFactory: (url) =>
        new FakeGateway(url, { runOk: false, runError: 'model unavailable' }),
    });
    const events = await collect(c.submit('hi'));
    expect(events).toEqual([{ type: 'error', error: 'model unavailable' }]);
  });

  it('maps tool-call event frames', async () => {
    const c = new OpenClawClient(() => 't', BASE, {
      wsFactory: (url) =>
        new FakeGateway(url, {
          events: [{ event: 'tool.call', payload: { name: 'search', args: { q: 'cats' }, id: 'tc1' } }],
        }),
    });
    const events = await collect(c.submit('find cats'));
    expect(events).toEqual([
      { type: 'tool-call', name: 'search', args: { q: 'cats' }, id: 'tc1' },
      { type: 'done', payload: { summary: 'complete' } },
    ]);
  });
});

describe('OpenClawClient.call (capability RPC)', () => {
  it('handshakes then sends the capability method and resolves its payload', async () => {
    let gw: FakeGateway | undefined;
    const c = new OpenClawClient(() => 'tok', BASE, {
      wsFactory: (url) => { gw = new FakeGateway(url, {}); return gw; },
    });
    const out = await c.listSkills('data');
    // connect first, then the skills.list method
    expect(gw!.sent[0]!.method).toBe('connect');
    expect(gw!.sent[1]!.method).toBe('skills.list');
    expect(gw!.sent[1]!.params).toEqual({ query: 'data' });
    expect(out).toEqual({ summary: 'complete' }); // fake gateway's stub payload
  });

  it('honors method-name overrides', async () => {
    let gw: FakeGateway | undefined;
    const c = new OpenClawClient(() => 'tok', BASE, {
      wsFactory: (url) => { gw = new FakeGateway(url, {}); return gw; },
      methods: { search: 'pro.search' },
    });
    await c.search('AAPL', 'yahoo-finance');
    expect(gw!.sent[1]!.method).toBe('pro.search');
    expect(gw!.sent[1]!.params).toEqual({ query: 'AAPL', source: 'yahoo-finance' });
  });

  it('rejects when the connect handshake is refused', async () => {
    const c = new OpenClawClient(() => 'bad', BASE, {
      wsFactory: (url) => new FakeGateway(url, { rejectConnect: true }),
    });
    await expect(c.memoryGet('persona')).rejects.toThrow(/connect rejected/);
  });
});

describe('OpenClawClient messaging-app linking', () => {
  it('lists providers and connections via the default method names', async () => {
    let gw: FakeGateway | undefined;
    const c = new OpenClawClient(() => 'tok', BASE, {
      wsFactory: (url) => { gw = new FakeGateway(url, {}); return gw; },
    });
    await c.listMessagingProviders();
    expect(gw!.sent[1]!.method).toBe('messaging.providers');

    gw = undefined;
    await c.listMessagingConnections();
    expect(gw!.sent[1]!.method).toBe('messaging.connections');
  });

  it('forwards credentials on connect and the id on disconnect', async () => {
    let gw: FakeGateway | undefined;
    const c = new OpenClawClient(() => 'tok', BASE, {
      wsFactory: (url) => { gw = new FakeGateway(url, {}); return gw; },
    });
    await c.connectMessaging('telegram', { botToken: 'abc' }, 'My group');
    expect(gw!.sent[1]!.method).toBe('messaging.connect');
    expect(gw!.sent[1]!.params).toEqual({ provider: 'telegram', credentials: { botToken: 'abc' }, label: 'My group' });

    gw = undefined;
    await c.disconnectMessaging('m-1');
    expect(gw!.sent[1]!.method).toBe('messaging.disconnect');
    expect(gw!.sent[1]!.params).toEqual({ id: 'm-1' });
  });

  it('honors messaging method-name overrides', async () => {
    let gw: FakeGateway | undefined;
    const c = new OpenClawClient(() => 'tok', BASE, {
      wsFactory: (url) => { gw = new FakeGateway(url, {}); return gw; },
      methods: { messagingConnect: 'chat.link' },
    });
    await c.connectMessaging('discord', { token: 't' });
    expect(gw!.sent[1]!.method).toBe('chat.link');
    expect(gw!.sent[1]!.params).toEqual({ provider: 'discord', credentials: { token: 't' } });
  });
});
