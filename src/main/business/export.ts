// "User owns the artifacts": export everything a company produced as JSON
// (config history, tasks, drafts, leads, tickets, knowledge, rules, cycles,
// runs + redacted steps, ledger, usage) plus CSVs for the tabular parts.
// Secrets and approval arguments are never exported.

import type { BizDb } from './db';
import { toPendingDto } from './db/approvals';
import { constitutionRows } from './guardrails/constitution';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]!);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

export function exportCompany(db: BizDb, companyId: string, now = Date.now()): {
  json: Record<string, unknown>;
  csv: Record<string, string>;
} {
  const company = db.companies.get(companyId);
  if (!company) throw new Error('unknown company');
  const cycles = db.runs.listCycles(companyId, 10_000);
  const runs = db.runs.listRuns({ companyId, limit: 100_000 });
  const tasks = db.work.listTasks(companyId, { limit: 100_000 });
  const drafts = db.work.listDrafts(companyId, { limit: 100_000 });
  const leads = db.work.listLeads(companyId, 100_000);
  const usage = db.billing.usageSince(companyId, 0);
  const json = {
    exportedAt: new Date(now).toISOString(),
    format: 'flowstate-business-export/1',
    company,
    configHistory: db.companies.history(companyId, 10_000),
    agents: db.companies.agentConfigs(companyId),
    cycles,
    runs: runs.map((r) => ({ ...r, steps: db.runs.steps(r.id) })),
    tasks,
    drafts,
    leads,
    tickets: db.work.listTickets(companyId, { limit: 100_000 }),
    kpis: db.work.latestKpis(companyId),
    knowledge: db.knowledge.list(companyId).map(({ embedding: _e, embedModel: _m, ...k }) => k),
    learnedRules: db.knowledge.rules(companyId),
    constraints: [...constitutionRows(), ...db.knowledge.constraints(companyId)],
    approvals: db.approvals.list({ companyId, limit: 100_000 }).map(toPendingDto),
    ledger: db.billing.ledger(companyId, 100_000),
    usage,
    audit: db.ops.auditLog(companyId, 100_000),
  };
  return {
    json,
    csv: {
      'tasks.csv': toCsv(tasks.map((t) => ({ id: t.id, title: t.title, role: t.assignedRole, status: t.status, priority: t.priority, source: t.source, created: new Date(t.createdAt).toISOString(), result: t.result }))),
      'drafts.csv': toCsv(drafts.map((d) => ({ id: d.id, kind: d.kind, channel: d.channel, status: d.status, title: d.title, body: d.body, created: new Date(d.createdAt).toISOString() }))),
      'leads.csv': toCsv(leads.map((l) => ({ email: l.email, name: l.name, company: l.companyName, status: l.status, signal: l.signal, icp_reason: l.icpReason, source: l.source }))),
      'usage.csv': toCsv(usage.map((u) => ({ at: new Date(u.createdAt).toISOString(), role: u.role, provider: u.provider, model: u.model, credits: u.credits, usd: u.costUsd, ok: u.ok }))),
    },
  };
}
