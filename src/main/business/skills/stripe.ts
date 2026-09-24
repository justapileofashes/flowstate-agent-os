// Stripe on the *company's* account (BYOK; a restricted read key is
// enough for reconcile). stripe.reconcile is read-only: balance + recent
// charges → KPI snapshots, with deterministic anomaly checks against the
// previous snapshot. stripe.refund moves money → always owner-approved,
// and carries Stripe's Idempotency-Key so a retry can't refund twice.

import { z } from 'zod';
import { readJson, skillToolName, type Skill, type SkillContext } from './types';

const API = 'https://api.stripe.com/v1';

interface StripeCharge {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  paid: boolean;
  status: string;
  refunded: boolean;
  created: number;
}

async function stripeGet(ctx: SkillContext, key: string, path: string): Promise<unknown> {
  const res = await ctx.fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  return readJson(res, 'Stripe');
}

export interface ReconcileSummary {
  days: number;
  currency: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  charges: number;
  failed: number;
  balanceAvailable: number;
  balancePending: number;
  anomalies: string[];
}

export function summarizeCharges(
  charges: StripeCharge[],
  balance: { available?: Array<{ amount: number; currency: string }>; pending?: Array<{ amount: number; currency: string }> },
  days: number,
): Omit<ReconcileSummary, 'anomalies'> {
  const byCurrency = new Map<string, number>();
  for (const c of charges) byCurrency.set(c.currency, (byCurrency.get(c.currency) ?? 0) + 1);
  const currency = [...byCurrency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'usd';
  const mine = charges.filter((c) => c.currency === currency);
  const ok = mine.filter((c) => c.paid && c.status === 'succeeded');
  const gross = ok.reduce((s, c) => s + c.amount, 0) / 100;
  const refunds = ok.reduce((s, c) => s + c.amount_refunded, 0) / 100;
  const sum = (xs?: Array<{ amount: number; currency: string }>): number =>
    (xs ?? []).filter((x) => x.currency === currency).reduce((s, x) => s + x.amount, 0) / 100;
  return {
    days,
    currency: currency.toUpperCase(),
    grossRevenue: round2(gross),
    refunds: round2(refunds),
    netRevenue: round2(gross - refunds),
    charges: ok.length,
    failed: mine.filter((c) => c.status === 'failed').length,
    balanceAvailable: round2(sum(balance.available)),
    balancePending: round2(sum(balance.pending)),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function detectAnomalies(s: Omit<ReconcileSummary, 'anomalies'>, previousNet: number | null): string[] {
  const out: string[] = [];
  if (previousNet !== null && previousNet > 0 && s.netRevenue < previousNet * 0.7) {
    out.push(`Net revenue fell ${Math.round((1 - s.netRevenue / previousNet) * 100)}% vs the last reconcile (${previousNet} → ${s.netRevenue} ${s.currency}).`);
  }
  if (s.grossRevenue > 0 && s.refunds / s.grossRevenue > 0.1) {
    out.push(`Refunds are ${Math.round((s.refunds / s.grossRevenue) * 100)}% of gross revenue.`);
  }
  if (s.charges + s.failed > 0 && s.failed / (s.charges + s.failed) > 0.15) {
    out.push(`${s.failed} failed charges (${Math.round((s.failed / (s.charges + s.failed)) * 100)}%) — dunning may be needed.`);
  }
  return out;
}

const reconcileArgs = z.object({ days: z.number().int().min(1).max(90).optional() });

export const stripeReconcile: Skill<z.infer<typeof reconcileArgs>> = {
  key: 'stripe.reconcile',
  toolName: skillToolName('stripe.reconcile'),
  name: 'Reconcile Stripe revenue',
  description:
    'Read-only: pull the Stripe balance and recent charges, record revenue KPIs, and flag anomalies (revenue drop, refund spike, failed payments).',
  parameters: { type: 'object', properties: { days: { type: 'integer', minimum: 1, maximum: 90 } } },
  schema: reconcileArgs,
  category: 'read',
  risk: 'low',
  costCredits: 1,
  providers: ['stripe'],
  rubric: ['Numbers reported exactly as read', 'Anomalies explained, not guessed'],
  failureConditions: ['Stripe key invalid or lacks read permission'],
  preview: (a) => ({ title: `Reconcile last ${a.days ?? 30} days`, summary: '' }),
  async execute(ctx, a) {
    const cred = ctx.credentials.resolve('stripe');
    if (!cred) return { ok: false, content: 'ERROR: Stripe is not connected' };
    const key = cred.secret.reveal();
    const days = a.days ?? 30;
    const since = Math.floor((ctx.now() - days * 86_400_000) / 1000);
    const balance = (await stripeGet(ctx, key, '/balance')) as {
      available?: Array<{ amount: number; currency: string }>;
      pending?: Array<{ amount: number; currency: string }>;
    };
    const charges: StripeCharge[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const qs = `limit=100&created[gte]=${since}${after ? `&starting_after=${after}` : ''}`;
      const body = (await stripeGet(ctx, key, `/charges?${qs}`)) as { data?: StripeCharge[]; has_more?: boolean };
      const batch = body.data ?? [];
      charges.push(...batch);
      if (!body.has_more || !batch.length) break;
      after = batch[batch.length - 1]!.id;
    }
    const base = summarizeCharges(charges, balance, days);
    const prev = ctx.db.work.kpiHistory(ctx.companyId, `net_revenue_${days}d`, 1)[0]?.value ?? null;
    const anomalies = detectAnomalies(base, prev);
    const now = ctx.now();
    const cur = base.currency;
    ctx.db.work.recordKpi(ctx.companyId, { key: `net_revenue_${days}d`, value: base.netRevenue, unit: cur, source: 'stripe' }, now);
    ctx.db.work.recordKpi(ctx.companyId, { key: `gross_revenue_${days}d`, value: base.grossRevenue, unit: cur, source: 'stripe' }, now);
    ctx.db.work.recordKpi(ctx.companyId, { key: `refunds_${days}d`, value: base.refunds, unit: cur, source: 'stripe' }, now);
    ctx.db.work.recordKpi(ctx.companyId, { key: `charges_${days}d`, value: base.charges, unit: 'count', source: 'stripe' }, now);
    ctx.db.work.recordKpi(ctx.companyId, { key: 'balance_available', value: base.balanceAvailable, unit: cur, source: 'stripe' }, now);
    for (const note of anomalies) {
      await ctx.knowledge.add(ctx.companyId, { content: `Finance anomaly: ${note}`, category: 'finance', source: 'stripe.reconcile', sourceRunId: ctx.runId, confidence: 0.9 });
      ctx.feed?.(`Finance anomaly: ${note}`);
    }
    const summary: ReconcileSummary = { ...base, anomalies };
    return {
      ok: true,
      content: JSON.stringify(summary, null, 1),
      data: summary,
      stateChange: true,
      empty: charges.length === 0 && base.balanceAvailable === 0,
    };
  },
};

const refundArgs = z
  .object({
    charge_id: z.string().regex(/^ch_[A-Za-z0-9]+$/).optional(),
    payment_intent_id: z.string().regex(/^pi_[A-Za-z0-9]+$/).optional(),
    amount: z.number().positive().max(100_000).optional(),
    reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent']),
    note: z.string().min(5).max(500),
  })
  .refine((a) => Boolean(a.charge_id) !== Boolean(a.payment_intent_id), {
    message: 'give exactly one of charge_id or payment_intent_id',
  });

export const stripeRefund: Skill<z.infer<typeof refundArgs>> = {
  key: 'stripe.refund',
  toolName: skillToolName('stripe.refund'),
  name: 'Refund a payment',
  description:
    "Refund a Stripe charge or payment intent (full, or `amount` in the account currency). Always waits for the owner's approval.",
  parameters: {
    type: 'object',
    properties: {
      charge_id: { type: 'string' },
      payment_intent_id: { type: 'string' },
      amount: { type: 'number', description: 'Partial amount in major units (e.g. 9.99). Omit for a full refund.' },
      reason: { type: 'string', enum: ['requested_by_customer', 'duplicate', 'fraudulent'] },
      note: { type: 'string', description: 'Why (for the owner and the audit log).' },
    },
    required: ['reason', 'note'],
  },
  schema: refundArgs,
  category: 'refund',
  risk: 'high',
  costCredits: 1,
  providers: ['stripe'],
  rubric: ['Refund matches a real customer request or error', 'Amount matches the charge'],
  failureConditions: ['Charge not found', 'Already refunded'],
  preview: (a) => ({
    title: `Refund ${a.amount ? a.amount.toFixed(2) : 'in full'} — ${a.charge_id ?? a.payment_intent_id}`,
    summary: `${a.reason}: ${a.note}`,
  }),
  async execute(ctx, a, exec) {
    const cred = ctx.credentials.resolve('stripe');
    if (!cred) return { ok: false, content: 'ERROR: Stripe is not connected' };
    const form = new URLSearchParams();
    if (a.charge_id) form.set('charge', a.charge_id);
    if (a.payment_intent_id) form.set('payment_intent', a.payment_intent_id);
    if (a.amount) form.set('amount', String(Math.round(a.amount * 100)));
    form.set('reason', a.reason);
    form.set('metadata[flowstate_note]', a.note.slice(0, 450));
    const res = await ctx.fetch(`${API}/refunds`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cred.secret.reveal()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': exec.idempotencyKey,
      },
      body: form.toString(),
    });
    const body = (await readJson(res, 'Stripe refund')) as { id?: string; status?: string; amount?: number };
    return {
      ok: true,
      content: `Refund ${body.id} ${body.status} (${((body.amount ?? 0) / 100).toFixed(2)}).`,
      stateChange: true,
    };
  },
};

export const STRIPE_SKILLS: Skill[] = [stripeReconcile, stripeRefund];
