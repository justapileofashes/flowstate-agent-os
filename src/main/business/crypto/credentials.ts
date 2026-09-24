// BYOK credential store. Secrets are written as vault ciphertext only and
// are never returned through the API — list/save return fingerprint +
// last-used. Decryption happens only inside a skill's execution context,
// scoped to the company (a company can use its own credentials or ones the
// owner explicitly shared across companies — never another company's).

import type { Database } from 'better-sqlite3';
import type { CredentialDto } from '@shared/business/types';
import { parseJson, uid, type Row } from '../db/util';
import { fingerprint, Secret, type Vault } from './vault';

export interface ResolvedCredential {
  id: string;
  provider: string;
  secret: Secret;
  meta: Record<string, string>;
}

function mapCredential(r: Row): CredentialDto {
  return {
    id: r.id,
    companyId: r.company_id ?? null,
    provider: r.provider,
    label: r.label,
    fingerprint: r.fingerprint,
    meta: parseJson<Record<string, string>>(r.meta, {}),
    status: r.status,
    createdAt: r.created_at,
    lastRotatedAt: r.last_rotated_at,
    lastUsedAt: r.last_used_at ?? null,
  };
}

function cleanMeta(meta: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta ?? {})) {
    if (typeof v === 'string' && v.trim()) out[k.slice(0, 40)] = v.trim().slice(0, 300);
  }
  return out;
}

export class CredentialStore {
  constructor(
    private readonly db: Database,
    private readonly vault: Vault,
  ) {}

  save(input: {
    companyId: string | null;
    provider: string;
    label?: string;
    secret: string;
    meta?: Record<string, string>;
    now?: number;
  }): CredentialDto {
    const secret = input.secret.trim();
    if (!secret) throw new Error('secret is empty');
    const enc = this.vault.encrypt(secret); // throws VaultUnavailableError — never plaintext
    const now = input.now ?? Date.now();
    // One active credential per (company, provider): replace = rotate.
    const existing = this.db
      .prepare(
        `SELECT id FROM biz_credentials WHERE provider = ? AND status = 'active'
           AND ((company_id IS NULL AND ? IS NULL) OR company_id = ?)`,
      )
      .get(input.provider, input.companyId, input.companyId) as Row | undefined;
    if (existing) {
      this.db
        .prepare(
          `UPDATE biz_credentials SET secret_enc = ?, fingerprint = ?, label = ?, meta = ?, last_rotated_at = ?
           WHERE id = ?`,
        )
        .run(enc, fingerprint(secret), (input.label ?? '').slice(0, 120), JSON.stringify(cleanMeta(input.meta)), now, existing.id);
      return this.get(existing.id as string)!;
    }
    const id = uid();
    this.db
      .prepare(
        `INSERT INTO biz_credentials (id, company_id, provider, label, secret_enc, fingerprint, meta, status,
           created_at, last_rotated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.provider,
        (input.label ?? '').slice(0, 120),
        enc,
        fingerprint(secret),
        JSON.stringify(cleanMeta(input.meta)),
        now,
        now,
      );
    return this.get(id)!;
  }

  get(id: string): CredentialDto | null {
    const r = this.db.prepare('SELECT * FROM biz_credentials WHERE id = ?').get(id) as Row | undefined;
    return r ? mapCredential(r) : null;
  }

  /** Company-visible credentials (its own + shared). Never includes secrets. */
  list(companyId: string): CredentialDto[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM biz_credentials WHERE status = 'active' AND (company_id = ? OR company_id IS NULL)
           ORDER BY provider, created_at`,
        )
        .all(companyId) as Row[]
    ).map(mapCredential);
  }

  /** Metadata-only lookup (no decryption) — for tool availability checks. */
  has(companyId: string, provider: string): CredentialDto | null {
    const r = this.db
      .prepare(
        `SELECT * FROM biz_credentials WHERE provider = ? AND status = 'active'
           AND (company_id = ? OR company_id IS NULL)
         ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END LIMIT 1`,
      )
      .get(provider, companyId) as Row | undefined;
    return r ? mapCredential(r) : null;
  }

  /** Decrypt for execution. Company-scoped first, then shared. */
  resolve(companyId: string, provider: string, now = Date.now()): ResolvedCredential | null {
    const r = this.db
      .prepare(
        `SELECT * FROM biz_credentials WHERE provider = ? AND status = 'active'
           AND (company_id = ? OR company_id IS NULL)
         ORDER BY CASE WHEN company_id IS NULL THEN 1 ELSE 0 END LIMIT 1`,
      )
      .get(provider, companyId) as Row | undefined;
    if (!r) return null;
    const secret = new Secret(this.vault.decrypt(r.secret_enc));
    this.db.prepare('UPDATE biz_credentials SET last_used_at = ? WHERE id = ?').run(now, r.id);
    return { id: r.id, provider: r.provider, secret, meta: parseJson<Record<string, string>>(r.meta, {}) };
  }

  /** Revoke = delete the ciphertext; the row stays for the audit trail. */
  revoke(companyId: string, id: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE biz_credentials SET status = 'revoked', secret_enc = '', fingerprint = 'revoked'
         WHERE id = ? AND (company_id = ? OR company_id IS NULL)`,
      )
      .run(id, companyId);
    return res.changes > 0;
  }

  /** For vault rotation. */
  reencryptAll(convert: (old: string) => string): number {
    const rows = this.db
      .prepare("SELECT id, secret_enc FROM biz_credentials WHERE status = 'active' AND secret_enc != ''")
      .all() as Row[];
    const upd = this.db.prepare('UPDATE biz_credentials SET secret_enc = ?, last_rotated_at = ? WHERE id = ?');
    const now = Date.now();
    for (const r of rows) upd.run(convert(r.secret_enc), now, r.id);
    return rows.length;
  }
}
