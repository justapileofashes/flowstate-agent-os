import { describe, it, expect, afterEach } from 'vitest';
import { createCompany, json, makeServiceEnv, type ServiceEnv } from './helpers';
import { auxReply, is, roleOf, toolResults, userPrompt, type FakeHandler, type FakeRequest } from './fake-llm';

let env: ServiceEnv;
afterEach(() => env?.cleanup());

const PLAN = {
  plan: [
    { title: 'Research competitors', role: 'researcher', description: 'Find direct competitors and their pricing.', estimated_cost_credits: 20, risk_level: 'low', requires_approval: false },
    { title: 'Build this week\'s roadmap', role: 'planner', description: 'Turn findings into tasks.', estimated_cost_credits: 15, risk_level: 'low', requires_approval: false },
    { title: 'Draft a launch post', role: 'copywriter', description: 'One post for X.', estimated_cost_credits: 15, risk_level: 'low', requires_approval: false },
  ],
  notes: 'Research first, then plan, then content.',
};

function workingHandler(plan: unknown = PLAN): FakeHandler {
  return (r: FakeRequest) => {
    const aux = auxReply(r);
    if (aux) return aux;
    if (is.plan(r)) return { text: JSON.stringify(plan) };
    const done = toolResults(r).length;
    switch (roleOf(r)) {
      case 'researcher':
        return done === 0
          ? { tools: [{ name: 'knowledge_save', args: { content: 'Plausible charges $9/mo for 10k monthly pageviews', category: 'competitor', source: 'https://plausible.io/pricing' } }] }
          : { text: 'Saved one competitor finding.' };
      case 'planner':
        return done === 0
          ? { tools: [{ name: 'tasks_create', args: { title: 'Write a comparison page vs Plausible', role: 'copywriter', priority: 2, estimated_credits: 20 } }] }
          : { text: 'Added a roadmap task.' };
      case 'copywriter':
        return done === 0
          ? { tools: [{ name: 'draft_save', args: { kind: 'post', channel: 'x', title: 'Why we ditched cookies', body: 'We built analytics that respects your visitors. No banners, no tracking.' } }] }
          : { text: 'Drafted one post (not published).' };
      default:
        return { text: 'ok' };
    }
  };
}

describe('CEO cycle — plan-and-execute', () => {
  it('one cycle yields a knowledge entry, a planned task and a saved draft — and publishes nothing (Phase 4)', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env, { validation: { required: false } });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');

    expect(cycle.status).toBe('done');
    expect(cycle.plan?.plan).toHaveLength(3);
    expect(env.db.knowledge.list(co.id, { category: 'competitor' })).toHaveLength(1);
    expect(env.db.work.listTasks(co.id).some((t) => t.source === 'planner' && t.title.includes('comparison page'))).toBe(true);
    expect(env.db.work.listDrafts(co.id)).toHaveLength(1);
    expect(env.db.work.listDrafts(co.id)[0]!.status).toBe('draft');
    expect(env.http.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);

    const runs = env.db.runs.runsForCycle(cycle.id);
    expect(runs.map((r) => r.role).sort()).toEqual(['ceo', 'copywriter', 'planner', 'researcher']);
    expect(runs.filter((r) => r.role !== 'ceo').every((r) => r.stopReason === 'goal_achieved')).toBe(true);
    const ceoSteps = env.db.runs.steps(runs.find((r) => r.role === 'ceo')!.id);
    expect(ceoSteps.some((s) => s.phase === 'plan' && s.stepKind === 'llm')).toBe(true);
    expect(cycle.summary).toContain('Cycle report');
    // plan tasks mirror onto the board and finish
    const planTasks = env.db.work.listTasks(co.id).filter((t) => t.cycleId === cycle.id);
    expect(planTasks.map((t) => t.status).sort()).toEqual(['done', 'done', 'done']);
    // metering: ledger debits exist and the cycle recorded its spend
    expect(cycle.creditsSpent).toBeGreaterThan(0);
    expect(env.db.billing.ledger(co.id).some((l) => l.reason === 'cycle_spend')).toBe(true);
    expect(env.notifications.at(-1)!.body).toMatch(/Cycle finished with 3 run\(s\); 0 action\(s\) need your approval/);
  });

  it('grounds the plan in real Stripe revenue (Phase 3)', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env, { validation: { required: false } });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'stripe', secret: 'rk_fake_abcdefghijklmnopqrst' });
    const charge = (id: string, amount: number) => ({ id, amount, amount_refunded: 0, currency: 'usd', paid: true, status: 'succeeded', refunded: false, created: 1 });
    env.http
      .on('https://api.stripe.com/v1/balance', () => json({ available: [{ amount: 123_400, currency: 'usd' }], pending: [] }))
      .on('https://api.stripe.com/v1/charges', () => json({ data: [charge('ch_1', 4_900), charge('ch_2', 4_900), charge('ch_3', 4_900)], has_more: false }));
    await env.service.runner.run(co.id, 'manual', 'manual');

    const planCall = env.llm.calls.find((c) => is.plan(c))!;
    expect(userPrompt(planCall)).toContain('net_revenue_30d=147 USD');
    expect(userPrompt(planCall)).toContain('balance_available=1234 USD');
    expect(env.db.work.latestKpis(co.id).find((k) => k.key === 'net_revenue_30d')?.value).toBe(147);
  });

  it('a cycle that exceeds its cost cap terminates mid-plan with spent-vs-cap recorded (Phase 8)', async () => {
    const heavy: FakeHandler = (r) => {
      const base = workingHandler()(r);
      if (base instanceof Error || is.plan(r) || is.goalCheck(r)) return base;
      return { ...(base as object), promptTokens: 200_000, completionTokens: 1_000 };
    };
    env = await makeServiceEnv({ handler: heavy });
    const models = { planner: 'gpt-4o', writer: 'gpt-4o', coding: 'gpt-4o', cheap: 'gpt-4o', embed: '' };
    const co = await createCompany(env, { validation: { required: false }, models, budgets: { cycleCredits: 100, cycleUsd: 50 } });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');

    expect(cycle.status).toBe('budget_stopped');
    expect(cycle.stopReason).toBe('budget_exhausted');
    expect(cycle.creditsCap).toBe(100);
    expect(cycle.creditsSpent).toBeGreaterThanOrEqual(100);
    const tasks = env.db.work.listTasks(co.id).filter((t) => t.cycleId === cycle.id);
    expect(tasks.some((t) => t.status === 'skipped' && t.result === 'cycle budget exhausted')).toBe(true);
    // the ledger reconciles: every credit spent was debited
    const debits = env.db.billing.ledger(co.id, 1_000).filter((l) => l.reason === 'cycle_spend' && l.refId === cycle.id);
    expect(debits.reduce((s, l) => s - l.delta, 0)).toBeCloseTo(cycle.creditsSpent, 3);
  });

  it('shrinks an over-budget plan (re-prompt once, then deterministic truncation)', async () => {
    const big = { plan: PLAN.plan.map((p) => ({ ...p, estimated_cost_credits: 90 })), notes: '' };
    let planCalls = 0;
    env = await makeServiceEnv({
      handler: (r) => {
        if (is.plan(r)) {
          planCalls += 1;
          return { text: JSON.stringify(big) };
        }
        return workingHandler()(r);
      },
    });
    const co = await createCompany(env, { validation: { required: false }, budgets: { cycleCredits: 200 } });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    expect(planCalls).toBe(2);
    expect(userPrompt(env.llm.calls.filter((c) => is.plan(c))[1]!)).toContain('shrink it to fit');
    expect(cycle.plan!.plan).toHaveLength(2);
    expect(cycle.plan!.dropped!.some((d) => d.reason.includes('over budget'))).toBe(true);
  });

  it('the validation gate blocks build roles until the owner accepts the evidence', async () => {
    const plan = {
      plan: [
        { title: 'Cold outreach to 20 founders', role: 'sdr', description: '', estimated_cost_credits: 30 },
        { title: 'Ship pricing page', role: 'coder', description: '', estimated_cost_credits: 30 },
        { title: 'Validate the idea', role: 'researcher', description: 'Problem, competitors, demand', estimated_cost_credits: 20 },
      ],
      notes: '',
    };
    env = await makeServiceEnv({ handler: workingHandler(plan) });
    const co = await createCompany(env); // validation required by default
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    expect(cycle.plan!.plan.map((p) => p.role)).toEqual(['researcher']);
    expect(cycle.plan!.dropped!.map((d) => d.reason)).toEqual([
      'sdr is blocked until the idea is validated',
      'coder is blocked until the idea is validated',
    ]);
    const planPrompt = userPrompt(env.llm.calls.find((c) => is.plan(c))!);
    expect(planPrompt).toContain('BLOCKED UNTIL THE IDEA IS VALIDATED');
  });

  it('owner-authored tasks are injected into the next cycle', async () => {
    env = await makeServiceEnv({ handler: workingHandler({ plan: [], notes: 'nothing' }) });
    const co = await createCompany(env, { validation: { required: false } });
    const { task } = await env.service.handle('tasks.create', { companyId: co.id, title: 'Research Umami pricing', role: 'researcher' });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    expect(cycle.plan!.plan.map((p) => p.taskId)).toEqual([task.id]);
    expect(env.db.work.getTask(task.id)!.status).toBe('done');
  });

  it('triggering twice is idempotent — it never double-starts a running cycle', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    env = await makeServiceEnv({
      handler: async (r) => {
        if (is.plan(r)) await gate;
        return workingHandler()(r);
      },
    });
    const co = await createCompany(env, { validation: { required: false } });
    const a = await env.service.handle('cycles.trigger', { companyId: co.id });
    const b = await env.service.handle('cycles.trigger', { companyId: co.id });
    expect(b.alreadyRunning).toBe(true);
    expect(b.cycle!.id).toBe(a.cycle!.id);
    release();
    await env.service.runner.idle();
    expect(env.db.runs.listCycles(co.id)).toHaveLength(1);
  });

  it('refuses to spend when the monthly budget is exhausted', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env, { budgets: { monthlyCredits: 100 } });
    env.db.billing.entry({ companyId: co.id, delta: -100, reason: 'cycle_spend', note: 'spent' });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    expect(cycle.status).toBe('budget_stopped');
    expect(cycle.stopReason).toMatch(/balance is empty|Monthly budget reached/);
    expect(env.llm.calls).toHaveLength(0);
  });

  it('abort stops a running cycle and leaves a terminal state', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    env = await makeServiceEnv({
      handler: async (r) => {
        if (roleOf(r) === 'researcher' && toolResults(r).length === 0) await gate;
        return workingHandler()(r);
      },
    });
    const co = await createCompany(env, { validation: { required: false } });
    const started = await env.service.handle('cycles.trigger', { companyId: co.id });
    await new Promise((r) => setTimeout(r, 20));
    expect(await env.service.handle('cycles.abort', { companyId: co.id })).toEqual({ ok: true });
    release();
    await env.service.runner.idle();
    const final = env.db.runs.getCycle(started.cycle!.id)!;
    expect(final.status).toBe('aborted');
    expect(final.endedAt).not.toBeNull();
  });
});

describe('evening, role routines, chat, replay', () => {
  it('evening digest runs the drift checker and opens a fix task for a seeded voice mismatch (Phase 7)', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    env.db.work.createDraft({ companyId: co.id, kind: 'post', title: 'A revolutionary launch', body: 'Our revolutionary, game-changer analytics!!!' });
    const cycle = await env.service.runner.run(co.id, 'evening', 'schedule');
    expect(cycle.status).toBe('done');
    const drift = env.db.work.listTasks(co.id).find((t) => t.source === 'drift');
    expect(drift).toBeDefined();
    expect(drift!.assignedRole).toBe('copywriter');
    expect(drift!.description).toContain('revolutionary');
  });

  it('a per-role routine runs just that role', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env);
    const cycle = await env.service.runner.run(co.id, 'role', 'schedule', { role: 'researcher' });
    expect(cycle.kind).toBe('role');
    expect(env.db.runs.runsForCycle(cycle.id).map((r) => r.role).sort()).toEqual(['ceo', 'researcher']);
  });

  it('build roles are skipped by their routine while validation is pending', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env);
    const cycle = await env.service.runner.run(co.id, 'role', 'schedule', { role: 'sdr' });
    expect(cycle.status).toBe('skipped');
    expect(cycle.stopReason).toBe('validation gate');
  });

  it('chat with the CEO answers and can spawn tasks', async () => {
    env = await makeServiceEnv({
      handler: (r) => {
        const aux = auxReply(r);
        if (aux) return aux;
        return toolResults(r).length === 0
          ? { tools: [{ name: 'tasks_create', args: { title: 'Interview 5 churned users', role: 'researcher', priority: 1 } }] }
          : { text: 'Added a task to interview churned users — it runs in the next cycle.' };
      },
    });
    const co = await createCompany(env);
    const res = await env.service.handle('chat.send', { companyId: co.id, message: 'Why are users churning? Look into it.' });
    expect(res.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(res.messages[1]!.content).toContain('interview churned users');
    expect(env.db.work.listTasks(co.id).some((t) => t.title === 'Interview 5 churned users' && t.source === 'ceo')).toBe(true);
  });

  it('replay streams a run\'s steps in order and rebuilds state at any step', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env, { validation: { required: false } });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    const run = env.db.runs.runsForCycle(cycle.id).find((r) => r.role === 'researcher')!;
    const full = await env.service.handle('runs.replay', { companyId: co.id, runId: run.id });
    if ('error' in full) throw new Error(full.error);
    expect(full.narrative.map((n) => n.seqNo)).toEqual([...full.narrative.map((n) => n.seqNo)].sort((a, b) => a - b));
    expect(full.toolCalls[0]!.tool).toBe('knowledge_save');
    expect(full.stopReason).toBe('goal_achieved');
    const early = await env.service.handle('runs.replay', { companyId: co.id, runId: run.id, uptoSeq: 2 });
    if ('error' in early) throw new Error(early.error);
    expect(early.toolCalls).toHaveLength(0);
    expect(early.stopReason).toBeNull();
  });

  it('retrying a run re-runs its role with the earlier progress as context', async () => {
    env = await makeServiceEnv({ handler: workingHandler() });
    const co = await createCompany(env, { validation: { required: false } });
    const cycle = await env.service.runner.run(co.id, 'manual', 'manual');
    const run = env.db.runs.runsForCycle(cycle.id).find((r) => r.role === 'researcher')!;
    const res = await env.service.handle('runs.retry', { companyId: co.id, runId: run.id });
    await env.service.runner.idle();
    expect(res.cycle?.kind).toBe('role');
    const retryCall = env.llm.calls.filter((c) => roleOf(c) === 'researcher').at(-1)!;
    expect(userPrompt(retryCall).includes('Previous attempt') || retryCall.messages.some((m) => m.content.includes('Previous attempt'))).toBe(true);
  });
});

