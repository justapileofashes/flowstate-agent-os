// Envelope encryption for business secrets (BYOK API keys, tokens) and
// approval args. A random 256-bit data key (DEK) encrypts values with
// AES-256-GCM; the DEK itself is stored only *wrapped* by the key-encryption
// key — the OS keychain via Electron safeStorage in the app, a fake in tests.
// Plaintext DEKs live in memory only. Rotation re-wraps everything under a
// fresh DEK. Ciphertext format: v1.<keyId>.<iv>.<tag>.<ct> (base64url parts).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { safeStorage } from 'electron';
import type { Database } from 'better-sqlite3';
import { uid, type Row } from '../db/util';

/** Key-encryption-key backend. */
export interface KeyWrapper {
  isAvailable(): boolean;
  wrap(dek: Buffer): string;
  unwrap(wrapped: string): Buffer;
}

export class VaultUnavailableError extends Error {
  constructor() {
    super(
      'Secure storage is unavailable (no OS keychain). Business credentials are never stored in plaintext — enable a keyring and retry.',
    );
    this.name = 'VaultUnavailableError';
  }
}

export function electronKeyWrapper(): KeyWrapper {
  return {
    isAvailable() {
      try {
        return safeStorage?.isEncryptionAvailable?.() ?? false;
      } catch {
        return false;
      }
    },
    wrap(dek) {
      return safeStorage.encryptString(dek.toString('base64')).toString('base64');
    },
    unwrap(wrapped) {
      return Buffer.from(safeStorage.decryptString(Buffer.from(wrapped, 'base64')), 'base64');
    },
  };
}

/** Holds a decrypted secret; refuses to serialize itself (logs, JSON, traces). */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return '<redacted>';
  }

  toString(): string {
    return '<redacted>';
  }

  [inspect.custom](): string {
    return 'Secret(<redacted>)';
  }
}

const b64u = (b: Buffer): string => b.toString('base64url');
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

export function fingerprint(secret: string): string {
  const hash = createHash('sha256').update(secret).digest('hex').slice(0, 8);
  const tail = secret.length >= 12 ? `…${secret.slice(-4)}` : '';
  return `${hash}${tail}`;
}

export class Vault {
  private keys = new Map<string, Buffer>();
  private activeId: string | null = null;

  constructor(
    private readonly db: Database,
    private readonly wrapper: KeyWrapper,
  ) {}

  available(): boolean {
    return this.wrapper.isAvailable();
  }

  isCiphertext(value: string): boolean {
    return value.startsWith('v1.') && value.split('.').length === 5;
  }

  private loadKey(id: string): Buffer {
    const cached = this.keys.get(id);
    if (cached) return cached;
    const row = this.db.prepare('SELECT wrapped_dek FROM biz_vault_keys WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new Error(`vault key ${id} not found`);
    const dek = this.wrapper.unwrap(row.wrapped_dek);
    if (dek.length !== 32) throw new Error('vault key has wrong length');
    this.keys.set(id, dek);
    return dek;
  }

  private active(): { id: string; dek: Buffer } {
    if (!this.available()) throw new VaultUnavailableError();
    if (this.activeId) return { id: this.activeId, dek: this.loadKey(this.activeId) };
    const row = this.db
      .prepare("SELECT id FROM biz_vault_keys WHERE status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get() as Row | undefined;
    if (row) {
      this.activeId = row.id as string;
      return { id: this.activeId, dek: this.loadKey(this.activeId) };
    }
    return this.createKey();
  }

  private createKey(): { id: string; dek: Buffer } {
    const id = uid();
    const dek = randomBytes(32);
    this.db
      .prepare("INSERT INTO biz_vault_keys (id, wrapped_dek, status, created_at) VALUES (?, ?, 'active', ?)")
      .run(id, this.wrapper.wrap(dek), Date.now());
    this.keys.set(id, dek);
    this.activeId = id;
    return { id, dek };
  }

  encrypt(plain: string): string {
    const { id, dek } = this.active();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    cipher.setAAD(Buffer.from(id));
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', id, b64u(iv), b64u(tag), b64u(ct)].join('.');
  }

  decrypt(token: string): string {
    if (!this.isCiphertext(token)) throw new Error('not a vault ciphertext');
    if (!this.available()) throw new VaultUnavailableError();
    const [, id, iv, tag, ct] = token.split('.') as [string, string, string, string, string];
    const dek = this.loadKey(id);
    const decipher = createDecipheriv('aes-256-gcm', dek, fromB64u(iv));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(fromB64u(tag));
    return Buffer.concat([decipher.update(fromB64u(ct)), decipher.final()]).toString('utf8');
  }

  /**
   * Rotate: mint a new DEK, re-encrypt every value the caller supplies, and
   * retire old keys. `reencrypt` receives a function old → new ciphertext.
   */
  rotate(reencrypt: (convert: (old: string) => string) => void): string {
    if (!this.available()) throw new VaultUnavailableError();
    let newId = '';
    this.db.transaction(() => {
      const oldIds = (
        this.db.prepare("SELECT id FROM biz_vault_keys WHERE status = 'active'").all() as Row[]
      ).map((r) => r.id as string);
      // Warm old keys before switching the active pointer.
      for (const id of oldIds) this.loadKey(id);
      const fresh = this.createKey();
      newId = fresh.id;
      reencrypt((old) => (this.isCiphertext(old) ? this.encrypt(this.decrypt(old)) : old));
      const now = Date.now();
      for (const id of oldIds) {
        this.db.prepare("UPDATE biz_vault_keys SET status = 'retired', retired_at = ? WHERE id = ?").run(now, id);
      }
    })();
    return newId;
  }

  /** Approval args: encrypted when possible; tagged plaintext otherwise so
   *  the queue keeps working on machines without a keyring. */
  sealArgs(args: unknown): string {
    const json = JSON.stringify(args ?? {});
    return this.available() ? this.encrypt(json) : `plain:${json}`;
  }

  openArgs(sealed: string): unknown {
    if (sealed.startsWith('plain:')) return JSON.parse(sealed.slice(6));
    return JSON.parse(this.decrypt(sealed));
  }
}
