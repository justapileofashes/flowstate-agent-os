import { describe, it, expect } from 'vitest';
import { decideGate, ALWAYS_APPROVE, type GateInput } from '@shared/business/policy';
import { ACTION_CATEGORIES, AUTONOMY_TIERS, AUTO_APPROVE_LEVELS } from '@shared/business/types';
import { creditsForLlmCall, evaluateCompanyBudget, fitPlanToBudget, remaining } from '@main/business/guardrails/budgets';
import type { PlanItem } from '@shared/business/types';

const base: GateInput = { category: 'read', risk: 'low', autonomy: 'safe', roleAutoApprove: 'none' };

describe('approval matrix (spec §10.1)', () => {
  it('read/draft/internal never gate, in every tier', () => {
    for (const autonomy of AUTONOMY_TIERS) {
      for (const category of ['read', 'draft', 'internal'] as const) {
        expect(decideGate({ ...base, autonomy, category }).gate).toBe('none');
      }
    }
  });

  it('deploy/pricing/refund/validation always need approval — every tier, every role level, every risk', () => {
    for (const category of ALWAYS_APPROVE) {
      for (const autonomy of AUTONOMY_TIERS) {
        for (const roleAutoApprove of AUTO_APPROVE_LEVELS) {
          for (const risk of ['low', 'medium', 'high'] as const) {
            expect(decideGate({ category, risk, autonomy, roleAutoApprove }).gate).toBe('approval');
          }
        }
      }
    }
  });

  it('safe tier gates every outward category', () => {
    const outward = ACTION_CATEGORIES.filter((c) => !['read', 'draft', 'internal'].includes(c));
    for (const category of outward) {
      const g = decideGate({
        category,
        risk: 'medium',
        autonomy: 'safe',
        roleAutoApprove: 'medium',
        cleanPublishes: 100,
        publishCleanThreshold: 1,
        adChangePct: 1,
        adChangeLimitPct: 10,
      }).gate;
      expect(g).toBe('approval');
    }
  });

  it('publishing auto-approves only after N clean publishes, with tier + role permission', () => {
    const p: GateInput = { ...base, category: 'publish', risk: 'medium', autonomy: 'assisted', roleAutoApprove: 'medium', publishCleanThreshold: 5, postsToday: 0, postsPerDay: 3 };
    expect(decideGate({ ...p, cleanPublishes: 4 }).gate).toBe('approval');
    expect(decideGate({ ...p, cleanPublishes: 5 }).gate).toBe('none');
    expect(decideGate({ ...p, cleanPublishes: 5, roleAutoApprove: 'low' }).gate).toBe('approval');
    expect(decideGate({ ...p, cleanPublishes: 5, postsToday: 3 }).gate).toBe('deny');
  });

  it('outbound email auto-sends only in the autonomous tier and within the daily cap', () => {
    const o: GateInput = { ...base, category: 'outbound', risk: 'medium', roleAutoApprove: 'medium', sendsToday: 0, emailsPerDay: 20 };
    expect(decideGate({ ...o, autonomy: 'safe' }).gate).toBe('approval');
    expect(decideGate({ ...o, autonomy: 'assisted' }).gate).toBe('approval');
    expect(decideGate({ ...o, autonomy: 'autonomous' }).gate).toBe('none');
    expect(decideGate({ ...o, autonomy: 'autonomous', sendsToday: 20 }).gate).toBe('deny');
  });

  it('ad budget changes: within ±N% may auto-apply; above → approval; over the cap → deny; unknown delta → approval', () => {
    const a: GateInput = { ...base, category: 'ad_budget', risk: 'medium', autonomy: 'assisted', roleAutoApprove: 'medium', adChangeLimitPct: 10, adDailyCapUsd: 50 };
    expect(decideGate({ ...a, adChangePct: 8, adNewDailyUsd: 27 }).gate).toBe('none');
    expect(decideGate({ ...a, adChangePct: -9.9, adNewDailyUsd: 18 }).gate).toBe('none');
    expect(decideGate({ ...a, adChangePct: 25, adNewDailyUsd: 30 }).gate).toBe('approval');
    expect(decideGate({ ...a, adChangePct: 5, adNewDailyUsd: 60 }).gate).toBe('deny');
    expect(decideGate({ ...a, adNewDailyUsd: 20 }).gate).toBe('approval');
  });

  it('config edits: approval in safe mode, 1h objection window otherwise', () => {
    expect(decideGate({ ...base, category: 'config_edit', risk: 'medium' }).gate).toBe('approval');
    expect(decideGate({ ...base, category: 'config_edit', risk: 'medium', autonomy: 'assisted' }).gate).toBe('objection_window');
  });

  it('any high-risk skill needs approval regardless of category', () => {
    expect(decideGate({ ...base, category: 'external_write', risk: 'high', autonomy: 'autonomous', roleAutoApprove: 'medium' }).gate).toBe('approval');
  });
});

describe('budget arithmetic', () => {
  it('credits: $0.01 each when billed, tokens/4000 when local', () => {
    expect(creditsForLlmCall(0.25, 999_999)).toBe(25);
    expect(creditsForLlmCall(0, 8_000)).toBe(2);
    expect(creditsForLlmCall(0, 0)).toBe(0);
  });

  it('remaining honours "0 = no USD cap"', () => {
    expect(remaining({ spentCredits: 30, capCredits: 100, spentUsd: 5, capUsd: 0 })).toEqual({ credits: 70, usd: Infinity });
    expect(remaining({ spentCredits: 130, capCredits: 100, spentUsd: 3, capUsd: 2 })).toEqual({ credits: 0, usd: 0 });
  });

  it('company budget: warn at the alert ratio, block at 100% or empty balance', () => {
    const b = { balance: 100, monthSpentCredits: 0, monthlyCredits: 1000, monthSpentUsd: 0, monthlyUsd: 10, alertRatio: 0.8 };
    expect(evaluateCompanyBudget(b).level).toBe('ok');
    expect(evaluateCompanyBudget({ ...b, monthSpentCredits: 800 }).level).toBe('warn');
    expect(evaluateCompanyBudget({ ...b, monthSpentUsd: 8.5 }).level).toBe('warn');
    expect(evaluateCompanyBudget({ ...b, monthSpentCredits: 1000 }).level).toBe('block');
    expect(evaluateCompanyBudget({ ...b, balance: 0 }).level).toBe('block');
  });

  it('fitPlanToBudget keeps priority order and drops the overflow with a reason', () => {
    const item = (title: string, c: number): PlanItem => ({ title, role: 'researcher', description: '', estimated_cost_credits: c, risk_level: 'low', requires_approval: false });
    const { kept, dropped } = fitPlanToBudget([item('a', 40), item('b', 50), item('c', 30), item('d', 5)], 100);
    expect(kept.map((k) => k.title)).toEqual(['a', 'b', 'd']);
    expect(dropped[0]).toMatchObject({ title: 'c' });
    expect(dropped[0]!.reason).toContain('over budget');
  });
});
