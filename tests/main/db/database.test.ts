import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-db-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('creates the file if it does not exist', () => {
    const db = openDatabase(dbPath);
    expect(db).toBeDefined();
    db.close();
  });

  it('enables WAL journal mode', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('wal');
    db.close();
  });

  it('creates the settings table on first open', () => {
    const db = openDatabase(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
    db.close();
  });

  it('records the migration version', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('is idempotent across reopens', () => {
    let db = openDatabase(dbPath);
    db.close();
    db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
