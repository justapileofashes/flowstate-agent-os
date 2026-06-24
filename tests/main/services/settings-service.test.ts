import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';
import { SettingsService } from '@main/services/settings-service';
import type { Database } from 'better-sqlite3';

let dir: string;
let db: Database;
let svc: SettingsService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-settings-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  svc = new SettingsService(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('returns null for unknown key', () => {
    expect(svc.get('nope')).toBeNull();
  });

  it('round-trips a value', () => {
    svc.set('workspaces_dir', '/tmp/ws');
    expect(svc.get('workspaces_dir')).toBe('/tmp/ws');
  });

  it('overwrites existing value', () => {
    svc.set('theme', 'dark');
    svc.set('theme', 'light');
    expect(svc.get('theme')).toBe('light');
  });

  it('lists all settings', () => {
    svc.set('a', '1');
    svc.set('b', '2');
    const items = svc.list().sort((x, y) => x.key.localeCompare(y.key));
    expect(items).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('throws on empty key', () => {
    expect(() => svc.set('', 'x')).toThrow();
  });
});

describe('SettingsService secret encryption at rest', () => {
  // Fake backend: reversible "encryption" tagged so we can assert ciphertext
  // never lands in the DB for secret keys.
  const TAG = 'ENC::';
  const backend = {
    encryptValue: (p: string) => (p.startsWith(TAG) ? p : TAG + Buffer.from(p).toString('base64')),
    decryptValue: (v: string) => (v.startsWith(TAG) ? Buffer.from(v.slice(TAG.length), 'base64').toString() : v),
  };
  let sdir: string;
  let sdb: Database;
  let ssvc: SettingsService;

  beforeEach(() => {
    sdir = mkdtempSync(join(tmpdir(), 'flowstate-settings-sec-'));
    sdb = openDatabase(join(sdir, 'test.sqlite'));
    ssvc = new SettingsService(sdb, backend);
  });
  afterEach(() => {
    sdb.close();
    rmSync(sdir, { recursive: true, force: true });
  });

  it('stores secret keys encrypted but returns plaintext via get', () => {
    ssvc.set('anthropic_api_key', 'sk-ant-secret');
    expect(ssvc.get('anthropic_api_key')).toBe('sk-ant-secret');
    // raw row in the DB must be ciphertext, not the plaintext key
    const raw = sdb.prepare('SELECT value FROM settings WHERE key = ?').get('anthropic_api_key') as { value: string };
    expect(raw.value).not.toContain('sk-ant-secret');
    expect(raw.value.startsWith(TAG)).toBe(true);
  });

  it('does not encrypt non-secret keys', () => {
    ssvc.set('theme', 'dark');
    const raw = sdb.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as { value: string };
    expect(raw.value).toBe('dark');
  });

  it('reads back pre-existing plaintext secret (lazy migration passthrough)', () => {
    // simulate an older plaintext value written before encryption existed
    sdb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('openai_api_key', 'sk-plain');
    expect(ssvc.get('openai_api_key')).toBe('sk-plain');
  });
});
