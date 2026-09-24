// Kaizen: the learning loop, kept separate from the operational loop (the
// call that does the work never decides how to improve the process).
//   • owner rejections → an "avoid" rule proposal (negative example)
//   • skill post-run hooks → rule proposals
//   • post-cycle reviewer pass (cheap model) → at most 3 proposals
//   • daily drift checker → config vs. observed outputs; opens a fix task
// Agents only ever *propose*; the owner activates rules in the Knowledge
// panel. Constitutional constraints are never touched here.

import type {
  CompanyConfig,
  FeedEventDto,
  LearnedRuleDto,
  PendingActionDto,
} from '@shared/business/types';
import type { BizDb } from '../db';
import type { GatewayChatRequest, GatewayChatResult } from '../providers/gateway';
import { extractJsonObject } from '../providers/gateway';
import type { RuleProposal } from '../skills/types';
import { driftPrompt, kaizenPrompt } from '../agent/prompts';
import { brandViolations } from './brand';
import { localDate } from '../db/util';

export interface DriftFinding {
  area: 'voice' | 'icp' | 'mission' | 'pricing';
  evidence: string;
  severity: 'low' | 'medium' | 'high';
  source: 'rule' | 'model';
}

export interface KaizenDeps {
  db: BizDb;
  gateway: { chat(req: GatewayChatRequest): Promise<GatewayChatResult> } | null;
  feed?: (e: Omit<FeedEventDto, 'id' | 'ts'>) => void;
  onSpend?: (companyId: string, credits: number, usd: number) => void;
  now?: () => number;
}

export class Kaizen {
  private readonly now: () => number;

  constructor(private readonly deps: KaizenDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Owner said no → a durable "avoid this pattern" proposal. */
  onRejected(action: PendingActionDto, reason: string): LearnedRuleDto | null {
    const rule = this.deps.db.knowledge.proposeRule({
      companyId: action.companyId,
      condition: `the ${action.role} is about to use ${action.skillKey} (${action.category}) for something like "${action.title.slice(0, 120)}"`,
      action: reason.trim()
        ? `avoid this — the owner rejected it: "${reason.trim().slice(0, 300)}"`
        : 'avoid this pattern — the owner rejected it without comment; propose a clearly different approach',
      rationale: `Rejected by the owner on ${localDate(this.now())}.`,
      polarity: 'avoid',
      confidence: 0.7,
      sourceRunId: action.runId,
      sourceActionId: action.id,
      proposedBy: 'rejection',
      now: this.now(),
    });
    if (rule) {
      this.deps.feed?.({
        companyId: action.companyId,
        cycleId: action.cycleId,
        runId: action.runId,
        role: action.role,
        kind: 'learn',
        text: `Lesson proposed from your rejection: ${rule.action.slice(0, 160)}`,
      });
    }
    return rule;
  }

  onLearn(companyId: string, proposals: RuleProposal[], ref: { runId: string | null; actionId: string | null }): void {
    for (const p of proposals.slice(0, 5)) {
      this.deps.db.knowledge.proposeRule({
        companyId,
        condition: p.condition,
        action: p.action,
        rationale: p.rationale,
        polarity: p.polarity,
        confidence: p.confidence,
        sourceRunId: ref.runId,
        sourceActionId: ref.actionId,
        proposedBy: 'agent',
        now: this.now(),
      });
    }
  }

  activeRules(companyId: string): LearnedRuleDto[] {
    return this.deps.db.knowledge.rules(companyId, 'active').slice(0, 20);
  }

  /** Post-cycle reviewer: cheap model proposes ≤ 3 rules from evidence. */
  async reviewCycle(input: {
    companyId: string;
    cycleId: string;
    config: CompanyConfig;
    summary: string;
    failures: string[];
  }): Promise<LearnedRuleDto[]> {
    if (!this.deps.gateway) return [];
    const rejections = this.deps.db.approvals
      .list({ companyId: input.companyId, statuses: ['rejected'], limit: 10 })
      .filter((a) => a.decidedAt && this.now() - a.decidedAt < 7 * 86_400_000)
      .map((a) => ({ title: a.title, reason: a.decisionNote ?? '' }));
    if (!input.failures.length && !rejections.length && input.summary.length < 200) return [];
    const existing = this.deps.db.knowledge.rules(input.companyId).filter((r) => r.status !== 'rejected');
    let res: GatewayChatResult;
    try {
      res = await this.deps.gateway.chat({
        alias: 'cheap',
        companyId: input.companyId,
        json: true,
        messages: [
          { role: 'system', content: 'You are an operations reviewer. Reply with JSON only.' },
          { role: 'user', content: kaizenPrompt({ config: input.config, summary: input.summary, failures: input.failures, rejections, existing }) },
        ],
        meta: { cycleId: input.cycleId, runId: null, role: 'kaizen' },
      });
    } catch {
      return [];
    }
    this.deps.onSpend?.(input.companyId, res.usage.credits, res.usage.costUsd);
    const parsed = extractJsonObject(res.text) as { rules?: unknown } | null;
    const rules = Array.isArray(parsed?.rules) ? parsed!.rules : [];
    const out: LearnedRuleDto[] = [];
    for (const r of rules.slice(0, 3)) {
      const o = r as Record<string, unknown>;
      const rule = this.deps.db.knowledge.proposeRule({
        companyId: input.companyId,
        condition: String(o['condition'] ?? ''),
        action: String(o['action'] ?? ''),
        rationale: String(o['rationale'] ?? ''),
        polarity: o['polarity'] === 'avoid' ? 'avoid' : 'do',
        confidence: typeof o['confidence'] === 'number' ? o['confidence'] : 0.5,
        sourceRunId: null,
        proposedBy: 'kaizen',
        now: this.now(),
      });
      if (rule) out.push(rule);
    }
    if (out.length) {
      this.deps.feed?.({
        companyId: input.companyId,
        cycleId: input.cycleId,
        runId: null,
        role: 'ceo',
        kind: 'learn',
        text: `${out.length} lesson(s) proposed — review them in Knowledge.`,
      });
    }
    return out;
  }

  /** Compare config vs. recent outputs; open one fix task on divergence. */
  async checkDrift(companyId: string, opts: { sinceMs?: number } = {}): Promise<DriftFinding[]> {
    const company = this.deps.db.companies.get(companyId);
    if (!company) return [];
    const since = this.now() - (opts.sinceMs ?? 3 * 86_400_000);
    const drafts = this.deps.db.work.listDrafts(companyId, { since, limit: 12 }).filter((d) => d.status !== 'discarded');
    if (!drafts.length) return [];
    const findings: DriftFinding[] = [];

    for (const d of drafts) {
      const v = brandViolations(`${d.title}\n${d.body}`, company.config.brandDonts);
      if (v.length) {
        findings.push({
          area: 'voice',
          evidence: `"${d.title}" uses ${v.map((x) => `"${x}"`).join(', ')} (a brand don't)`,
          severity: 'medium',
          source: 'rule',
        });
      }
    }

    if (this.deps.gateway && (company.config.brandVoice || company.config.icp)) {
      try {
        const res = await this.deps.gateway.chat({
          alias: 'cheap',
          companyId,
          json: true,
          messages: [
            { role: 'system', content: 'You are a brand and strategy auditor. Reply with JSON only.' },
            { role: 'user', content: driftPrompt(company.config, drafts.slice(0, 8).map((d) => ({ title: d.title, body: d.body, kind: d.kind }))) },
          ],
          meta: { cycleId: null, runId: null, role: 'drift' },
        });
        this.deps.onSpend?.(companyId, res.usage.credits, res.usage.costUsd);
        const parsed = extractJsonObject(res.text) as { findings?: unknown } | null;
        for (const f of Array.isArray(parsed?.findings) ? parsed!.findings.slice(0, 5) : []) {
          const o = f as Record<string, unknown>;
          const area = ['voice', 'icp', 'mission', 'pricing'].includes(String(o['area'])) ? (String(o['area']) as DriftFinding['area']) : null;
          const evidence = String(o['evidence'] ?? '').trim();
          if (!area || !evidence) continue;
          const severity = ['low', 'medium', 'high'].includes(String(o['severity'])) ? (String(o['severity']) as DriftFinding['severity']) : 'low';
          if (severity === 'low') continue;
          findings.push({ area, evidence: evidence.slice(0, 300), severity, source: 'model' });
        }
      } catch {
        // model check is best-effort; rule findings still count
      }
    }

    if (findings.length) {
      const title = 'Fix drift from the company config';
      const open = this.deps.db.work
        .listTasks(companyId, { statuses: ['backlog', 'todo', 'in_progress'] })
        .find((t) => t.source === 'drift');
      if (!open) {
        const voice = findings.some((f) => f.area === 'voice');
        this.deps.db.work.createTask({
          companyId,
          title,
          description: `The drift checker found outputs that diverge from the config:\n${findings
            .map((f) => `- [${f.area}/${f.severity}] ${f.evidence}`)
            .join('\n')}\nRewrite or discard the affected drafts so they match the config.`,
          assignedRole: voice ? 'copywriter' : 'planner',
          priority: 2,
          status: 'backlog',
          source: 'drift',
          estimatedCredits: 20,
          now: this.now(),
        });
      }
      this.deps.feed?.({
        companyId,
        cycleId: null,
        runId: null,
        role: 'ceo',
        kind: 'alert',
        text: `Drift check: ${findings.length} divergence(s) from the config (${[...new Set(findings.map((f) => f.area))].join(', ')}).`,
      });
    }
    return findings;
  }
}
