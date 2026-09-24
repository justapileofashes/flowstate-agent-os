// Operational alerts (spec §15): cost-per-cycle spike (>3× moving average),
// approval-queue backlog, repeated empty-result loops, provider error rate
// > 5%, and the monthly budget. Pure computation over the repos.

import type { AlertDto, CompanyDto } from '@shared/business/types';
import type { BizDb } from '../db';
import { evaluateCompanyBudget } from '../guardrails/budgets';
import { startOfMonth } from '../db/util';
import { LIMITS } from '../config';

export function computeAlerts(db: BizDb, company: CompanyDto, now = Date.now()): AlertDto[] {
  const alerts: AlertDto[] = [];

  // Cost spike: latest finished cycle vs. the average of the 7 before it.
  const finished = db.runs
    .listCycles(company.id, 20)
    .filter((c) => c.status !== 'running' && c.status !== 'budget_stopped' && c.status !== 'skipped' && c.kind !== 'evening');
  const [latest, ...prior] = finished;
  const window = prior.slice(0, 7);
  if (latest && window.length >= 3) {
    const avg = window.reduce((s, c) => s + c.creditsSpent, 0) / window.length;
    if (avg > 0 && latest.creditsSpent > 3 * avg) {
      alerts.push({
        key: 'cost_spike',
        severity: 'warn',
        message: `Last cycle spent ${latest.creditsSpent.toFixed(1)} credits — over 3× the recent average (${avg.toFixed(1)}).`,
      });
    }
  }

  // Approval backlog.
  const pending = db.approvals.countPending(company.id);
  const oldest = db.approvals.oldestPendingAt(company.id);
  if (pending >= LIMITS.approvalBacklogWarn) {
    alerts.push({ key: 'approval_backlog', severity: 'warn', message: `${pending} actions are waiting for your approval.` });
  } else if (oldest && now - oldest > LIMITS.approvalStaleMs) {
    alerts.push({
      key: 'approval_backlog',
      severity: 'warn',
      message: `An approval has been waiting ${Math.round((now - oldest) / 3_600_000)}h.`,
    });
  }

  // Repeated empty-result loops in the last 24h.
  const stuck = db.runs
    .listRuns({ companyId: company.id, since: now - 86_400_000, limit: 200 })
    .filter((r) => r.stopReason === 'no_progress').length;
  if (stuck >= 3) {
    alerts.push({
      key: 'empty_loops',
      severity: 'warn',
      message: `${stuck} runs stopped for lack of progress in the last 24h — check connections and task wording.`,
    });
  }

  // Provider error rate over the last 100 calls.
  const calls = db.billing.recentProviderCalls(company.id, 100);
  if (calls.length >= 20) {
    const errors = calls.filter((c) => !c.ok).length;
    const rate = errors / calls.length;
    if (rate > 0.05) {
      const byProvider = new Map<string, number>();
      for (const c of calls) if (!c.ok) byProvider.set(c.provider, (byProvider.get(c.provider) ?? 0) + 1);
      const worst = [...byProvider.entries()].sort((a, b) => b[1] - a[1])[0];
      alerts.push({
        key: 'provider_errors',
        severity: rate > 0.25 ? 'critical' : 'warn',
        message: `${Math.round(rate * 100)}% of recent model calls failed${worst ? ` (mostly ${worst[0]})` : ''}.`,
      });
    }
  }

  // Monthly budget.
  const verdict = evaluateCompanyBudget({
    balance: db.billing.balance(company.id),
    monthSpentCredits: db.billing.monthSpent(company.id, now),
    monthlyCredits: company.config.budgets.monthlyCredits,
    monthSpentUsd: db.billing.usdSince(company.id, startOfMonth(now)),
    monthlyUsd: company.config.budgets.monthlyUsd,
    alertRatio: company.config.budgets.alertRatio,
  });
  if (verdict.level === 'block') alerts.push({ key: 'budget_block', severity: 'critical', message: verdict.message });
  else if (verdict.level === 'warn') alerts.push({ key: 'budget_warn', severity: 'warn', message: verdict.message });

  return alerts;
}
