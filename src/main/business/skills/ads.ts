// Meta (Facebook/Instagram) ads via the Marketing API with a system-user
// token. ads.read is read-only. ads.update_budget is ad_budget-gated: the
// gate is fed the *real* current budget (read here, server-side) so the
// ±N% auto-approve band and the hard daily cap can't be gamed by the model.

import { z } from 'zod';
import { readJson, skillToolName, type Skill, type SkillContext } from './types';

const GRAPH = 'https://graph.facebook.com/v21.0';

function metaCred(ctx: SkillContext): { token: string; account: string } {
  const cred = ctx.credentials.resolve('meta_ads');
  if (!cred) throw new Error('Meta Ads is not connected');
  const account = cred.meta['ad_account_id'] ?? '';
  return { token: cred.secret.reveal(), account: account.startsWith('act_') ? account : `act_${account}` };
}

interface AdSet {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  insights?: { data?: Array<{ spend?: string; impressions?: string; clicks?: string; ctr?: string; cpc?: string }> };
}

export async function currentDailyBudgetUsd(ctx: SkillContext, adsetId: string): Promise<number | null> {
  const { token } = metaCred(ctx);
  const res = await ctx.fetch(`${GRAPH}/${encodeURIComponent(adsetId)}?fields=daily_budget,name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await readJson(res, 'Meta')) as { daily_budget?: string };
  return body.daily_budget ? Number(body.daily_budget) / 100 : null;
}

const readArgs = z.object({ limit: z.number().int().min(1).max(50).optional() });

export const adsRead: Skill<z.infer<typeof readArgs>> = {
  key: 'ads.read',
  toolName: skillToolName('ads.read'),
  name: 'Read ad performance',
  description: 'List ad sets with status, daily budget and last-7-day spend, clicks, CTR and CPC.',
  parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
  schema: readArgs,
  category: 'read',
  risk: 'low',
  costCredits: 1,
  channel: 'ads',
  providers: ['meta_ads'],
  rubric: ['Numbers reported as read'],
  failureConditions: ['Token expired', 'Empty account (report it, do not retry)'],
  preview: () => ({ title: 'Read ad sets', summary: '' }),
  async execute(ctx, a) {
    const { token, account } = metaCred(ctx);
    const fields = 'id,name,status,daily_budget,insights.date_preset(last_7d){spend,impressions,clicks,ctr,cpc}';
    const res = await ctx.fetch(`${GRAPH}/${account}/adsets?fields=${encodeURIComponent(fields)}&limit=${a.limit ?? 25}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await readJson(res, 'Meta')) as { data?: AdSet[] };
    const sets = (body.data ?? []).map((s) => {
      const i = s.insights?.data?.[0] ?? {};
      return {
        id: s.id,
        name: s.name,
        status: s.status,
        dailyBudgetUsd: s.daily_budget ? Number(s.daily_budget) / 100 : null,
        spend7d: Number(i.spend ?? 0),
        clicks7d: Number(i.clicks ?? 0),
        ctr: Number(i.ctr ?? 0),
        cpc: Number(i.cpc ?? 0),
      };
    });
    if (!sets.length) return { ok: true, content: 'No ad sets in this account.', empty: true };
    return { ok: true, content: JSON.stringify(sets, null, 1), data: sets };
  },
};

const budgetArgs = z.object({
  adset_id: z.string().regex(/^\d{5,25}$/, 'numeric ad set id'),
  new_daily_budget_usd: z.number().positive().max(100_000),
  reason: z.string().min(10).max(1_000),
});

export const adsUpdateBudget: Skill<z.infer<typeof budgetArgs>> = {
  key: 'ads.update_budget',
  toolName: skillToolName('ads.update_budget'),
  name: 'Change an ad set budget',
  description:
    'Set a new daily budget for one ad set, with the data-backed reason. Small changes within the configured band may auto-apply; larger ones wait for the owner; nothing above the hard daily cap is allowed.',
  parameters: {
    type: 'object',
    properties: {
      adset_id: { type: 'string' },
      new_daily_budget_usd: { type: 'number' },
      reason: { type: 'string' },
    },
    required: ['adset_id', 'new_daily_budget_usd', 'reason'],
  },
  schema: budgetArgs,
  category: 'ad_budget',
  risk: 'medium',
  costCredits: 1,
  channel: 'ads',
  providers: ['meta_ads'],
  rubric: ['Change justified by performance data', 'Within the daily cap', 'One change per ad set per cycle'],
  failureConditions: ['Ad set not found', 'Would exceed the hard cap'],
  async gateMetrics(ctx, a) {
    try {
      const current = await currentDailyBudgetUsd(ctx, a.adset_id);
      return {
        adNewDailyUsd: a.new_daily_budget_usd,
        ...(current && current > 0 ? { adChangePct: ((a.new_daily_budget_usd - current) / current) * 100 } : {}),
      };
    } catch {
      return { adNewDailyUsd: a.new_daily_budget_usd }; // unknown delta → approval
    }
  },
  preview: (a) => ({
    title: `Ad set ${a.adset_id}: daily budget → $${a.new_daily_budget_usd.toFixed(2)}`,
    summary: a.reason,
  }),
  async execute(ctx, a) {
    const { token } = metaCred(ctx);
    const form = new URLSearchParams({ daily_budget: String(Math.round(a.new_daily_budget_usd * 100)) });
    const res = await ctx.fetch(`${GRAPH}/${encodeURIComponent(a.adset_id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    await readJson(res, 'Meta');
    return { ok: true, content: `Ad set ${a.adset_id} daily budget set to $${a.new_daily_budget_usd.toFixed(2)}.`, stateChange: true };
  },
};

export const ADS_SKILLS: Skill[] = [adsRead, adsUpdateBudget];
