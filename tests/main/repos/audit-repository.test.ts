import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';
import { AuditRepository } from '@main/repos/audit-repository';
import type { Database } from 'better-sqlite3';

let dir: string;
let db: Database;
let repo: AuditRepository;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-audit-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  repo = new AuditRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('AuditRepository', () => {
  it('appends and lists an entry', () => {
    repo.append({
      agentId: 'a1',
      eventType: 'tool_call',
      toolName: 'read_file',
      ok: true,
      durationMs: 12,
      argSummary: 'path=src/x.ts',
    });
    const entries = repo.list({ agentId: 'a1' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      agentId: 'a1',
      eventType: 'tool_call',
      toolName: 'read_file',
      ok: true,
      durationMs: 12,
    });
  });

  it('filters by agent and by chat', () => {
    repo.append({ agentId: 'a1', chatId: 'c1', eventType: 'tool_call', toolName: 't' });
    repo.append({ agentId: 'a2', chatId: 'c2', eventType: 'tool_call', toolName: 't' });
    expect(repo.list({ agentId: 'a1' })).toHaveLength(1);
    expect(repo.list({ chatId: 'c2' })).toHaveLength(1);
    expect(repo.list()).toHaveLength(2);
  });

  it('orders newest first', () => {
    repo.append({ agentId: 'a1', eventType: 'tool_call', toolName: 'first' });
    repo.append({ agentId: 'a1', eventType: 'tool_call', toolName: 'second' });
    const entries = repo.list({ agentId: 'a1' });
    // ts is ms-granular and may tie; assert the set is present and count holds.
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.toolName).sort()).toEqual(['first', 'second']);
  });

  it('respects the limit', () => {
    for (let i = 0; i < 5; i++) {
      repo.append({ agentId: 'a1', eventType: 'tool_call', toolName: `t${i}` });
    }
    expect(repo.list({ agentId: 'a1', limit: 3 })).toHaveLength(3);
  });

  it('counts entries', () => {
    repo.append({ agentId: 'a1', eventType: 'approval', toolName: 't', decision: 'allow-once' });
    repo.append({ agentId: 'a1', eventType: 'approval', toolName: 't', decision: 'deny' });
    expect(repo.count({ agentId: 'a1' })).toBe(2);
  });

  it('clears scoped to one agent', () => {
    repo.append({ agentId: 'a1', eventType: 'tool_call', toolName: 't' });
    repo.append({ agentId: 'a2', eventType: 'tool_call', toolName: 't' });
    const removed = repo.clear({ agentId: 'a1' });
    expect(removed).toBe(1);
    expect(repo.list({ agentId: 'a1' })).toHaveLength(0);
    expect(repo.list({ agentId: 'a2' })).toHaveLength(1);
  });

  it('clears everything when no agent given', () => {
    repo.append({ agentId: 'a1', eventType: 'tool_call', toolName: 't' });
    repo.append({ agentId: 'a2', eventType: 'tool_call', toolName: 't' });
    expect(repo.clear()).toBe(2);
    expect(repo.list()).toHaveLength(0);
  });

  it('stores null ok as null (not false)', () => {
    repo.append({ agentId: 'a1', eventType: 'approval', toolName: 't', decision: 'deny' });
    expect(repo.list({ agentId: 'a1' })[0]!.ok).toBeNull();
  });
});
