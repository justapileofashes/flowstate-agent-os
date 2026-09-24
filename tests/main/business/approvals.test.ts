import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCompany, json, makeServiceEnv, type ServiceEnv } from './helpers';
import type { CompanyDto } from '@shared/business/types';

let env: ServiceEnv;
let co: CompanyDto;

async function setupEmail(over: Parameters<typeof createCompany>[1] = {}): Promise<void> {
  co = await createCompany(env, {
    channels: { email: true },
    email: { fromAddress: 'founder@acme.test', fromName: 'Ana' },
    ...over,
  });
  await env.service.handle('credentials.save', { companyId: co.id, provider: 'resend', secret: 're_live_abcdefghijklmnop' });
  env.db.work.upsertLead({ companyId: co.id, email: 'pat@prospect.test', name: 'Pat', signal: 'Posted about GA4 pain on HN', icpReason: 'Indie SaaS, 10k visitors' });
  env.http.on('https://api.resend.com/emails', () => json({ id: 'email_123' }));
}

function sdrCtx(runId: string | null = null) {
  return env.service.makeContext({ companyId: co.id, role: 'sdr', runId, cycleId: null, taskId: null });
}

const emailArgs = {
  to: 'pat@prospect.test',
  subject: 'Your GA4 thread',
  body: 'Hi Pat — saw your HN post about GA4 sampling. We built a cookie-free alternative; happy to share a free account.',
  kind: 'outreach',
};

beforeEach(async () => {
  env = await makeServiceEnv();
});
afterEach(() => env.cleanup());

describe('approval gate — outbound email (Phase 5 acceptance)', () => {
  it('sending real email without approval lands in pending_actions and does not send', async () => {
    await setupEmail();
    const skill = env.service.registry.get('email.send')!;
    const out = await env.service.gate.invoke(sdrCtx('run-1'), skill, emailArgs, { remainingCredits: 100 });
    expect(out.kind).toBe('queued');
    expect(env.http.to('https://api.resend.com')).toHaveLength(0);
    const pending = env.db.approvals.list({ companyId: co.id, statuses: ['pending'] });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.reason).toContain('outbound messages need approval');
    // args are sealed (encrypted) at rest; the list preview is redacted
    const raw = env.raw.prepare('SELECT args_enc, summary FROM biz_pending_actions').get() as { args_enc: string; summary: string };
    expect(raw.args_enc).not.toContain('pat@prospect.test');
    expect(raw.args_enc.startsWith('v1.')).toBe(true);
  });

  it('approve → sends exactly once, even on a repeated or concurrent approval', async () => {
    await setupEmail();
    const skill = env.service.registry.get('email.send')!;
    const out = await env.service.gate.invoke(sdrCtx('run-1'), skill, emailArgs, { remainingCredits: 100 });
    if (out.kind !== 'queued') throw new Error('expected queued');

    const [a, b] = await Promise.all([
      env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId }),
      env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId }),
    ]);
    const again = await env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId });
    const sends = env.http.to('https://api.resend.com/emails');
    expect(sends).toHaveLength(1);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(again).toMatchObject({ ok: true, status: 'executed' });
    // provider-level idempotency + opt-out footer
    expect(sends[0]!.headers['idempotency-key']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(sends[0]!.body).text).toContain('unsubscribe');
    expect(env.db.approvals.get(out.actionId)!.status).toBe('executed');
    expect(env.db.work.lastContacted(co.id, 'pat@prospect.test')).not.toBeNull();
  });

  it('a failed send can be re-approved; the provider still gets the same idempotency key', async () => {
    await setupEmail();
    let first = true;
    env.http.on('https://api.resend.com/', () => json({ error: 'nope' }, 500));
    // override: first call 500, then success
    const calls: string[] = [];
    const orig = env.http.fn;
    env.http.fn = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/emails')) {
        calls.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        if (first) {
          first = false;
          return json({ message: 'temporary' }, 500);
        }
        return json({ id: 'email_ok' });
      }
      return orig(url, init);
    };
    // rebuild context fetch: skills read ctx.fetch, which the service created from env.http.fn at construction
    const svc = env.service as unknown as { fetchFn: typeof env.http.fn };
    svc.fetchFn = env.http.fn;

    const skill = env.service.registry.get('email.send')!;
    const out = await env.service.gate.invoke(sdrCtx('run-1'), skill, emailArgs, { remainingCredits: 100 });
    if (out.kind !== 'queued') throw new Error('expected queued');
    const r1 = await env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId });
    expect(r1.ok).toBe(false);
    expect(env.db.approvals.get(out.actionId)!.status).toBe('failed');
    const r2 = await env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId });
    expect(r2.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toBe(calls[1]);
    // failed attempt was refunded: net skill spend = one successful send
    const ledger = env.db.billing.ledger(co.id).filter((l) => l.reason === 'skill_spend' || l.reason === 'refund');
    expect(ledger.reduce((s, l) => s + l.delta, 0)).toBe(-2);
  });

  it('reject records the reason, never sends, and proposes an "avoid" lesson', async () => {
    await setupEmail();
    const skill = env.service.registry.get('email.send')!;
    const out = await env.service.gate.invoke(sdrCtx('run-1'), skill, emailArgs, { remainingCredits: 100 });
    if (out.kind !== 'queued') throw new Error('expected queued');
    const res = await env.service.handle('approvals.reject', { companyId: co.id, actionId: out.actionId, reason: 'Too salesy; never offer free accounts cold' });
    expect(res.ok).toBe(true);
    const row = env.db.approvals.get(out.actionId)!;
    expect(row.status).toBe('rejected');
    expect(row.decisionNote).toBe('Too salesy; never offer free accounts cold');
    const late = await env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId });
    expect(late.ok).toBe(false);
    expect(env.http.to('https://api.resend.com')).toHaveLength(0);
    const rules = env.db.knowledge.rules(co.id, 'proposed');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ polarity: 'avoid', proposedBy: 'rejection', sourceActionId: out.actionId });
    expect(rules[0]!.action).toContain('never offer free accounts cold');
  });

  it('enforces the 7-day rule, unsubscribes, and the daily cap server-side', async () => {
    await setupEmail({ limits: { emailsPerDay: 1 }, autonomy: 'autonomous' });
    const agent = env.db.companies.agentConfig(co.id, 'sdr')!;
    env.db.companies.updateAgentConfig(co.id, agent.id, { autoApproveUpTo: 'medium' });
    const skill = env.service.registry.get('email.send')!;
    // autonomous + medium → sends immediately
    const first = await env.service.gate.invoke(sdrCtx('r1'), skill, emailArgs, { remainingCredits: 100 });
    expect(first.kind).toBe('executed');
    // same person again within 7 days → precondition failure
    const again = await env.service.gate.invoke(sdrCtx('r2'), skill, { ...emailArgs, subject: 'follow-up' }, { remainingCredits: 100 });
    expect(again.kind).toBe('precondition_failed');
    // another lead, but the daily cap (1) is used up → deny
    env.db.work.upsertLead({ companyId: co.id, email: 'sam@prospect.test', signal: 'Asked about analytics', icpReason: 'fits' });
    const capped = await env.service.gate.invoke(sdrCtx('r3'), skill, { ...emailArgs, to: 'sam@prospect.test' }, { remainingCredits: 100 });
    expect(capped.kind).toBe('denied');
    // unsubscribed
    const lead = env.db.work.getLeadByEmail(co.id, 'sam@prospect.test')!;
    env.db.work.setLeadStatus(co.id, lead.id, 'unsubscribed');
    const unsub = await env.service.gate.invoke(sdrCtx('r4'), skill, { ...emailArgs, to: 'sam@prospect.test' }, { remainingCredits: 100 });
    expect(unsub.kind).toBe('precondition_failed');
    expect(env.http.to('https://api.resend.com/emails')).toHaveLength(1);
  });

  it('outbound skills are invisible when the channel is off (opt-in scopes)', async () => {
    co = await createCompany(env);
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'resend', secret: 're_live_abcdefghijklmnop' });
    const keys = env.service.registry.forRole('sdr', sdrCtx()).map((s) => s.key);
    expect(keys).not.toContain('email.send');
    const out = await env.service.gate.invoke(sdrCtx(), env.service.registry.get('email.send')!, emailArgs, { remainingCredits: 100 });
    expect(out.kind).toBe('denied');
  });

  it('roles cannot call skills outside their allowlist', async () => {
    co = await createCompany(env, { channels: { email: true } });
    const ctx = env.service.makeContext({ companyId: co.id, role: 'researcher', runId: 'r', cycleId: null, taskId: null });
    const out = await env.service.gate.invoke(ctx, env.service.registry.get('stripe.refund')!, { charge_id: 'ch_1', reason: 'duplicate', note: 'dup charge' }, { remainingCredits: 100 });
    expect(out.kind).toBe('denied');
  });
});

describe('approval gate — other categories', () => {
  it('config edits wait 1h (objection window) in assisted mode, then apply', async () => {
    co = await createCompany(env, { autonomy: 'assisted' });
    const ctx = env.service.makeContext({ companyId: co.id, role: 'ceo', runId: 'r', cycleId: null, taskId: null });
    const out = await env.service.gate.invoke(ctx, env.service.registry.get('config.propose_change')!, { field: 'brandVoice', value: 'warm and precise', rationale: 'Top posts used this tone' }, { remainingCredits: 100 });
    expect(out.kind).toBe('queued');
    await env.service.gate.sweepObjectionWindows();
    expect(env.db.companies.get(co.id)!.config.brandVoice).toBe('plain, friendly, no hype');
    env.clock.advance(61 * 60_000);
    expect(await env.service.gate.sweepObjectionWindows()).toBe(1);
    const updated = env.db.companies.get(co.id)!;
    expect(updated.config.brandVoice).toBe('warm and precise');
    expect(env.db.companies.history(co.id)[0]!.editedBy).toBe('agent');
  });

  it('agents cannot edit their own guardrails through config proposals', async () => {
    co = await createCompany(env);
    const ctx = env.service.makeContext({ companyId: co.id, role: 'ceo', runId: 'r', cycleId: null, taskId: null });
    const out = await env.service.gate.invoke(ctx, env.service.registry.get('config.propose_change')!, { field: 'autonomy', value: 'autonomous', rationale: 'go faster please' }, { remainingCredits: 100 });
    expect(out.kind).toBe('invalid');
  });

  it('refunds stay gated even in the autonomous tier with medium auto-approve', async () => {
    co = await createCompany(env, { autonomy: 'autonomous' });
    await env.service.handle('credentials.save', { companyId: co.id, provider: 'stripe', secret: 'sk_fake_abcdefghijklmnop' });
    const agent = env.db.companies.agentConfig(co.id, 'finance')!;
    env.db.companies.updateAgentConfig(co.id, agent.id, { autoApproveUpTo: 'medium' });
    const ctx = env.service.makeContext({ companyId: co.id, role: 'support', runId: 'r', cycleId: null, taskId: null });
    const out = await env.service.gate.invoke(ctx, env.service.registry.get('stripe.refund')!, { charge_id: 'ch_123', reason: 'duplicate', note: 'charged twice' }, { remainingCredits: 100 });
    expect(out.kind).toBe('queued');
    env.http.on('https://api.stripe.com/v1/refunds', () => json({ id: 're_1', status: 'succeeded', amount: 1900 }));
    if (out.kind !== 'queued') return;
    const res = await env.service.handle('approvals.approve', { companyId: co.id, actionId: out.actionId });
    expect(res.ok).toBe(true);
    const call = env.http.to('https://api.stripe.com/v1/refunds')[0]!;
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f]{64}$/);
    expect(call.body).toContain('charge=ch_123');
  });

  it('identical calls in the same run replay the recorded result instead of re-executing', async () => {
    co = await createCompany(env);
    const ctx = env.service.makeContext({ companyId: co.id, role: 'researcher', runId: 'run-x', cycleId: null, taskId: null });
    const skill = env.service.registry.get('knowledge.save')!;
    const args = { content: 'Fathom Analytics starts at $15/mo', category: 'competitor', source: 'https://usefathom.com/pricing' };
    const a = await env.service.gate.invoke(ctx, skill, args, { remainingCredits: 100 });
    const b = await env.service.gate.invoke(ctx, skill, args, { remainingCredits: 100 });
    expect(a.kind === 'executed' && !a.replayed).toBe(true);
    expect(b.kind === 'executed' && b.replayed).toBe(true);
    expect(env.db.knowledge.list(co.id)).toHaveLength(1);
  });
});
