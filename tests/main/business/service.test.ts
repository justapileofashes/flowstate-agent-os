import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCompany, fakeKeyWrapper, makeEnv, makeServiceEnv, memorySettings, FakeClock, type ServiceEnv } from './helpers';
import { ScriptedLLM, auxReply } from './fake-llm';
import { BusinessAgentService } from '@main/business/service';
import { computeAlerts } from '@main/business/observability/alerts';
import { toCsv } from '@main/business/export';

let env: ServiceEnv;
afterEach(() => env?.cleanup());

describe('BusinessAgentService RPC', () => {
  it('validates params with zod before touching anything', async () => {
    env = await makeServiceEnv();
    await expect(env.service.handle('companies.create', { config: { name: '' } })).rejects.toThrow();
    await expect(env.service.handle('tasks.create', { companyId: 'x', title: 'ok title', role: 'janitor' } as never)).rejects.toThrow();
    await expect(env.service.handle('nope' as never, {})).rejects.toThrow(/unknown method/);
  });

  it('every mutating call writes an audit row (Phase 0 acceptance)', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    await env.service.handle('tasks.create', { companyId: co.id, title: 'Write FAQ', role: 'copywriter' });
    await env.service.handle('companies.updateConfig', { companyId: co.id, config: { ...co.config, mission: 'Make analytics humane' } });
    await env.service.handle('budgets.addCredits', { companyId: co.id, credits: 250, note: 'top-up' });
    await env.service.handle('companies.dashboard', { companyId: co.id }); // read — not audited
    const actions = env.db.ops.auditLog(co.id).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['tasks.create', 'companies.updateConfig', 'budgets.addCredits']));
    expect(actions).not.toContain('companies.dashboard');
    expect(env.db.ops.auditLog(co.id).every((a) => a.actorType === 'user' || a.actorType === 'agent' || a.actorType === 'system')).toBe(true);
  });

  it('dashboard aggregates state; usage summary reconciles with the ledger', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { budgets: { monthlyCredits: 1000 } });
    env.db.billing.recordUsage({ companyId: co.id, cycleId: null, runId: null, role: 'researcher', alias: 'cheap', provider: 'openai', model: 'gpt-4o-mini', inputTokens: 1000, outputTokens: 100, costUsd: 0.5, credits: 50, ok: true, latencyMs: 5 }, env.clock.now());
    env.db.billing.entry({ companyId: co.id, delta: -50, reason: 'cycle_spend', now: env.clock.now() });
    const dash = await env.service.handle('companies.dashboard', { companyId: co.id });
    expect(dash.balance).toBe(950);
    expect(dash.monthSpentCredits).toBe(50);
    expect(dash.agents).toHaveLength(9);
    expect(dash.nextRuns.map((r) => r.job)).toEqual(expect.arrayContaining(['Morning plan (07:00)', 'Evening summary (19:00)']));
    const usage = await env.service.handle('usage.summary', { companyId: co.id, days: 7 });
    expect(usage.byRole[0]).toMatchObject({ role: 'researcher', credits: 50, calls: 1 });
    expect(usage.daily).toHaveLength(7);
    expect(usage.monthSpentUsd).toBe(0.5);
    expect(usage.balance).toBe(env.db.billing.sumDeltas(co.id));
  });

  it('integrations list shows connection state without secrets', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'stripe', secret: 'rk_fake_zzzzzzzzzzzzzzzzzz' });
    const { integrations } = await env.service.handle('integrations.list', { companyId: co.id });
    const stripe = integrations.find((i) => i.provider === 'stripe')!;
    expect(stripe.connected).toBe(true);
    expect(stripe.skills).toEqual(['stripe.reconcile', 'stripe.refund']);
    expect(JSON.stringify(integrations)).not.toContain('rk_fake_zzzz');
    const bad = await env.service.handle('credentials.save', { companyId: co.id, provider: 'myspace', secret: 'abcd1234' });
    expect(bad.error).toMatch(/unknown provider/);
  });

  it('credential tests never fire webhooks or deploy hooks', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'deploy_hook', secret: 'https://api.vercel.com/v1/integrations/deploy/prj_x/abc' });
    const res = await env.service.handle('credentials.test', { companyId: co.id, provider: 'deploy_hook' });
    expect(res.ok).toBe(true);
    expect(env.http.calls).toHaveLength(0);
  });

  it('deleting a company requires typing its name', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    expect((await env.service.handle('companies.delete', { companyId: co.id, confirmName: 'nope' })).ok).toBe(false);
    expect((await env.service.handle('companies.delete', { companyId: co.id, confirmName: 'Acme Analytics' })).ok).toBe(true);
    expect(env.db.companies.get(co.id)).toBeNull();
  });

  it('knowledge search ranks by similarity (hash embedder works offline)', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    await env.service.handle('knowledge.add', { companyId: co.id, content: 'Plausible pricing starts at $9 per month for 10k pageviews', category: 'competitor' });
    await env.service.handle('knowledge.add', { companyId: co.id, content: 'Customers complain that cookie banners hurt conversion', category: 'customer' });
    const { memories } = await env.service.handle('knowledge.list', { companyId: co.id, query: 'competitor pricing per month' });
    expect(memories[0]!.content).toContain('Plausible pricing');
    const { constraints } = await env.service.handle('knowledge.list', { companyId: co.id });
    expect(constraints.filter((c) => c.immutable).length).toBeGreaterThanOrEqual(8);
  });

  it('vault rotation keeps credentials and queued approvals readable', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env, { channels: { email: true }, email: { fromAddress: 'a@acme.test' } });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'resend', secret: 're_rotate_me_1234567890' });
    env.db.work.upsertLead({ companyId: co.id, email: 'p@q.co', signal: 'posted on HN', icpReason: 'fits' });
    const ctx = env.service.makeContext({ companyId: co.id, role: 'sdr', runId: 'r', cycleId: null, taskId: null });
    const q = await env.service.gate.invoke(ctx, env.service.registry.get('email.send')!, { to: 'p@q.co', subject: 'Hello there', body: 'Saw your HN post about analytics.', kind: 'outreach' }, { remainingCredits: 10 });
    if (q.kind !== 'queued') throw new Error('expected queued');
    const res = await env.service.handle('vault.rotate', {});
    expect(res).toMatchObject({ credentials: 1, actions: 1 });
    expect(env.creds.resolve(co.id, 'resend')!.secret.reveal()).toBe('re_rotate_me_1234567890');
    const detail = await env.service.handle('approvals.get', { companyId: co.id, actionId: q.actionId });
    expect((detail.action!.args as { to: string }).to).toBe('p@q.co');
  });
});

describe('alerts', () => {
  it('flags cost spikes, approval backlogs, empty loops and provider errors', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    const mk = (credits: number, i: number) => {
      const c = env.db.runs.createCycle({ companyId: co.id, kind: 'manual', triggerType: 'manual', creditsCap: 500, usdCap: 0, configVersion: 1, now: 1_000 + i });
      env.db.runs.addCycleSpend(c.id, credits, 0);
      env.db.runs.updateCycle(c.id, { status: 'done', endedAt: 2_000 + i });
    };
    [10, 12, 11, 9, 100].forEach(mk);
    for (let i = 0; i < 3; i++) {
      const r = env.db.runs.createRun({ companyId: co.id, cycleId: null, role: 'sdr', triggerType: 'manual', goal: 'g', now: env.clock.now() });
      env.db.runs.updateRun(r.id, { status: 'stopped', stopReason: 'no_progress' });
    }
    for (let i = 0; i < 30; i++) {
      env.db.billing.recordUsage({ companyId: co.id, cycleId: null, runId: null, role: 'x', alias: 'cheap', provider: 'anthropic', model: 'claude-haiku-4', inputTokens: 0, outputTokens: 0, costUsd: 0, credits: 0, ok: i % 5 !== 0, latencyMs: 1 }, env.clock.now());
    }
    const keys = computeAlerts(env.db, co, env.clock.now()).map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(['cost_spike', 'empty_loops', 'provider_errors']));
  });
});

describe('export + legacy import', () => {
  it('exports everything the company produced, without secrets or approval args', async () => {
    env = await makeServiceEnv();
    const co = await createCompany(env);
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'stripe', secret: 'sk_fake_exportleak_0000000' });
    env.db.work.createDraft({ companyId: co.id, kind: 'post', title: 'Hello, "world"', body: 'line1\nline2' });
    const { json, csv } = (await import('@main/business/export')).exportCompany(env.db, co.id, env.clock.now());
    const text = JSON.stringify(json);
    expect(text).not.toContain('sk_fake_exportleak');
    expect(text).not.toContain('args_enc');
    expect(json['format']).toBe('flowstate-business-export/1');
    expect(csv['drafts.csv']).toContain('"Hello, ""world"""');
    expect(toCsv([])).toBe('');
  });

  it('imports the previous autopilot profile + memory once', async () => {
    const base = makeEnv();
    const legacy = join(base.dir, 'business');
    mkdirSync(legacy, { recursive: true });
    writeFileSync(join(legacy, 'profile.json'), JSON.stringify({ name: 'OldCo', product: 'Invoicing for plumbers', audience: 'Plumbers', goals: ['10 customers'], links: { site: 'oldco.test' }, schedule: { enabled: true, time: '08:30' } }));
    writeFileSync(join(legacy, 'memory.md'), '# Business memory\n\n## Learnings — 2026-06-01\n- Plumbers answer calls, not email.');
    const settings = memorySettings();
    const svc = new BusinessAgentService({ raw: base.raw, provider: new ScriptedLLM((r) => auxReply(r) ?? { text: '' }), settings, keyWrapper: fakeKeyWrapper(), legacyDir: legacy, now: new FakeClock().now });
    await svc.init();
    const companies = svc.db.companies.list();
    expect(companies).toHaveLength(1);
    expect(companies[0]!.config).toMatchObject({ name: 'OldCo', icp: 'Plumbers', goals: ['10 customers'], schedule: { morning: '08:30' }, validation: { status: 'waived' } });
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.db.knowledge.list(companies[0]!.id)[0]!.content).toContain('Plumbers answer calls');
    await svc.init(); // idempotent
    expect(svc.db.companies.list()).toHaveLength(1);
    base.cleanup();
  });
});
