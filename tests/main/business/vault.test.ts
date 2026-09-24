import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { inspect } from 'node:util';
import { Vault, Secret, VaultUnavailableError, fingerprint } from '@main/business/crypto/vault';
import { CredentialStore } from '@main/business/crypto/credentials';
import { fakeKeyWrapper, makeCompany, makeEnv, type TestEnv } from './helpers';

let env: TestEnv;
beforeEach(() => {
  env = makeEnv();
});
afterEach(() => env.cleanup());

const SECRET = 'sk_fake_51HxyzABCDEFGHIJKLMNOPqrstu';

describe('Vault (envelope encryption)', () => {
  it('round-trips and never stores plaintext', () => {
    const token = env.vault.encrypt(SECRET);
    expect(token.startsWith('v1.')).toBe(true);
    expect(token).not.toContain(SECRET);
    expect(env.vault.decrypt(token)).toBe(SECRET);
  });

  it('stores the data key wrapped, never raw', () => {
    env.vault.encrypt('x');
    const rows = env.raw.prepare('SELECT wrapped_dek FROM biz_vault_keys').all() as Array<{ wrapped_dek: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.wrapped_dek.startsWith('TESTWRAP:')).toBe(true);
  });

  it('a fresh Vault instance (new process) can decrypt via the wrapped key', () => {
    const token = env.vault.encrypt(SECRET);
    const again = new Vault(env.raw, fakeKeyWrapper());
    expect(again.decrypt(token)).toBe(SECRET);
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const token = env.vault.encrypt(SECRET);
    const parts = token.split('.');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64url');
    expect(() => env.vault.decrypt(parts.join('.'))).toThrow();
  });

  it('refuses to encrypt when no keychain is available', () => {
    const v = new Vault(env.raw, fakeKeyWrapper(false));
    expect(() => v.encrypt(SECRET)).toThrow(VaultUnavailableError);
  });

  it('rotation re-encrypts values under a new key and retires the old one', () => {
    const token = env.vault.encrypt(SECRET);
    const oldKey = token.split('.')[1];
    let rotated = '';
    const newId = env.vault.rotate((convert) => {
      rotated = convert(token);
    });
    expect(rotated.split('.')[1]).toBe(newId);
    expect(newId).not.toBe(oldKey);
    expect(env.vault.decrypt(rotated)).toBe(SECRET);
    const statuses = env.raw.prepare('SELECT status FROM biz_vault_keys ORDER BY created_at').all() as Array<{ status: string }>;
    expect(statuses.map((s) => s.status).sort()).toEqual(['active', 'retired']);
  });

  it('Secret never serializes its value', () => {
    const s = new Secret(SECRET);
    expect(JSON.stringify({ s })).not.toContain(SECRET);
    expect(String(s)).toBe('<redacted>');
    expect(inspect(s)).not.toContain(SECRET);
    expect(s.reveal()).toBe(SECRET);
  });

  it('fingerprints show a hash + last four only', () => {
    const fp = fingerprint(SECRET);
    expect(fp).toMatch(/^[0-9a-f]{8}…rstu$/);
    expect(fp).not.toContain('sk_fake');
  });

  it('sealArgs falls back to tagged plaintext without a keychain', () => {
    const v = new Vault(env.raw, fakeKeyWrapper(false));
    const sealed = v.sealArgs({ to: 'a@b.co' });
    expect(sealed.startsWith('plain:')).toBe(true);
    expect(v.openArgs(sealed)).toEqual({ to: 'a@b.co' });
    const enc = env.vault.sealArgs({ to: 'a@b.co' });
    expect(enc).not.toContain('a@b.co');
    expect(env.vault.openArgs(enc)).toEqual({ to: 'a@b.co' });
  });
});

describe('CredentialStore', () => {
  it('writes ciphertext only and never returns the secret', () => {
    const co = makeCompany(env);
    const dto = env.creds.save({ companyId: co.id, provider: 'stripe', label: 'Live', secret: SECRET });
    expect(JSON.stringify(dto)).not.toContain(SECRET);
    expect(JSON.stringify(env.creds.list(co.id))).not.toContain(SECRET);
    const raw = env.raw.prepare('SELECT * FROM biz_credentials').all();
    expect(JSON.stringify(raw)).not.toContain(SECRET);
  });

  it('resolves for the owning company and records last use', () => {
    const co = makeCompany(env);
    const dto = env.creds.save({ companyId: co.id, provider: 'stripe', secret: SECRET, meta: { account: 'acct_1' } });
    expect(dto.lastUsedAt).toBeNull();
    const r = env.creds.resolve(co.id, 'stripe', 1234);
    expect(r?.secret.reveal()).toBe(SECRET);
    expect(r?.meta).toEqual({ account: 'acct_1' });
    expect(env.creds.get(dto.id)?.lastUsedAt).toBe(1234);
  });

  it("cross-company reads return nothing (another company's key is invisible)", () => {
    const a = makeCompany(env, { name: 'A' });
    const b = makeCompany(env, { name: 'B' });
    env.creds.save({ companyId: a.id, provider: 'stripe', secret: SECRET });
    expect(env.creds.resolve(b.id, 'stripe')).toBeNull();
    expect(env.creds.list(b.id)).toEqual([]);
    expect(env.creds.has(b.id, 'stripe')).toBeNull();
  });

  it('shared credentials are visible to every company; company-scoped wins', () => {
    const a = makeCompany(env, { name: 'A' });
    env.creds.save({ companyId: null, provider: 'tavily', secret: 'tvly-shared-000000000000' });
    expect(env.creds.resolve(a.id, 'tavily')?.secret.reveal()).toBe('tvly-shared-000000000000');
    env.creds.save({ companyId: a.id, provider: 'tavily', secret: 'tvly-mine-1111111111111' });
    expect(env.creds.resolve(a.id, 'tavily')?.secret.reveal()).toBe('tvly-mine-1111111111111');
  });

  it('saving again for the same provider rotates in place', () => {
    const co = makeCompany(env);
    const first = env.creds.save({ companyId: co.id, provider: 'resend', secret: 're_aaaaaaaaaaaaaaaa' });
    const second = env.creds.save({ companyId: co.id, provider: 'resend', secret: 're_bbbbbbbbbbbbbbbb' });
    expect(second.id).toBe(first.id);
    expect(env.creds.resolve(co.id, 'resend')?.secret.reveal()).toBe('re_bbbbbbbbbbbbbbbb');
  });

  it('revoke drops the ciphertext and hides the credential', () => {
    const co = makeCompany(env);
    const dto = env.creds.save({ companyId: co.id, provider: 'resend', secret: 're_aaaaaaaaaaaaaaaa' });
    expect(env.creds.revoke(co.id, dto.id)).toBe(true);
    expect(env.creds.resolve(co.id, 'resend')).toBeNull();
    const row = env.raw.prepare('SELECT secret_enc, status FROM biz_credentials WHERE id = ?').get(dto.id) as {
      secret_enc: string;
      status: string;
    };
    expect(row).toEqual({ secret_enc: '', status: 'revoked' });
  });

  it('refuses to store when the keychain is unavailable', () => {
    const co = makeCompany(env);
    const store = new CredentialStore(env.raw, new Vault(env.raw, fakeKeyWrapper(false)));
    expect(() => store.save({ companyId: co.id, provider: 'stripe', secret: SECRET })).toThrow(VaultUnavailableError);
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM biz_credentials').get()).toEqual({ n: 0 });
  });

  it('vault rotation keeps credentials usable', () => {
    const co = makeCompany(env);
    env.creds.save({ companyId: co.id, provider: 'stripe', secret: SECRET });
    env.vault.rotate((convert) => env.creds.reencryptAll(convert));
    expect(env.creds.resolve(co.id, 'stripe')?.secret.reveal()).toBe(SECRET);
  });
});

describe('Company config versioning', () => {
  it('appends versions and keeps history diffable', () => {
    const co = makeCompany(env);
    expect(co.activeConfigVersion).toBe(1);
    const next = env.db.companies.updateConfig(co.id, { ...co.config, brandVoice: 'bold' }, 'user', 'voice change');
    expect(next.activeConfigVersion).toBe(2);
    expect(next.config.brandVoice).toBe('bold');
    const hist = env.db.companies.history(co.id);
    expect(hist.map((h) => h.version)).toEqual([2, 1]);
    expect(hist[1]!.config.brandVoice).toBe('plain, friendly, no hype');
  });

  it('seeds all nine roles and deletes cascade with the company', () => {
    const co = makeCompany(env);
    expect(env.db.companies.agentConfigs(co.id)).toHaveLength(9);
    env.db.companies.delete(co.id);
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM biz_agent_configs').get()).toEqual({ n: 0 });
    expect(env.raw.prepare('SELECT COUNT(*) AS n FROM biz_company_configs').get()).toEqual({ n: 0 });
  });
});
