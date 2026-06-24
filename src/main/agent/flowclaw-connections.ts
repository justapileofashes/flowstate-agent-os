// flowclaw connection registry.
//
// Owns the set of configured agent-gateway connections (Hermes / OpenClaw) and
// turns a connection id into the right client: a chat LLMProvider for Hermes, an
// OpenClawClient for OpenClaw. Persistence and secret decryption are injected
// via ConnectionStore so this stays network-/DB-free and unit-testable; the real
// app backs the store onto the settings DB + SecretStore, and IPC handlers expose
// list/add/test to the renderer.

import type { LLMProvider } from './llm-provider';
import { HermesProvider } from './hermes-provider';
import {
  OpenClawClient,
  type ConnectionResult,
  type OpenClawEvent,
  type SubmitOpts,
  type WebSocketFactory,
} from './openclaw-client';

/** A normalized run event, identical across Hermes and OpenClaw backends. */
export type FlowclawRunEvent = OpenClawEvent;

export interface RunOpts {
  /** Override the connection's configured model. */
  model?: string;
  signal?: AbortSignal;
}

export type FlowclawKind = 'hermes' | 'openclaw';

export interface FlowclawConnection {
  id: string;
  kind: FlowclawKind;
  label: string;
  /** Hermes: HTTP base (`http://host:port`). OpenClaw: gateway HTTP base. */
  baseUrl: string;
  /** Selected model id (may be a local model served by the gateway). */
  model?: string;
  enabled: boolean;
}

/** Persistence + secret access, injected so the registry is testable. */
export interface ConnectionStore {
  list(): FlowclawConnection[];
  get(id: string): FlowclawConnection | undefined;
  /** Decrypted token/api-key for a connection, or '' if none. */
  getSecret(id: string): string;
}

export interface FlowclawConnectionsOpts {
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable WebSocket factory for testing OpenClaw RPC. */
  wsFactory?: WebSocketFactory;
}

export class FlowclawConnections {
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly wsFactory: WebSocketFactory | undefined;

  constructor(
    private readonly store: ConnectionStore,
    opts: FlowclawConnectionsOpts = {},
  ) {
    this.fetchImpl = opts.fetchImpl;
    this.wsFactory = opts.wsFactory;
  }

  list(): FlowclawConnection[] {
    return this.store.list();
  }

  /** A chat provider for the connection. Hermes only — OpenClaw runs over its
   *  own WS client (see clientFor), not the chat-completions interface. */
  providerFor(id: string): LLMProvider {
    const conn = this.require(id);
    if (conn.kind !== 'hermes') {
      throw new Error(`Connection ${id} is OpenClaw, not a chat provider — use clientFor()`);
    }
    return new HermesProvider(() => this.store.getSecret(id), conn.baseUrl, {
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });
  }

  /** The OpenClaw gateway client for the connection. */
  clientFor(id: string): OpenClawClient {
    const conn = this.require(id);
    if (conn.kind !== 'openclaw') {
      throw new Error(`Connection ${id} is not an OpenClaw gateway`);
    }
    return new OpenClawClient(() => this.store.getSecret(id), conn.baseUrl, {
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      ...(this.wsFactory ? { wsFactory: this.wsFactory } : {}),
    });
  }

  /**
   * Run a prompt on a connection and stream normalized events, regardless of
   * backend: OpenClaw goes over the WS RPC, Hermes over chat-completions
   * streaming (its deltas are mapped to the same event shape). This is the
   * single entry point a routine/task dispatcher calls.
   */
  async *run(id: string, prompt: string, opts: RunOpts = {}): AsyncGenerator<FlowclawRunEvent> {
    const conn = this.require(id);

    if (conn.kind === 'openclaw') {
      const sub: SubmitOpts = {};
      const model = opts.model ?? conn.model;
      if (model) sub.model = model;
      if (opts.signal) sub.signal = opts.signal;
      yield* this.clientFor(id).submit(prompt, sub);
      return;
    }

    // Hermes: stream chat-completions and normalize deltas.
    const model = opts.model ?? conn.model;
    if (!model) {
      yield { type: 'error', error: `connection ${id} has no model selected` };
      return;
    }
    const provider = this.providerFor(id);
    try {
      const stream = provider.chatStream({
        model,
        messages: [{ role: 'user', content: prompt }],
        tools: [],
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      for await (const d of stream) {
        if (d.type === 'text') {
          yield { type: 'text', text: d.text };
        } else if (d.type === 'tool-call') {
          const ev: FlowclawRunEvent = { type: 'tool-call', name: d.name, args: d.args };
          if (d.id) ev.id = d.id;
          yield ev;
        } else if (d.type === 'done') {
          yield { type: 'done' };
        }
      }
    } catch (err) {
      yield { type: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Run a prompt and collect the full text output (errors appended inline).
   *  Convenience for non-streaming callers like the routine dispatcher. */
  async runToText(id: string, prompt: string, opts: RunOpts = {}): Promise<string> {
    let text = '';
    for await (const ev of this.run(id, prompt, opts)) {
      if (ev.type === 'text') text += ev.text;
      else if (ev.type === 'error') text += `\n[error] ${ev.error}`;
    }
    return text;
  }

  // ---- gateway capabilities (OpenClaw only) ----
  // ClawHub skills, long-term memory, cloud files, pro search, chat messaging.
  // Hermes connections don't expose these, so we guard with a clear error.

  private openclaw(id: string): OpenClawClient {
    const conn = this.require(id);
    if (conn.kind !== 'openclaw') {
      throw new Error(`Connection ${id} (${conn.kind}) does not support gateway capabilities.`);
    }
    return this.clientFor(id);
  }

  listSkills(id: string, query?: string): ReturnType<OpenClawClient['listSkills']> {
    return this.openclaw(id).listSkills(query);
  }
  installSkill(id: string, skillId: string): ReturnType<OpenClawClient['installSkill']> {
    return this.openclaw(id).installSkill(skillId);
  }
  memoryGet(id: string, key: string): ReturnType<OpenClawClient['memoryGet']> {
    return this.openclaw(id).memoryGet(key);
  }
  memorySet(id: string, key: string, value: string): ReturnType<OpenClawClient['memorySet']> {
    return this.openclaw(id).memorySet(key, value);
  }
  listFiles(id: string, path?: string): ReturnType<OpenClawClient['listFiles']> {
    return this.openclaw(id).listFiles(path);
  }
  readFile(id: string, path: string): ReturnType<OpenClawClient['readFile']> {
    return this.openclaw(id).readFile(path);
  }
  search(id: string, query: string, source?: string): ReturnType<OpenClawClient['search']> {
    return this.openclaw(id).search(query, source);
  }
  sendMessage(id: string, channel: string, text: string): ReturnType<OpenClawClient['sendMessage']> {
    return this.openclaw(id).sendMessage(channel, text);
  }
  listMessagingProviders(id: string): ReturnType<OpenClawClient['listMessagingProviders']> {
    return this.openclaw(id).listMessagingProviders();
  }
  listMessagingConnections(id: string): ReturnType<OpenClawClient['listMessagingConnections']> {
    return this.openclaw(id).listMessagingConnections();
  }
  connectMessaging(
    id: string,
    provider: string,
    credentials: Record<string, string>,
    label?: string,
  ): ReturnType<OpenClawClient['connectMessaging']> {
    return this.openclaw(id).connectMessaging(provider, credentials, label);
  }
  disconnectMessaging(id: string, messagingId: string): ReturnType<OpenClawClient['disconnectMessaging']> {
    return this.openclaw(id).disconnectMessaging(messagingId);
  }

  /** Unified reachability/auth probe for either backend. */
  async testConnection(id: string): Promise<ConnectionResult> {
    const conn = this.store.get(id);
    if (!conn) return { ok: false, error: `unknown connection: ${id}` };
    if (conn.kind === 'openclaw') {
      return this.clientFor(id).testConnection();
    }
    // Hermes: a reachable /v1/models is our connection check.
    const provider = this.providerFor(id);
    try {
      const ok = await provider.isReachable();
      return { ok };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private require(id: string): FlowclawConnection {
    const conn = this.store.get(id);
    if (!conn) throw new Error(`unknown connection: ${id}`);
    return conn;
  }
}
