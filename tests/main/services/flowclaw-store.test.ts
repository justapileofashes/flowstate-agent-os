import { describe, it, expect } from 'vitest';
import { SecretStore, type SecretBackend } from '@main/services/secret-store';
import {
  SettingsConnectionStore,
  parseConnections,
  FLOWCLAW_SETTINGS_KEY,
} from '@main/services/flowclaw-store';

// Reversible fake keychain so encryptValue/decryptValue round-trip in tests.
const fakeBackend: SecretBackend = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from('K:' + plain, 'utf8'),
  decrypt: (buf) => buf.toString('utf8').slice(2),
};

function makeKV(): { get(k: string): string | undefined; set(k: string, v: string): void; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return { raw, get: (k) => raw.get(k), set: (k, v) => void raw.set(k, v) };
}

function makeStore() {
  const kv = makeKV();
  const store = new SettingsConnectionStore(kv, new SecretStore(fakeBackend));
  return { kv, store };
}

describe('SettingsConnectionStore', () => {
  it('stores a connection and round-trips its token (decrypted only via getSecret)', () => {
    const { kv, store } = makeStore();
    store.upsert({
      id: 'h1',
      kind: 'hermes',
      label: 'Local Hermes',
      baseUrl: 'http://127.0.0.1:9090',
      model: 'llama3.1:8b',
      enabled: true,
      token: 'super-secret',
    });

    // list()/get() never expose the token.
    expect(store.list()).toEqual([
      { id: 'h1', kind: 'hermes', label: 'Local Hermes', baseUrl: 'http://127.0.0.1:9090', model: 'llama3.1:8b', enabled: true },
    ]);
    expect((store.get('h1') as unknown as Record<string, unknown>)['token']).toBeUndefined();

    // getSecret decrypts the original.
    expect(store.getSecret('h1')).toBe('super-secret');

    // The token is encrypted at rest — raw settings JSON must not contain plaintext.
    const persisted = kv.raw.get(FLOWCLAW_SETTINGS_KEY)!;
    expect(persisted.includes('super-secret')).toBe(false);
    expect(persisted.includes('enc:v1:')).toBe(true);
  });

  it('preserves the existing token when an edit omits it', () => {
    const { store } = makeStore();
    store.upsert({ id: 'h1', kind: 'hermes', label: 'H', baseUrl: 'http://x:1', enabled: true, token: 'tok' });
    store.upsert({ id: 'h1', kind: 'hermes', label: 'Renamed', baseUrl: 'http://x:2', enabled: false });
    expect(store.getSecret('h1')).toBe('tok');
    const c = store.get('h1');
    expect(c?.label).toBe('Renamed');
    expect(c?.baseUrl).toBe('http://x:2');
    expect(c?.enabled).toBe(false);
  });

  it('replaces the token when a new one is provided', () => {
    const { store } = makeStore();
    store.upsert({ id: 'h1', kind: 'hermes', label: 'H', baseUrl: 'http://x:1', enabled: true, token: 'old' });
    store.upsert({ id: 'h1', kind: 'hermes', label: 'H', baseUrl: 'http://x:1', enabled: true, token: 'new' });
    expect(store.getSecret('h1')).toBe('new');
  });

  it('removes a connection', () => {
    const { store } = makeStore();
    store.upsert({ id: 'o1', kind: 'openclaw', label: 'O', baseUrl: 'http://127.0.0.1:18789', enabled: true });
    expect(store.list()).toHaveLength(1);
    store.remove('o1');
    expect(store.list()).toHaveLength(0);
  });

  it('parseConnections drops malformed entries', () => {
    expect(parseConnections(undefined)).toEqual([]);
    expect(parseConnections('not json')).toEqual([]);
    expect(
      parseConnections(
        JSON.stringify([
          { id: 'ok', kind: 'hermes', baseUrl: 'http://h', enabled: true },
          { id: 'bad-kind', kind: 'nope', baseUrl: 'http://h' },
          { kind: 'hermes', baseUrl: 'http://h' }, // no id
          { id: 'no-url', kind: 'openclaw' },
          'garbage',
        ]),
      ).map((c) => c.id),
    ).toEqual(['ok']);
  });
});
