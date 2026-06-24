import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BusinessStore,
  type BusinessFeedEvent,
  type BusinessProfile,
} from '@main/services/business-store';
import {
  BusinessSprintRunner,
  parseProposedActions,
  dueToday,
  TASK_GUARDRAIL,
} from '@main/services/business-sprint';

const PLAN_JSON = JSON.stringify({
  goals: ['g1', 'g2'],
  tasks: [
    { role: 'marketing', instruction: 'draft post' },
    { role: 'ops', instruction: 'check funnel' },
  ],
});

const TASK_OUTPUT = [
  'drafted it.',
  '```proposed-action',
  '{"kind":"post","title":"Launch post","body":"We shipped X"}',
  '```',
  'done.',
].join('\n');

function profile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    name: 'Lumen',
    product: 'analytics SaaS',
    audience: 'indie founders',
    goals: ['100 teams'],
    links: {},
    roleAgentIds: { strategy: 's1', marketing: 'm1', ops: 'o1' },
    schedule: { enabled: true, time: '08:00' },
    createdAt: 1,
    ...over,
  };
}

interface Fakes {
  store: BusinessStore;
  runner: BusinessSprintRunner;
  feed: BusinessFeedEvent[];
  llmCalls: Array<{ agentId: string; prompt: string; json?: boolean }>;
  taskCalls: Array<{ agentId: string; instruction: string }>;
}

function build(over: {
  llmReplies?: string[]; // consumed in order; last repeats
  taskOutput?: string;
  taskThrowsFor?: string; // instruction substring that should throw
  dir?: string;
} = {}): Fakes {
  const dir = over.dir ?? join(mkdtempSync(join(tmpdir(), 'biz-')), 'business');
  const store = new BusinessStore(dir);
  if (!store.loadProfile()) store.saveProfile(profile());
  const feed: BusinessFeedEvent[] = [];
  const llmCalls: Fakes['llmCalls'] = [];
  const taskCalls: Fakes['taskCalls'] = [];
  const replies = over.llmReplies ?? [PLAN_JSON, 'Briefing: shipped stuff.'];
  let i = 0;
  const runner = new BusinessSprintRunner({
    store,
    llmOnce: async (req) => {
      llmCalls.push({ agentId: req.agentId, prompt: req.prompt, ...(req.json !== undefined ? { json: req.json } : {}) });
      const reply = replies[Math.min(i, replies.length - 1)];
      i += 1;
      return reply ?? '';
    },
    tasks: {
      run: async (agentId, instruction) => {
        taskCalls.push({ agentId, instruction });
        if (over.taskThrowsFor && instruction.includes(over.taskThrowsFor)) {
          throw new Error('task blew up');
        }
        return over.taskOutput ?? TASK_OUTPUT;
      },
    },
    emit: (e) => {
      store.pushFeed(e);
      feed.push(e);
    },
  });
  return { store, runner, feed, llmCalls, taskCalls };
}

describe('BusinessSprintRunner — full sprint', () => {
  it('plans, executes, wraps: sprint done, actions parsed, memory appended, feed ordered', async () => {
    const f = build();
    const res = await f.runner.runSprint();
    expect(res.error).toBeUndefined();

    const sprint = f.store.sprints()[0];
    expect(sprint?.status).toBe('done');
    expect(sprint?.goals).toEqual(['g1', 'g2']);
    expect(sprint?.tasks).toHaveLength(2);
    expect(sprint?.tasks.every((t) => t.status === 'done')).toBe(true);
    expect(sprint?.briefing).toContain('Briefing');

    // actions parsed from both task outputs
    const actions = f.store.actions();
    expect(actions.length).toBe(2); // one per task output
    expect(actions[0]?.kind).toBe('post');
    expect(actions[0]?.title).toBe('Launch post');
    expect(actions[0]?.body).toBe('We shipped X');
    expect(actions[0]?.status).toBe('proposed');

    // memory gained a learnings section
    expect(f.store.readMemory()).toContain('## Learnings');

    // guardrail appended to task instructions
    expect(f.taskCalls[0]?.instruction).toContain(TASK_GUARDRAIL.trim().slice(0, 40));

    // feed ordering
    const kinds = f.feed.map((e) => e.kind);
    expect(kinds[0]).toBe('sprint-start');
    expect(kinds).toContain('phase');
    expect(kinds.filter((k) => k === 'task-start')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'task-done')).toHaveLength(2);
    expect(kinds).toContain('action-proposed');
    expect(kinds).toContain('briefing');
    expect(kinds[kinds.length - 1]).toBe('sprint-end');
  });
});

describe('BusinessSprintRunner — planner JSON handling', () => {
  it('bad JSON twice → sprint error, exactly one retry', async () => {
    const f = build({ llmReplies: ['junk', 'still junk'] });
    await f.runner.runSprint();
    expect(f.store.sprints()[0]?.status).toBe('error');
    expect(f.llmCalls).toHaveLength(2);
    expect(f.llmCalls[1]?.prompt).toContain('ONLY the JSON object');
    expect(f.feed.some((e) => e.kind === 'error')).toBe(true);
  });

  it('bad then good → sprint proceeds', async () => {
    const f = build({ llmReplies: ['junk', PLAN_JSON, 'briefing text'] });
    await f.runner.runSprint();
    expect(f.store.sprints()[0]?.status).toBe('done');
  });
});

describe('BusinessSprintRunner — task failure non-fatal', () => {
  it('one task throws → task error, sprint done', async () => {
    const f = build({ taskThrowsFor: 'check funnel' });
    await f.runner.runSprint();
    const sprint = f.store.sprints()[0];
    expect(sprint?.status).toBe('done');
    const failed = sprint?.tasks.find((t) => t.instruction === 'check funnel');
    expect(failed?.status).toBe('error');
    expect(failed?.error).toContain('task blew up');
    expect(sprint?.tasks.find((t) => t.instruction === 'draft post')?.status).toBe('done');
  });
});

describe('BusinessSprintRunner — concurrency + restart', () => {
  it('second runSprint while in-flight returns error', async () => {
    const f = build();
    const first = f.runner.runSprint();
    const second = await f.runner.runSprint();
    expect(second.error).toBe('sprint already running');
    await first;
  });

  it('non-terminal sprint at construction marked interrupted', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'biz-')), 'business');
    const seed = new BusinessStore(dir);
    seed.saveProfile(profile());
    seed.upsertSprint({ id: 'spX', status: 'running', goals: [], tasks: [], startedAt: 1 });
    const f = build({ dir });
    expect(f.store.sprints().find((s) => s.id === 'spX')?.status).toBe('error');
    expect(f.store.sprints().find((s) => s.id === 'spX')?.error).toBe('interrupted');
  });
});

describe('dueToday', () => {
  const p = profile(); // 08:00, enabled
  const nineAm = new Date(2026, 5, 12, 9, 0).getTime();
  const sevenAm = new Date(2026, 5, 12, 7, 0).getTime();
  const yesterdayNoon = new Date(2026, 5, 11, 12, 0).getTime();

  it('enabled + past time + no sprint today → true', () => {
    expect(dueToday(p, yesterdayNoon, nineAm)).toBe(true);
    expect(dueToday(p, null, nineAm)).toBe(true);
  });
  it('already ran today → false', () => {
    expect(dueToday(p, new Date(2026, 5, 12, 8, 1).getTime(), nineAm)).toBe(false);
  });
  it('before scheduled time → false', () => {
    expect(dueToday(p, null, sevenAm)).toBe(false);
  });
  it('disabled → false', () => {
    const off = profile({ schedule: { enabled: false, time: '08:00' } });
    expect(dueToday(off, null, nineAm)).toBe(false);
  });
});

describe('approval lifecycle', () => {
  it('approve executes via tasks.run and marks done with result', async () => {
    // output keeps the fence (so the sprint proposes an action) plus a marker
    // we can assert lands in the approval result
    const f = build({ taskOutput: `posted it manually-ready\n${TASK_OUTPUT}` });
    await f.runner.runSprint();
    const id = f.store.actions()[0]?.id ?? '';
    const before = f.taskCalls.length;
    const res = await f.runner.approve(id);
    expect(res.ok).toBe(true);
    const after = f.store.actions().find((a) => a.id === id);
    expect(after?.status).toBe('done');
    expect(after?.result).toContain('posted it');
    // tasks.run got the approval prompt containing the body
    expect(f.taskCalls.length).toBe(before + 1);
    expect(f.taskCalls[f.taskCalls.length - 1]?.instruction).toContain('We shipped X');
  });

  it('approve failure → failed; reject → rejected', async () => {
    const f = build({ taskThrowsFor: 'Execute exactly' });
    await f.runner.runSprint();
    const actions = f.store.actions();
    const a1 = actions[0]?.id ?? '';
    const a2 = actions[1]?.id ?? '';
    await f.runner.approve(a1);
    expect(f.store.actions().find((a) => a.id === a1)?.status).toBe('failed');
    const res = await f.runner.reject(a2);
    expect(res.ok).toBe(true);
    expect(f.store.actions().find((a) => a.id === a2)?.status).toBe('rejected');
  });

  it('approve unknown id → ok:false', async () => {
    const f = build();
    expect((await f.runner.approve('nope')).ok).toBe(false);
  });
});

describe('parseProposedActions', () => {
  it('parses multiple blocks, skips junk, coerces unknown kind', () => {
    const text = [
      '```proposed-action',
      '{"kind":"email","title":"A","body":"a"}',
      '```',
      'middle',
      '```proposed-action',
      'not json at all',
      '```',
      '```proposed-action',
      '{"kind":"tweetstorm","title":"B","body":"b"}',
      '```',
      '```proposed-action',
      '{"kind":"post","title":"","body":"no title"}',
      '```',
    ].join('\n');
    const out = parseProposedActions(text, 'sp1', 'marketing', 123);
    expect(out).toHaveLength(2);
    expect(out[0]?.kind).toBe('email');
    expect(out[1]?.kind).toBe('other'); // unknown coerced
    expect(out.every((a) => a.sprintId === 'sp1' && a.role === 'marketing')).toBe(true);
    expect(out.every((a) => a.status === 'proposed')).toBe(true);
  });
});
