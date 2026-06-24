import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-mig4-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 004 — agent tool_perms / approval_policy', () => {
  it('adds the columns', () => {
    const db = openDatabase(dbPath);
    const cols = db.prepare("PRAGMA table_info('agents')").all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['tool_perms', 'approval_policy']));
    db.close();
  });

  it('records schema_version 4', () => {
    const db = openDatabase(dbPath);
    // Later migrations bump MAX(version) — assert 4 was applied, not that
    // it is the latest.
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM schema_version WHERE version = 4')
      .get() as { n: number };
    expect(row.n).toBe(1);
    db.close();
  });

  it('Code Helper has shell enabled and cautious policy after backfill', () => {
    const db = openDatabase(dbPath);
    const row = db
      .prepare(
        "SELECT tool_perms, approval_policy FROM agents WHERE id = 'agent-code-helper'",
      )
      .get() as { tool_perms: string; approval_policy: string };
    const perms = JSON.parse(row.tool_perms) as { shell_enabled: boolean; delete_enabled: boolean };
    expect(perms.shell_enabled).toBe(true);
    expect(perms.delete_enabled).toBe(true);
    expect(row.approval_policy).toBe('cautious');
    db.close();
  });

  it('new agent rows default to shell disabled, delete enabled, cautious', () => {
    const db = openDatabase(dbPath);
    db.prepare(
      `INSERT INTO agents (id, name, description, specialty_tags, avatar_color, system_prompt, model, workspace_path, created_at, updated_at)
       VALUES ('test-1', 'T', '', '[]', '#ffffff', 'p', 'm', '/tmp/t', 1, 1)`,
    ).run();
    const row = db
      .prepare("SELECT tool_perms, approval_policy FROM agents WHERE id = 'test-1'")
      .get() as { tool_perms: string; approval_policy: string };
    expect(JSON.parse(row.tool_perms)).toEqual({
      shell_enabled: false,
      delete_enabled: true,
    });
    expect(row.approval_policy).toBe('cautious');
    db.close();
  });
});
