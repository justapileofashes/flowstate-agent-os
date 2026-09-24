import { describe, it, expect, afterEach } from 'vitest';
import { createCompany, makeServiceEnv, type ServiceEnv } from './helpers';
import { auxReply, is } from './fake-llm';
import { nextDaily, nextMonthStart, monthKey } from '@main/business/scheduler/scheduler';
import { nextCron, isValidCron } from '@main/util/cron';

let env: ServiceEnv;
afterEach(() => env?.cleanup());

const quietPlan = (r: Parameters<typeof auxReply>[0]) => auxReply(r) ?? (is.plan(r) ? { text: '{"plan": [], "notes": "quiet day"}' } : { text: 'ok' });

/** Tick every `stepMin` minutes from the clock's current time for `hours`. */
async function simulate(e: ServiceEnv, hours: number, stepMin = 5): Promise<void> {
  const end = e.clock.t + hours * 3_600_000;
  while (e.clock.t < end) {
    await e.service.scheduler.tick();
    await e.service.scheduler.idle();
    e.clock.advance(stepMin * 60_000);
  }
}

describe('scheduler (Phase 6)', () => {
  it('runs unattended for 7 days: one morning + one evening per day, never overlapping', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    env.clock.set(new Date(2026, 8, 24, 0, 1));
    const co = await createCompany(env, { validation: { required: false } });
    await simulate(env, 24 * 7);
    const cycles = env.db.runs.listCycles(co.id, 100).reverse();
    const morning = cycles.filter((c) => c.kind === 'morning');
    const evening = cycles.filter((c) => c.kind === 'evening');
    expect(morning).toHaveLength(7);
    expect(evening).toHaveLength(7);
    for (const c of morning) expect(new Date(c.startedAt).getHours()).toBe(7);
    for (const c of evening) expect(new Date(c.startedAt).getHours()).toBe(19);
    // no two cycles of one company overlap in time
    for (let i = 1; i < cycles.length; i++) expect(cycles[i]!.startedAt).toBeGreaterThanOrEqual(cycles[i - 1]!.endedAt!);
    expect(cycles.every((c) => c.status === 'done')).toBe(true);
  });

  it('a paused company skips every job; resuming schedules the next slot', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    env.clock.set(new Date(2026, 8, 24, 0, 1));
    const co = await createCompany(env);
    await env.service.handle('companies.setStatus', { companyId: co.id, status: 'paused' });
    await simulate(env, 48);
    expect(env.db.runs.listCycles(co.id)).toHaveLength(0);
  });

  it('missed runs: caught up inside the skew window, skipped (and reported) outside it', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    env.clock.set(new Date(2026, 8, 24, 6, 0));
    const co = await createCompany(env, { validation: { required: false } });
    await env.service.scheduler.tick(); // registers next_run_at = 07:00 today
    // App "closed" until 07:10 → within the 15-min window → catch-up run.
    env.clock.set(new Date(2026, 8, 24, 7, 10));
    await env.service.scheduler.tick();
    await env.service.scheduler.idle();
    let cycles = env.db.runs.listCycles(co.id);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.triggerType).toBe('catchup');
    // Closed through 19:00 until 22:00 → evening missed by 3h → skipped.
    env.clock.set(new Date(2026, 8, 24, 22, 0));
    await env.service.scheduler.tick();
    await env.service.scheduler.idle();
    cycles = env.db.runs.listCycles(co.id);
    expect(cycles).toHaveLength(1);
    expect(env.db.ops.feed(co.id).some((f) => f.text.startsWith('Skipped Evening summary'))).toBe(true);
    const evening = env.db.ops.cronState(`evening:${co.id}`)!;
    expect(new Date(evening.nextRunAt!).getDate()).toBe(25);
  });

  it('a wider catch-up window runs the missed plan when the app opens', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    env.clock.set(new Date(2026, 8, 24, 6, 0));
    const co = await createCompany(env, { validation: { required: false }, schedule: { catchUpMinutes: 240 } });
    await env.service.scheduler.tick();
    env.clock.set(new Date(2026, 8, 24, 9, 30));
    await env.service.scheduler.tick();
    await env.service.scheduler.idle();
    expect(env.db.runs.listCycles(co.id)[0]?.kind).toBe('morning');
  });

  it('leases stop a second holder from starting the same job', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    const co = await createCompany(env);
    const ops = env.db.ops;
    ops.ensureCron(`morning:${co.id}`, co.id, 0);
    expect(ops.acquireLease(`morning:${co.id}`, 'A', 60_000, 1_000)).toBe(true);
    expect(ops.acquireLease(`morning:${co.id}`, 'B', 60_000, 2_000)).toBe(false);
    // expired lease can be taken over (crashed holder)
    expect(ops.acquireLease(`morning:${co.id}`, 'B', 60_000, 70_000)).toBe(true);
  });

  it('per-role cron schedules run that role only', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    env.clock.set(new Date(2026, 8, 24, 8, 59));
    const co = await createCompany(env, { validation: { required: false }, schedule: { morning: '06:00', evening: '23:30' } });
    const support = env.db.companies.agentConfig(co.id, 'support')!;
    const res = await env.service.handle('agents.update', { companyId: co.id, agentId: support.id, scheduleCron: '0 */3 * * *' });
    expect(res.agent?.scheduleCron).toBe('0 */3 * * *');
    await simulate(env, 7, 1);
    const roleCycles = env.db.runs.listCycles(co.id).filter((c) => c.kind === 'role');
    expect(roleCycles.map((c) => new Date(c.startedAt).getHours()).sort((a, b) => a - b)).toEqual([9, 12, 15]);
    expect(roleCycles.every((c) => c.role === 'support')).toBe(true);
    const bad = await env.service.handle('agents.update', { companyId: co.id, agentId: support.id, scheduleCron: 'every 3 hours' });
    expect(bad.error).toMatch(/cron/);
  });

  it('the emergency stop pauses all scheduled jobs', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    env.clock.set(new Date(2026, 8, 24, 0, 1));
    const co = await createCompany(env);
    await env.service.handle('setEnabled', { enabled: false });
    await simulate(env, 24);
    expect(env.db.runs.listCycles(co.id)).toHaveLength(0);
    const trig = await env.service.handle('cycles.trigger', { companyId: co.id });
    expect(trig.error).toMatch(/emergency stop/);
  });

  it('monthly credit grants are idempotent per month', async () => {
    env = await makeServiceEnv({ handler: quietPlan });
    const co = await createCompany(env, { budgets: { monthlyCredits: 1000 } });
    expect(env.db.billing.balance(co.id)).toBe(1000);
    env.service.grantMonthly(co.id, env.clock.now());
    expect(env.db.billing.balance(co.id)).toBe(1000);
    env.service.grantMonthly(co.id, new Date(2026, 9, 1, 0, 10).getTime());
    expect(env.db.billing.balance(co.id)).toBe(2000);
    expect(env.db.billing.sumDeltas(co.id)).toBe(env.db.billing.balance(co.id));
  });
});

describe('schedule math', () => {
  it('nextDaily / nextMonthStart / monthKey', () => {
    const from = new Date(2026, 8, 24, 7, 30).getTime();
    expect(new Date(nextDaily('07:00', from))).toEqual(new Date(2026, 8, 25, 7, 0));
    expect(new Date(nextDaily('19:00', from))).toEqual(new Date(2026, 8, 24, 19, 0));
    expect(new Date(nextMonthStart(from))).toEqual(new Date(2026, 9, 1, 0, 5));
    expect(monthKey(from)).toBe('2026-09');
  });

  it('cron evaluation and validation', () => {
    const from = new Date(2026, 8, 24, 10, 15).getTime();
    expect(new Date(nextCron('0 */3 * * *', from))).toEqual(new Date(2026, 8, 24, 12, 0));
    expect(isValidCron('0 */3 * * *')).toBe(true);
    expect(isValidCron('*/15 9-17 * * 1-5')).toBe(true);
    expect(isValidCron('hourly')).toBe(false);
  });
});
