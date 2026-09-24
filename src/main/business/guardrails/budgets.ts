// Budget arithmetic (spec §10.2). Pure: credits math for model calls, run /
// cycle cap checks, the company-level monthly gate (80% warn, 100% pause),
// and shrinking a plan to fit what remains.

import { CREDITS_PER_USD, LOCAL_TOKENS_PER_CREDIT } from '../config';
import type { PlanItem } from '@shared/business/types';

/** Credits for one model call: real money when billed, tokens when local. */
export function creditsForLlmCall(costUsd: number, totalTokens: number): number {
  if (costUsd > 0) return round4(costUsd * CREDITS_PER_USD);
  return round4(Math.max(0, totalTokens) / LOCAL_TOKENS_PER_CREDIT);
}

export function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

export interface CapState {
  spentCredits: number;
  capCredits: number;
  spentUsd: number;
  capUsd: number;
}

/** Remaining room under both caps; a cap of 0 means "no USD cap". */
export function remaining(s: CapState): { credits: number; usd: number } {
  return {
    credits: Math.max(0, s.capCredits - s.spentCredits),
    usd: s.capUsd > 0 ? Math.max(0, s.capUsd - s.spentUsd) : Infinity,
  };
}

export function isExhausted(s: CapState): boolean {
  const r = remaining(s);
  return r.credits <= 0 || r.usd <= 0;
}

export type CompanyBudgetLevel = 'ok' | 'warn' | 'block';

export interface CompanyBudgetVerdict {
  level: CompanyBudgetLevel;
  message: string;
  ratio: number;
}

/** Month-level gate: pause at 100% of either cap or an empty balance. */
export function evaluateCompanyBudget(input: {
  balance: number;
  monthSpentCredits: number;
  monthlyCredits: number;
  monthSpentUsd: number;
  monthlyUsd: number;
  alertRatio: number;
}): CompanyBudgetVerdict {
  const creditRatio = input.monthlyCredits > 0 ? input.monthSpentCredits / input.monthlyCredits : 0;
  const usdRatio = input.monthlyUsd > 0 ? input.monthSpentUsd / input.monthlyUsd : 0;
  const ratio = Math.max(creditRatio, usdRatio);
  if (input.balance <= 0) {
    return { level: 'block', ratio, message: 'Credit balance is empty — add credits to resume cycles.' };
  }
  if (ratio >= 1) {
    const which = creditRatio >= usdRatio ? `${fmt(input.monthSpentCredits)} of ${fmt(input.monthlyCredits)} credits` : `$${input.monthSpentUsd.toFixed(2)} of $${input.monthlyUsd.toFixed(2)}`;
    return { level: 'block', ratio, message: `Monthly budget reached (${which}) — cycles paused until next month or a raise.` };
  }
  if (ratio >= input.alertRatio) {
    return { level: 'warn', ratio, message: `${Math.round(ratio * 100)}% of this month's budget used.` };
  }
  return { level: 'ok', ratio, message: '' };
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Keep plan items in order while their running estimate fits the budget;
 * everything after the first overflow is dropped with a reason. Items are
 * never reordered (the CEO's priority order is respected).
 */
export function fitPlanToBudget(
  items: PlanItem[],
  budgetCredits: number,
): { kept: PlanItem[]; dropped: Array<{ title: string; reason: string }> } {
  const kept: PlanItem[] = [];
  const dropped: Array<{ title: string; reason: string }> = [];
  let total = 0;
  for (const item of items) {
    const est = Math.max(0, item.estimated_cost_credits);
    if (total + est <= budgetCredits) {
      kept.push(item);
      total += est;
    } else {
      dropped.push({ title: item.title, reason: `over budget (${round4(total + est)} > ${budgetCredits} credits)` });
    }
  }
  return { kept, dropped };
}

export function planCost(items: PlanItem[]): number {
  return round4(items.reduce((s, i) => s + Math.max(0, i.estimated_cost_credits), 0));
}
