import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-mig3-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 003 — agent metadata', () => {
  it('adds description/specialty_tags/avatar_color columns', () => {
    const db = openDatabase(dbPath);
    const cols = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['description', 'specialty_tags', 'avatar_color']),
    );
    db.close();
  });

  it('records at least schema_version 3', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(3);
    db.close();
  });

  it('backfills Code Helper description and specialty_tags', () => {
    const db = openDatabase(dbPath);
    const row = db
      .prepare(
        "SELECT description, specialty_tags, avatar_color FROM agents WHERE id = 'agent-code-helper'",
      )
      .get() as { description: string; specialty_tags: string; avatar_color: string };
    expect(row.description.length).toBeGreaterThan(0);
    expect(JSON.parse(row.specialty_tags)).toEqual(expect.arrayContaining(['coding']));
    expect(row.avatar_color).toMatch(/^#[0-9a-f]{6}$/i);
    db.close();
  });

  it('does not re-backfill on reopen', () => {
    let db = openDatabase(dbPath);
    db.prepare("UPDATE agents SET description = 'custom' WHERE id = 'agent-code-helper'").run();
    db.close();
    db = openDatabase(dbPath);
    const row = db
      .prepare("SELECT description FROM agents WHERE id = 'agent-code-helper'")
      .get() as { description: string };
    expect(row.description).toBe('custom');
    db.close();
  });
});
