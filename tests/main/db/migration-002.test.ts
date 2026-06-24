import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setHelperWorkspace } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-mig2-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('migration 002 — schema', () => {
  it('creates agents, chats, messages tables', () => {
    const db = openDatabase(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['agents', 'chats', 'messages', 'schema_version', 'settings']));
    db.close();
  });

  it('records at least schema_version 2', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(2);
    db.close();
  });

  it('messages.role has CHECK constraint', () => {
    const db = openDatabase(dbPath);
    expect(() =>
      db
        .prepare(
          'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)',
        )
        .run('m1', 'no-such-chat', 'banana', '', Date.now()),
    ).toThrow();
    db.close();
  });

  it('cascading delete: removing an agent removes its chats and messages', () => {
    const db = openDatabase(dbPath);
    const helperId = 'agent-code-helper';
    db.prepare(
      'INSERT INTO chats (id, agent_id, title, created_at, updated_at) VALUES (?,?,?,?,?)',
    ).run('c1', helperId, 't', 1, 1);
    db.prepare(
      'INSERT INTO messages (id, chat_id, role, content, created_at) VALUES (?,?,?,?,?)',
    ).run('m1', 'c1', 'user', 'hi', 1);
    db.prepare('DELETE FROM agents WHERE id = ?').run(helperId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM chats').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toMatchObject({ n: 0 });
    db.close();
  });
});

describe('migration 002 — Code Helper seed', () => {
  it('inserts Code Helper exactly once on first apply', () => {
    const db = openDatabase(dbPath);
    const rows = db.prepare('SELECT * FROM agents').all() as Array<{ id: string; name: string; workspace_path: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('agent-code-helper');
    expect(rows[0]?.name).toBe('Code Helper');
    expect(rows[0]?.workspace_path).toBe('__WORKSPACE_PLACEHOLDER__');
    db.close();
  });

  it('does not re-seed on reopen', () => {
    let db = openDatabase(dbPath);
    db.close();
    db = openDatabase(dbPath);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n;
    expect(count).toBe(1);
    db.close();
  });
});

describe('setHelperWorkspace', () => {
  it('updates the placeholder to the given absolute path', () => {
    const db = openDatabase(dbPath);
    setHelperWorkspace(db, 'C:/tmp/flowstate/code-helper');
    const row = db.prepare("SELECT workspace_path FROM agents WHERE id = 'agent-code-helper'").get() as { workspace_path: string };
    expect(row.workspace_path).toBe('C:/tmp/flowstate/code-helper');
    db.close();
  });

  it('does NOT overwrite a non-placeholder path', () => {
    const db = openDatabase(dbPath);
    setHelperWorkspace(db, 'C:/first');
    setHelperWorkspace(db, 'C:/second');
    const row = db.prepare("SELECT workspace_path FROM agents WHERE id = 'agent-code-helper'").get() as { workspace_path: string };
    expect(row.workspace_path).toBe('C:/first');
    db.close();
  });
});
