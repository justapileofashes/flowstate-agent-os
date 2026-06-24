// OpenClaw gateway client.
//
// OpenClaw is a self-hosted gateway exposing an HTTP/WebSocket surface
// (default http://127.0.0.1:18789). Auth is header-only for HTTP probes —
// `Authorization: Bearer <token>` (query-string tokens are rejected). For the
// WebSocket RPC the token is sent IN-BAND in the connect frame's `auth.token`
// (the browser/global WebSocket API cannot set an Authorization header, and the
// gateway is designed around in-band auth for exactly this reason).
//
// Wire protocol (docs.openclaw.ai/gateway/protocol):
//   - text frames, each a JSON object
//   - request:  { type:"req",   id, method, params }
//   - response: { type:"res",   id, ok, payload? | error? }
//   - event:    { type:"event", event, payload, seq?, stateVersion? }
//   - the FIRST frame must be a `connect` request carrying minProtocol/
//     maxProtocol, client info, role/scopes and auth.token.
//   - side-effecting methods accept an idempotency key.

export interface OpenClawClientOpts {
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable WebSocket factory for testing. Defaults to global WebSocket. */
  wsFactory?: WebSocketFactory;
  /** Override the agent-run RPC method name (tracks the gateway method). */
  runMethod?: string;
  /** Client identity advertised in the connect handshake. */
  clientName?: string;
  /** Override capability RPC method names to track the gateway's naming. */
  methods?: Partial<Record<CapabilityMethod, string>>;
}

/** Non-streaming capability RPC methods Flowclaw drives on the gateway. */
export type CapabilityMethod =
  | 'skillsList'
  | 'skillInstall'
  | 'memoryGet'
  | 'memorySet'
  | 'filesList'
  | 'fileRead'
  | 'search'
  | 'messageSend'
  | 'messagingProviders'
  | 'messagingList'
  | 'messagingConnect'
  | 'messagingDisconnect';

const DEFAULT_METHODS: Record<CapabilityMethod, string> = {
  skillsList: 'skills.list',
  skillInstall: 'skills.install',
  memoryGet: 'memory.get',
  memorySet: 'memory.set',
  filesList: 'files.list',
  fileRead: 'files.read',
  search: 'search.run',
  messageSend: 'messaging.send',
  // Messaging-app linking: list supported apps, list/connect/disconnect accounts.
  messagingProviders: 'messaging.providers',
  messagingList: 'messaging.connections',
  messagingConnect: 'messaging.connect',
  messagingDisconnect: 'messaging.disconnect',
};

/** A messaging app the gateway can link the agent to (Telegram, Discord, …). */
export interface MessagingProvider {
  id: string;
  name: string;
  /** Credential fields the connect flow must collect (token, app id, …). */
  credentialFields?: Array<{ key: string; label: string; secret?: boolean }>;
}

/** A linked messaging account on the gateway, with the channels it can reach. */
export interface MessagingConnection {
  id: string;
  provider: string;
  label?: string;
  status?: 'connected' | 'connecting' | 'error' | 'disabled';
  error?: string;
  channels?: Array<{ id: string; name?: string }>;
}

export interface ConnectionResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Minimal WebSocket surface this client depends on (global WebSocket-shaped). */
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close', listener: (ev: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** A streamed agent event, normalized from the gateway's event frames. */
export type OpenClawEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name: string; args: unknown; id?: string }
  | { type: 'done'; payload?: unknown }
  | { type: 'error'; error: string };

export interface SubmitOpts {
  /** Idempotency key for the run (gateway dedupes retries). */
  idempotencyKey?: string;
  /** Model override passed through to the gateway. */
  model?: string;
  /** Abort the run + close the socket. */
  signal?: AbortSignal;
}

/** Protocol version range this client speaks. */
const PROTOCOL_MIN = 1;
const PROTOCOL_MAX = 1;
const DEFAULT_RUN_METHOD = 'agent.run';

interface ResFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { message?: string } | string;
}
interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: number;
}

function errMessage(e: ResFrame['error']): string {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  return e.message ?? 'unknown error';
}

/** Derive the WS URL from an HTTP base (http->ws, https->wss). */
export function toWsUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  // Gateway RPC endpoint. Path is fixed by the gateway; keep any base path.
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/gateway';
  return u.toString();
}

export class OpenClawClient {
  private readonly fetchImpl: typeof fetch;
  private readonly wsFactory: WebSocketFactory | undefined;
  private readonly runMethod: string;
  private readonly clientName: string;
  private readonly methods: Record<CapabilityMethod, string>;

  /**
   * @param getToken returns the gateway bearer/connect token (from secret store).
   * @param baseUrl  the gateway HTTP base, e.g. `http://127.0.0.1:18789`.
   */
  constructor(
    private readonly getToken: () => string,
    private readonly baseUrl: string,
    opts: OpenClawClientOpts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.wsFactory = opts.wsFactory;
    this.runMethod = opts.runMethod ?? DEFAULT_RUN_METHOD;
    this.clientName = opts.clientName ?? 'flowclaw';
    this.methods = { ...DEFAULT_METHODS, ...(opts.methods ?? {}) };
  }

  private headers(): Record<string, string> {
    const token = this.getToken();
    // Header-only auth for HTTP. Never place the token in the URL.
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Probe the gateway with the configured token. Distinguishes unreachable
   *  (network error) from reachable-but-unauthorized (HTTP 401/403). */
  async testConnection(): Promise<ConnectionResult> {
    try {
      const res = await this.fetchImpl(this.baseUrl, { headers: this.headers() });
      return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async isReachable(): Promise<boolean> {
    return (await this.testConnection()).ok;
  }

  private resolveWsFactory(): WebSocketFactory {
    if (this.wsFactory) return this.wsFactory;
    const GlobalWS = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
    if (!GlobalWS) {
      throw new Error('No WebSocket implementation available for OpenClaw RPC.');
    }
    return (url: string): WebSocketLike => new GlobalWS(url);
  }

  /**
   * Submit a prompt to the gateway and stream normalized agent events.
   *
   * Opens a WebSocket, performs the `connect` handshake (in-band auth.token),
   * sends the run request, then yields each event frame as an {@link OpenClawEvent}
   * until the run's terminal response arrives.
   */
  async *submit(prompt: string, opts: SubmitOpts = {}): AsyncGenerator<OpenClawEvent> {
    const url = toWsUrl(this.baseUrl);
    const ws = this.resolveWsFactory()(url);

    // Bounded async queue bridging WS callbacks -> async iteration.
    const queue: OpenClawEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let finished = false;
    let failure: string | null = null;

    const wake = (): void => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    };
    const push = (e: OpenClawEvent): void => {
      queue.push(e);
      wake();
    };
    const finish = (err?: string): void => {
      finished = true;
      if (err) failure = err;
      wake();
    };

    let nextId = 0;
    const id = (): string => `f${++nextId}`;
    const connectId = id();
    const runId = id();
    let connected = false;

    const send = (frame: unknown): void => ws.send(JSON.stringify(frame));

    ws.addEventListener('open', () => {
      send({
        type: 'req',
        id: connectId,
        method: 'connect',
        params: {
          minProtocol: PROTOCOL_MIN,
          maxProtocol: PROTOCOL_MAX,
          client: { name: this.clientName },
          role: 'operator',
          auth: { token: this.getToken() },
        },
      });
    });

    ws.addEventListener('message', (ev: { data: unknown }) => {
      let frame: ResFrame | EventFrame;
      try {
        frame = JSON.parse(String(ev.data)) as ResFrame | EventFrame;
      } catch {
        return; // ignore non-JSON frames
      }

      if (frame.type === 'res') {
        if (frame.id === connectId) {
          if (!frame.ok) {
            finish(`connect rejected: ${errMessage(frame.error)}`);
            ws.close();
            return;
          }
          connected = true;
          // Start the agent run now that the session is established.
          send({
            type: 'req',
            id: runId,
            method: this.runMethod,
            params: {
              prompt,
              ...(opts.model ? { model: opts.model } : {}),
              ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
            },
          });
          return;
        }
        if (frame.id === runId) {
          if (frame.ok) push({ type: 'done', payload: frame.payload });
          else push({ type: 'error', error: errMessage(frame.error) });
          finish();
          ws.close();
          return;
        }
        return;
      }

      if (frame.type === 'event') {
        const mapped = mapEvent(frame);
        if (mapped) push(mapped);
        return;
      }
    });

    ws.addEventListener('error', () => {
      finish(connected ? 'WebSocket error during run' : 'WebSocket connection failed');
    });
    ws.addEventListener('close', () => {
      finish();
    });

    const onAbort = (): void => {
      finish('aborted');
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift() as OpenClawEvent;
        }
        if (finished) break;
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
      // Drain anything pushed alongside the finish signal.
      while (queue.length > 0) yield queue.shift() as OpenClawEvent;
      if (failure) yield { type: 'error', error: failure };
    } finally {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * One-shot RPC: connect handshake → single method request → resolve its `res`
   * payload (or reject). Used for the non-streaming capabilities (skills, memory,
   * files, search, messaging). Times out so a dead gateway never hangs the app.
   */
  call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let ws: WebSocketLike;
      try {
        ws = this.resolveWsFactory()(toWsUrl(this.baseUrl));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      let settled = false;
      let nextId = 0;
      const id = (): string => `c${++nextId}`;
      const connectId = id();
      const callId = id();
      const done = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        fn();
      };
      const timer = setTimeout(() => done(() => reject(new Error(`RPC ${method} timed out`))), timeoutMs);
      const send = (frame: unknown): void => ws.send(JSON.stringify(frame));

      ws.addEventListener('open', () => {
        send({
          type: 'req', id: connectId, method: 'connect',
          params: { minProtocol: PROTOCOL_MIN, maxProtocol: PROTOCOL_MAX, client: { name: this.clientName }, role: 'operator', auth: { token: this.getToken() } },
        });
      });
      ws.addEventListener('message', (ev: { data: unknown }) => {
        let frame: ResFrame;
        try { frame = JSON.parse(String(ev.data)) as ResFrame; } catch { return; }
        if (frame.type !== 'res') return;
        if (frame.id === connectId) {
          if (!frame.ok) { done(() => reject(new Error(`connect rejected: ${errMessage(frame.error)}`))); return; }
          send({ type: 'req', id: callId, method, params });
          return;
        }
        if (frame.id === callId) {
          if (frame.ok) done(() => resolve(frame.payload as T));
          else done(() => reject(new Error(errMessage(frame.error))));
        }
      });
      ws.addEventListener('error', () => done(() => reject(new Error('WebSocket error during RPC'))));
      ws.addEventListener('close', () => done(() => reject(new Error('connection closed before response'))));
    });
  }

  // ---- capability wrappers (#3 skills, #4 memory, #5 files, #6 search, #7 chat) ----

  listSkills(query?: string): Promise<{ skills: Array<{ id: string; name: string; description?: string; installed?: boolean }> }> {
    return this.call(this.methods.skillsList, query ? { query } : {});
  }
  installSkill(skillId: string): Promise<{ ok: boolean }> {
    return this.call(this.methods.skillInstall, { id: skillId });
  }
  memoryGet(key: string): Promise<{ value: string | null }> {
    return this.call(this.methods.memoryGet, { key });
  }
  memorySet(key: string, value: string): Promise<{ ok: boolean }> {
    return this.call(this.methods.memorySet, { key, value });
  }
  listFiles(path = '.'): Promise<{ files: Array<{ path: string; size?: number; kind?: string }> }> {
    return this.call(this.methods.filesList, { path });
  }
  readFile(path: string): Promise<{ content: string }> {
    return this.call(this.methods.fileRead, { path });
  }
  search(query: string, source?: string): Promise<{ results: Array<{ title?: string; url?: string; snippet?: string }> }> {
    return this.call(this.methods.search, source ? { query, source } : { query });
  }
  sendMessage(channel: string, text: string): Promise<{ ok: boolean }> {
    return this.call(this.methods.messageSend, { channel, text });
  }

  // ---- messaging-app linking (connect the agent to Telegram/Discord/…) ----

  listMessagingProviders(): Promise<{ providers: MessagingProvider[] }> {
    return this.call(this.methods.messagingProviders);
  }
  listMessagingConnections(): Promise<{ connections: MessagingConnection[] }> {
    return this.call(this.methods.messagingList);
  }
  /** Link a messaging account. Credentials are forwarded to the gateway, which
   *  owns and stores them — they are never persisted by Flowstate. */
  connectMessaging(
    provider: string,
    credentials: Record<string, string>,
    label?: string,
  ): Promise<{ ok: boolean; id?: string }> {
    return this.call(this.methods.messagingConnect, label ? { provider, credentials, label } : { provider, credentials });
  }
  disconnectMessaging(id: string): Promise<{ ok: boolean }> {
    return this.call(this.methods.messagingDisconnect, { id });
  }
}

/** Normalize a gateway event frame into an {@link OpenClawEvent}, or null to skip. */
function mapEvent(frame: EventFrame): OpenClawEvent | null {
  const p = (frame.payload ?? {}) as Record<string, unknown>;
  const name = frame.event;

  // Text deltas: `payload.text` or `payload.delta`.
  if (typeof p['text'] === 'string') return { type: 'text', text: p['text'] };
  if (typeof p['delta'] === 'string') return { type: 'text', text: p['delta'] };

  // Tool calls: event name mentions a tool and payload names it.
  if (name.includes('tool') && typeof p['name'] === 'string') {
    const ev: OpenClawEvent = { type: 'tool-call', name: p['name'], args: p['args'] ?? p['input'] };
    if (typeof p['id'] === 'string') ev.id = p['id'];
    return ev;
  }

  // Terminal events expressed as events rather than the run response.
  if (name === 'turn.completed' || name === 'done' || name === 'agent.done') {
    return { type: 'done', payload: frame.payload };
  }
  return null;
}
