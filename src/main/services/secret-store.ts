// Encrypts MCP connector secrets (API keys, tokens) at rest using the OS
// keychain via Electron's safeStorage. Connector `env` values — Stripe secret
// keys, GitHub PATs, Figma tokens — were previously persisted as plaintext in
// the settings DB; anything with read access to that file got them all.
//
// Stored values are tagged with ENC_PREFIX + base64(ciphertext). Values without
// the prefix are treated as legacy plaintext and passed through on read, then
// re-encrypted on the next save (lazy migration). The backend is injectable so
// the round-trip is unit-testable without a running Electron app.

import { safeStorage } from 'electron';

/** Pluggable crypto backend. Real app uses the OS keychain; tests use a fake. */
export interface SecretBackend {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(buf: Buffer): string;
}

const ENC_PREFIX = 'enc:v1:';

/** Backend wired to Electron safeStorage (OS keychain). Lazy + defensive so it
 *  degrades to "unavailable" outside a real Electron runtime (e.g. unit tests,
 *  Linux without a keyring) instead of throwing. */
export function electronSafeStorageBackend(): SecretBackend {
  return {
    isAvailable() {
      try {
        return safeStorage?.isEncryptionAvailable?.() ?? false;
      } catch {
        return false;
      }
    },
    encrypt(plain) {
      return safeStorage.encryptString(plain);
    },
    decrypt(buf) {
      return safeStorage.decryptString(buf);
    },
  };
}

export class SecretStore {
  constructor(private readonly backend: SecretBackend) {}

  /** True if the value carries our ciphertext tag. */
  isEncrypted(value: string): boolean {
    return value.startsWith(ENC_PREFIX);
  }

  /** Encrypt a single value. If the keychain is unavailable, returns the value
   *  unchanged (degraded but functional). Already-encrypted values pass through
   *  so repeated saves stay idempotent. */
  encryptValue(plain: string): string {
    if (this.isEncrypted(plain)) return plain;
    if (plain.length === 0) return plain;
    if (!this.backend.isAvailable()) return plain;
    const buf = this.backend.encrypt(plain);
    return ENC_PREFIX + buf.toString('base64');
  }

  /** Decrypt a single value. Legacy plaintext (no prefix) passes through. If a
   *  value is encrypted but the keychain can't decrypt it (different machine /
   *  no keyring), returns '' rather than leaking ciphertext into a subprocess. */
  decryptValue(value: string): string {
    if (!this.isEncrypted(value)) return value;
    if (!this.backend.isAvailable()) {
      // eslint-disable-next-line no-console
      console.warn('[secrets] encrypted value found but keychain unavailable — dropping it');
      return '';
    }
    try {
      const buf = Buffer.from(value.slice(ENC_PREFIX.length), 'base64');
      return this.backend.decrypt(buf);
    } catch {
      // eslint-disable-next-line no-console
      console.warn('[secrets] failed to decrypt a value — dropping it');
      return '';
    }
  }

  encryptEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!env) return undefined;
    return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, this.encryptValue(v)]));
  }

  decryptEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!env) return undefined;
    return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, this.decryptValue(v)]));
  }

  /** True if any env value across the configs is unencrypted (legacy) and the
   *  keychain is available to encrypt it — i.e. a one-time migration is due. */
  needsMigration(envs: Array<Record<string, string> | undefined>): boolean {
    if (!this.backend.isAvailable()) return false;
    return envs.some(
      (env) => env && Object.values(env).some((v) => v.length > 0 && !this.isEncrypted(v)),
    );
  }
}
