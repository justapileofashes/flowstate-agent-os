import { describe, it, expect } from 'vitest';
import { SecretStore, type SecretBackend } from '@main/services/secret-store';
import { ZoomCredsStore, ZOOM_CREDS_KEY } from '@main/services/zoom-creds';

/** Reversible fake "encryption" so tests can assert ciphertext at rest. */
function fakeBackend(): SecretBackend {
  return {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from([...plain].reverse().join('')),
    decrypt: (buf) => [...buf.toString()].reverse().join(''),
  };
}

function fakeKV(): {
  get(k: string): string | null;
  set(k: string, v: string): void;
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  return { get: (k) => raw.get(k) ?? null, set: (k, v) => void raw.set(k, v), raw };
}

describe('ZoomCredsStore', () => {
  it('round-trips creds, encrypting the client secret at rest', () => {
    const kv = fakeKV();
    const store = new ZoomCredsStore(kv, new SecretStore(fakeBackend()));
    store.save({ accountId: 'acc1', clientId: 'cid', clientSecret: 'topsecret' });

    // At rest: secret is ciphertext, not plaintext.
    const persisted = kv.raw.get(ZOOM_CREDS_KEY) ?? '';
    expect(persisted).not.toContain('topsecret');
    expect(persisted).toContain('enc:v1:');

    // Loaded: decrypted.
    expect(store.load()).toEqual({ accountId: 'acc1', clientId: 'cid', clientSecret: 'topsecret' });
  });

  it('returns null when nothing is stored or the blob is junk', () => {
    const kv = fakeKV();
    const store = new ZoomCredsStore(kv, new SecretStore(fakeBackend()));
    expect(store.load()).toBeNull();
    kv.set(ZOOM_CREDS_KEY, 'not json');
    expect(store.load()).toBeNull();
    kv.set(ZOOM_CREDS_KEY, JSON.stringify({ accountId: 'a' })); // missing fields
    expect(store.load()).toBeNull();
  });
});
