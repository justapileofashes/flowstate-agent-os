import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BusinessStore,
  type BusinessProfile,
  type BusinessSprint,
  type ProposedAction,
  type BusinessFeedEvent,
} from '@main/services/business-store';

function tempDir(): string {
  return join(mkdtempSync(join(tmpdir(), 'biz-')), 'business');
}

function profile(): BusinessProfile {
  return {
    name: 'Lumen',
    product: 'analytics SaaS',
    audience: 'indie founders',
    goals: ['100 teams'],
    links: { site: 'lumen.dev' },
    roleAgentIds: { strategy: 's1', marketing: 'm1', ops: 'o1' },
    schedule: { enabled: true, time: '08:00' },
    createdAt: 1,
  };
}

function sprint(id: string, status: BusinessSprint['status'] = 'done'): BusinessSprint {
  return { id, status, goals: ['g'], tasks: [], startedAt: 1 };
}

function action(id: string): ProposedAction {
  return {
    id,
    sprintId: 'sp1',
    role: 'marketing',
    kind: 'post',
    title: 't',
    body: 'b',
    status: 'proposed',
    createdAt: 1,
    updatedAt: 1,
  };
}

function feedEvent(id: string): BusinessFeedEvent {
  return { id, ts: 1, kind: 'phase', text: 'x' };
}

describe('BusinessStore', () => {
  it('round-trips the profile, null when absent or junk', () => {
    const dir = tempDir();
    const store = new BusinessStore(dir);
    expect(store.loadProfile()).toBeNull();
    store.saveProfile(profile());
    expect(store.loadProfile()?.name).toBe('Lumen');
    writeFileSync(join(dir, 'profile.json'), 'not json');
    expect(new BusinessStore(dir).loadProfile()).toBeNull();
  });

  it('seeds memory with a header and appends sections', () => {
    const store = new BusinessStore(tempDir());
    expect(store.readMemory()).toBe('# Business memory\n');
    store.appendMemory('## Learnings — 2026-06-12\n- x');
    const mem = store.readMemory();
    expect(mem.startsWith('# Business memory\n')).toBe(true);
    expect(mem).toContain('## Learnings — 2026-06-12');
  });

  it('caps memory at 64KB trimming oldest sections, keeping header + newest', () => {
    const store = new BusinessStore(tempDir());
    for (let i = 0; i < 20; i++) {
      store.appendMemory(`## Section ${i}\n${'x'.repeat(5_000)}`);
    }
    const mem = store.readMemory();
    expect(mem.length).toBeLessThanOrEqual(64_000);
    expect(mem.startsWith('# Business memory')).toBe(true);
    expect(mem).toContain('## Section 19'); // newest survives
    expect(mem).not.toContain('## Section 0\n'); // oldest trimmed
  });

  it('round-trips sprints/actions/feed and upserts in place', () => {
    const dir = tempDir();
    const store = new BusinessStore(dir);
    store.upsertSprint(sprint('sp1', 'running'));
    store.upsertSprint({ ...sprint('sp1'), status: 'done' });
    expect(store.sprints()).toHaveLength(1);
    expect(store.sprints()[0]?.status).toBe('done');

    store.upsertAction(action('a1'));
    store.upsertAction({ ...action('a1'), status: 'approved' });
    expect(store.actions()).toHaveLength(1);
    expect(store.actions()[0]?.status).toBe('approved');

    store.pushFeed(feedEvent('f1'));
    expect(store.feed()).toHaveLength(1);

    const reread = new BusinessStore(dir);
    expect(reread.sprints()).toHaveLength(1);
    expect(reread.actions()).toHaveLength(1);
    expect(reread.feed()).toHaveLength(1);
    expect(existsSync(join(dir, 'state.json'))).toBe(true);
  });

  it('caps sprints at 30 and feed at 500, evicting oldest', () => {
    const store = new BusinessStore(tempDir());
    for (let i = 0; i < 31; i++) store.upsertSprint(sprint(`sp${i}`));
    expect(store.sprints()).toHaveLength(30);
    expect(store.sprints().find((s) => s.id === 'sp0')).toBeUndefined();
    expect(store.sprints().find((s) => s.id === 'sp30')).toBeDefined();

    for (let i = 0; i < 501; i++) store.pushFeed(feedEvent(`f${i}`));
    expect(store.feed()).toHaveLength(500);
    expect(store.feed().find((e) => e.id === 'f0')).toBeUndefined();
    expect(store.feed().find((e) => e.id === 'f500')).toBeDefined();
  });

  it('tolerates junk state.json', () => {
    const dir = tempDir();
    new BusinessStore(dir); // create dir
    writeFileSync(join(dir, 'state.json'), '{broken');
    const store = new BusinessStore(dir);
    expect(store.sprints()).toEqual([]);
    expect(store.actions()).toEqual([]);
    expect(store.feed()).toEqual([]);
  });

  it('memory survives reread from disk', () => {
    const dir = tempDir();
    const store = new BusinessStore(dir);
    store.appendMemory('## A\nhello');
    expect(readFileSync(join(dir, 'memory.md'), 'utf8')).toContain('## A');
    expect(new BusinessStore(dir).readMemory()).toContain('hello');
  });
});
