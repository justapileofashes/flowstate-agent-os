// Settings-backed persistence for flowclaw connections.
//
// Connections live as a JSON blob in the settings KV (same approach as MCP
// servers). The per-connection auth token is encrypted at rest via SecretStore
// (OS keychain) — it is NEVER returned to the renderer or included in list()/
// get(); only getSecret() decrypts it, and only the main process calls that.
//
// The parse/serialize helpers are pure and the store takes an injected KV +
// SecretStore, so the whole thing is unit-testable without Electron or the DB.

import type { SecretStore } from './secret-store';
import type {
  ConnectionStore,
  FlowclawConnection,
  FlowclawKind,
} from '@main/agent/flowclaw-connections';

export const FLOWCLAW_SETTINGS_KEY = 'flowclaw_connections';

/** Minimal settings KV surface (matches SettingsService.get/set). */
export interface SettingsKV {
  get(key: string): string | null | undefined;
  set(key: string, value: string): void;
}

/** On-disk shape: a connection plus its encrypted token. */
export interface StoredConnection extends FlowclawConnection {
  /** Encrypted token/api-key (SecretStore ciphertext), or undefined if none. */
  token?: string;
}

const KINDS: FlowclawKind[] = ['hermes', 'openclaw'];

/** Coerce persisted JSON into well-formed StoredConnection[], dropping junk. */
export function parseConnections(raw: string | null | undefined): StoredConnection[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p): StoredConnection | null => {
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        const id = typeof o['id'] === 'string' ? o['id'] : '';
        const kind = o['kind'] as FlowclawKind;
        const baseUrl = typeof o['baseUrl'] === 'string' ? o['baseUrl'] : '';
        if (!id || !KINDS.includes(kind) || !baseUrl) return null;
        const conn: StoredConnection = {
          id,
          kind,
          label: typeof o['label'] === 'string' ? o['label'] : id,
          baseUrl,
          enabled: o['enabled'] !== false,
        };
        if (typeof o['model'] === 'string') conn.model = o['model'];
        if (typeof o['token'] === 'string' && o['token'].length > 0) conn.token = o['token'];
        return conn;
      })
      .filter((c): c is StoredConnection => c !== null);
  } catch {
    return [];
  }
}

export function serializeConnections(conns: StoredConnection[]): string {
  return JSON.stringify(conns);
}

function stripToken(c: StoredConnection): FlowclawConnection {
  const { token: _token, ...rest } = c;
  return rest;
}

/** Input for upsert: a connection plus an OPTIONAL plaintext token. When the
 *  token is omitted on an edit, the existing encrypted token is preserved. */
export type ConnectionInput = FlowclawConnection & { token?: string };

export class SettingsConnectionStore implements ConnectionStore {
  constructor(
    private readonly settings: SettingsKV,
    private readonly secrets: SecretStore,
    private readonly key: string = FLOWCLAW_SETTINGS_KEY,
  ) {}

  private all(): StoredConnection[] {
    return parseConnections(this.settings.get(this.key));
  }

  private persist(conns: StoredConnection[]): void {
    this.settings.set(this.key, serializeConnections(conns));
  }

  list(): FlowclawConnection[] {
    return this.all().map(stripToken);
  }

  get(id: string): FlowclawConnection | undefined {
    const c = this.all().find((x) => x.id === id);
    return c ? stripToken(c) : undefined;
  }

  /** Decrypt the token for a connection (main-process only). '' if none. */
  getSecret(id: string): string {
    const c = this.all().find((x) => x.id === id);
    return c?.token ? this.secrets.decryptValue(c.token) : '';
  }

  /** Create or update a connection. A provided plaintext token is encrypted;
   *  an omitted token preserves the existing one (so edits don't wipe it). */
  upsert(input: ConnectionInput): void {
    const conns = this.all();
    const existing = conns.find((c) => c.id === input.id);
    const stored: StoredConnection = {
      id: input.id,
      kind: input.kind,
      label: input.label,
      baseUrl: input.baseUrl,
      enabled: input.enabled,
    };
    if (input.model) stored.model = input.model;
    if (input.token && input.token.length > 0) {
      stored.token = this.secrets.encryptValue(input.token);
    } else if (existing?.token) {
      stored.token = existing.token;
    }
    const next = existing
      ? conns.map((c) => (c.id === input.id ? stored : c))
      : [...conns, stored];
    this.persist(next);
  }

  remove(id: string): void {
    this.persist(this.all().filter((c) => c.id !== id));
  }
}
