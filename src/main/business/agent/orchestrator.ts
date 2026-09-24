// The CEO: plan-and-execute over the role loops (spec §4 extension, §13
// phases 1/3/4/6). One cycle =
//   PERCEIVE  deterministic reads (Stripe revenue, site status) + state
//   PLAN      one typed JSON plan (validated, budget-fit; one shrink retry)
//   EXECUTE   role loops in priority order; a deterministic replanner skips
//             work the remaining budget/time can't cover and stops after
//             repeated failures
//   SUMMARIZE morning report / evening digest, then kaizen review
// Cycles are idempotent per company (a second trigger returns the running
// one) and leave a terminal state even on crash (recoverInterrupted).

import type {
  CompanyDto,
  CycleDto,
  CycleKind,
  KnowledgeDto,
  PlanItem,
  RoleKey,
  RunDto,
  TaskDto,
  TaskStatus,
  TriggerType,
  ChatMessageDto,
  ChatSessionDto,
  FeedEventDto,
} from '@shared/business/types';
import type { BizDb } from '../db';
import type { NewStep } from '../db/runs';
import { localDate, startOfDay, startOfMonth } from '../db/util';
import type { ActionGate } from '../guardrails/approval';
import { evaluateCompanyBudget, planCost, round4 } from '../guardrails/budgets';
import { scrubText, scrubValue } from '../guardrails/scrub';
import type { KnowledgeService } from '../memory/knowledge';
import type { Kaizen } from '../memory/kaizen';
import type { GatewayChatRequest, GatewayChatResult } from '../providers/gateway';
import { extractJsonObject } from '../providers/gateway';
import type { SkillRegistry } from '../skills/registry';
import type { SkillContext } from '../skills/types';
import { LIMITS } from '../config';
import { runLoop, type LoopOutcome } from './loop';
import { validatePlan, type ValidatedPlan } from './plan';
import {
  companyBlock,
  orchestratorPlanPrompt,
  orchestratorSystemPrompt,
  roleSystemPrompt,
  roleTaskPrompt,
  summaryPrompt,
} from './prompts';
import { ROLES } from './roles';

export interface RunnerDeps {
  db: BizDb;
  gateway: { chat(req: GatewayChatRequest): Promise<GatewayChatResult> };
  gate: ActionGate;
  registry: SkillRegistry;
  knowledge: KnowledgeService;
  kaizen: Kaizen;
  makeContext: (input: {
    companyId: string;
    role: RoleKey;
    runId: string | null;
    cycleId: string | null;
    taskId: string | null;
    signal?: AbortSignal;
  }) => SkillContext;
  feed: (e: Omit<FeedEventDto, 'id' | 'ts'>) => void;
  notify?: (companyId: string, n: { templateKey: string; title: string; body: string; digest?: string }) => void;
  now?: () => number;
  limits?: { cycleWallClockMs?: number; runWallClockMs?: number };
}

export type RunKind = Exclude<CycleKind, 'chat'>;

export interface BeginResult {
  cycle: CycleDto;
  done: Promise<CycleDto>;
  alreadyRunning: boolean;
}

/** Default instruction for scheduled per-role runs. */
const ROLE_ROUTINE: Record<RoleKey, string> = {
  ceo: 'Review the company state and add any missing roadmap tasks.',
  researcher: 'Refresh competitor and market intel; save only new, sourced findings.',
  planner: 'Groom the roadmap: merge duplicates, re-prioritize, and add missing concrete tasks.',
  coder: 'Work the highest-priority coding task in the backlog, ending in a pull request.',
  copywriter: 'Draft one high-quality post based on recent research and the brand voice.',
  sdr: 'Qualify up to 3 new ICP leads with real signals and draft personalized first emails.',
  support: 'Triage open tickets (priority + tags) and draft replies for each.',
  ads: 'Review ad performance and propose data-backed budget adjustments within the caps.',
  finance: 'Reconcile revenue, flag anomalies, and draft dunning emails for failed payments.',
};

class CycleBudget {
  spentCredits = 0;
  spentUsd = 0;

  constructor(
    readonly capCredits: number,
    readonly capUsd: number,
    readonly deadline: number,
    private readonly sink: (credits: number, usd: number, source: 'llm' | 'skill') => void,
  ) {}

  remaining(): { credits: number; usd: number } {
    return {
      credits: Math.max(0, this.capCredits - this.spentCredits),
      usd: this.capUsd > 0 ? Math.max(0, this.capUsd - this.spentUsd) : Infinity,
    };
  }

  spend(credits: number, usd: number, source: 'llm' | 'skill'): void {
    this.spentCredits += credits;
    this.spentUsd += usd;
    this.sink(credits, usd, source);
  }

  exhausted(): boolean {
    const r = this.remaining();
    return r.credits <= 0 || r.usd <= 0;
  }
}

function statusForOutcome(o: LoopOutcome): TaskStatus {
  if (o.queuedActions.length) return 'awaiting_approval';
  switch (o.stopReason) {
    case 'goal_achieved':
    case 'agent_done_unverified':
      return 'done';
    case 'max_iterations':
      return o.output ? 'done' : 'failed';
    default:
      return 'failed';
  }
}

function runStatusFor(o: LoopOutcome): RunDto['status'] {
  if (o.stopReason === 'goal_achieved' || o.stopReason === 'agent_done_unverified') return 'done';
  if (o.stopReason === 'error') return 'failed';
  return 'stopped';
}

export class CycleRunner {
  private readonly active = new Map<string, { cycleId: string; controller: AbortController; promise: Promise<CycleDto> }>();
  private readonly now: () => number;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? Date.now;
  }

  private get cycleWallClockMs(): number {
    return this.deps.limits?.cycleWallClockMs ?? LIMITS.cycleWallClockMs;
  }

  private get runWallClockMs(): number {
    return this.deps.limits?.runWallClockMs ?? LIMITS.runWallClockMs;
  }

  isRunning(companyId: string): boolean {
    return this.active.has(companyId);
  }

  runningCycleId(companyId: string): string | null {
    return this.active.get(companyId)?.cycleId ?? null;
  }

  abort(companyId: string): boolean {
    const a = this.active.get(companyId);
    if (!a) return false;
    a.controller.abort();
    return true;
  }

  abortAll(): void {
    for (const a of this.active.values()) a.controller.abort();
  }

  async idle(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((a) => a.promise));
  }

  /** Budget verdict for a company right now. */
  budgetVerdict(company: CompanyDto): ReturnType<typeof evaluateCompanyBudget> & { balance: number; monthSpent: number } {
    const now = this.now();
    const balance = this.deps.db.billing.balance(company.id);
    const monthSpent = this.deps.db.billing.monthSpent(company.id, now);
    const verdict = evaluateCompanyBudget({
      balance,
      monthSpentCredits: monthSpent,
      monthlyCredits: company.config.budgets.monthlyCredits,
      monthSpentUsd: this.deps.db.billing.usdSince(company.id, startOfMonth(now)),
      monthlyUsd: company.config.budgets.monthlyUsd,
      alertRatio: company.config.budgets.alertRatio,
    });
    return { ...verdict, balance, monthSpent };
  }

  /**
   * Start a cycle. Resolves as soon as the cycle row exists; `done`
   * resolves when it finishes. A second call while one runs returns it.
   */
  begin(companyId: string, kind: RunKind, trigger: TriggerType, opts: { role?: RoleKey; retryOf?: { runId: string; fromSeq?: number } } = {}): BeginResult | { error: string } {
    const company = this.deps.db.companies.get(companyId);
    if (!company) return { error: 'unknown company' };
    if (company.status === 'archived') return { error: 'company is archived' };
    if (company.status === 'paused' && (trigger === 'schedule' || trigger === 'catchup')) {
      return { error: 'company is paused' };
    }

    const running = this.active.get(companyId);
    if (running) {
      const cycle = this.deps.db.runs.getCycle(running.cycleId)!;
      return { cycle, done: running.promise, alreadyRunning: true };
    }
    const dbRunning = this.deps.db.runs.runningCycle(companyId);
    if (dbRunning) return { cycle: dbRunning, done: Promise.resolve(dbRunning), alreadyRunning: true };

    const now = this.now();
    const verdict = this.budgetVerdict(company);
    if (verdict.level === 'block') {
      const cycle = this.deps.db.runs.createCycle({
        companyId,
        kind,
        triggerType: trigger,
        role: opts.role ?? null,
        creditsCap: 0,
        usdCap: 0,
        configVersion: company.activeConfigVersion,
        status: 'budget_stopped',
        now,
      });
      this.deps.db.runs.updateCycle(cycle.id, { stopReason: verdict.message, endedAt: now });
      this.deps.feed({ companyId, cycleId: cycle.id, runId: null, role: 'ceo', kind: 'alert', text: verdict.message });
      this.notifyOnce(companyId, 'budget_block', startOfDay(now), 'Business cycles paused', verdict.message);
      const final = this.deps.db.runs.getCycle(cycle.id)!;
      return { cycle: final, done: Promise.resolve(final), alreadyRunning: false };
    }
    if (verdict.level === 'warn') {
      this.notifyOnce(companyId, 'budget_warn', startOfMonth(now), 'Budget alert', `${company.name}: ${verdict.message}`);
    }

    const cfg = company.config;
    const creditsCap = round4(Math.max(0, Math.min(cfg.budgets.cycleCredits, verdict.balance)));
    const cycle = this.deps.db.runs.createCycle({
      companyId,
      kind,
      triggerType: trigger,
      role: opts.role ?? null,
      creditsCap,
      usdCap: cfg.budgets.cycleUsd,
      configVersion: company.activeConfigVersion,
      now,
    });
    const controller = new AbortController();
    const promise = this.execute(company, cycle, kind, trigger, opts, controller.signal).finally(() => {
      this.active.delete(companyId);
    });
    this.active.set(companyId, { cycleId: cycle.id, controller, promise });
    return { cycle, done: promise, alreadyRunning: false };
  }

  /** Convenience: begin + await. */
  async run(companyId: string, kind: RunKind, trigger: TriggerType, opts: { role?: RoleKey } = {}): Promise<CycleDto> {
    const r = this.begin(companyId, kind, trigger, opts);
    if ('error' in r) throw new Error(r.error);
    return r.done;
  }

  private notifyOnce(companyId: string, key: string, since: number, title: string, body: string): void {
    const last = this.deps.db.ops.lastNotification(companyId, key);
    if (last && last >= since) return;
    this.deps.notify?.(companyId, { templateKey: key, title, body });
  }

  // ── cycle execution ─────────────────────────────────────────────────────

  private async execute(
    company: CompanyDto,
    cycle: CycleDto,
    kind: RunKind,
    trigger: TriggerType,
    opts: { role?: RoleKey; retryOf?: { runId: string; fromSeq?: number } },
    signal: AbortSignal,
  ): Promise<CycleDto> {
    const db = this.deps.db;
    const budget = new CycleBudget(cycle.creditsCap, cycle.usdCap, this.now() + this.cycleWallClockMs, (credits, usd, source) => {
      db.runs.addCycleSpend(cycle.id, credits, usd);
      if (source === 'llm' && credits > 0) {
        db.billing.entry({
          companyId: company.id,
          delta: -credits,
          reason: 'cycle_spend',
          refType: 'cycle',
          refId: cycle.id,
          now: this.now(),
        });
      }
    });
    const ceoRun = db.runs.createRun({
      companyId: company.id,
      cycleId: cycle.id,
      role: 'ceo',
      triggerType: trigger,
      goal: kind === 'evening' ? 'Write the end-of-day summary' : kind === 'role' ? `Run the ${opts.role} routine` : 'Plan and run today\'s cycle',
      now: this.now(),
    });
    const ceoUsage = { tokensIn: 0, tokensOut: 0, costUsd: 0, credits: 0 };
    const trace = (step: NewStep): void => {
      db.runs.appendStep(ceoRun.id, step, this.now());
    };
    this.deps.feed({
      companyId: company.id,
      cycleId: cycle.id,
      runId: ceoRun.id,
      role: 'ceo',
      kind: 'cycle-start',
      text: `${kind === 'manual' ? 'Manual' : kind === 'role' ? `${ROLES[opts.role ?? 'ceo'].label}` : kind[0]!.toUpperCase() + kind.slice(1)} cycle started · budget ${Math.floor(cycle.creditsCap)} credits`,
    });

    const ceoChat = async (req: Omit<GatewayChatRequest, 'companyId' | 'meta'>, label: string): Promise<GatewayChatResult> => {
      const t0 = this.now();
      const res = await this.deps.gateway.chat({
        ...req,
        companyId: company.id,
        signal,
        meta: { cycleId: cycle.id, runId: ceoRun.id, role: 'ceo' },
      });
      budget.spend(res.usage.credits, res.usage.costUsd, 'llm');
      ceoUsage.tokensIn += res.usage.inputTokens;
      ceoUsage.tokensOut += res.usage.outputTokens;
      ceoUsage.costUsd += res.usage.costUsd;
      ceoUsage.credits += res.usage.credits;
      trace({
        phase: label === 'plan' ? 'plan' : 'reason',
        stepKind: 'llm',
        promptSnippet: scrubText(req.messages[req.messages.length - 1]?.content ?? '', LIMITS.promptSnippetChars),
        content: scrubText(res.text, LIMITS.stepContentChars),
        model: res.model,
        tokensIn: res.usage.inputTokens,
        tokensOut: res.usage.outputTokens,
        costUsd: res.usage.costUsd,
        credits: res.usage.credits,
        durationMs: this.now() - t0,
        ok: true,
      });
      return res;
    };

    let status: CycleDto['status'] = 'done';
    let stopReason: string | null = null;
    let error: string | null = null;
    let summary = '';
    try {
      if (kind === 'evening') {
        summary = await this.evening(company, cycle, ceoChat, budget, trace);
      } else if (kind === 'role') {
        const r = await this.roleRoutine(company, cycle, opts.role ?? 'researcher', trigger, budget, signal, opts.retryOf);
        summary = r.summary;
        if (r.stopReason) stopReason = r.stopReason;
        if (r.skipped) status = 'skipped';
      } else {
        const r = await this.planAndExecute(company, cycle, trigger, ceoChat, budget, trace, signal);
        summary = r.summary;
        stopReason = r.stopReason;
        if (r.failed) {
          status = 'failed';
          error = r.stopReason;
        }
      }
      if (signal.aborted) {
        status = 'aborted';
        stopReason = 'aborted by the owner';
      } else if (status === 'done' && stopReason === 'budget_exhausted') {
        status = 'budget_stopped';
      }
    } catch (err) {
      status = signal.aborted ? 'aborted' : 'failed';
      error = err instanceof Error ? err.message : String(err);
      stopReason = signal.aborted ? 'aborted by the owner' : 'error';
      this.deps.feed({ companyId: company.id, cycleId: cycle.id, runId: ceoRun.id, role: 'ceo', kind: 'error', text: `Cycle failed: ${scrubText(error, 300)}` });
    }

    const endedAt = this.now();
    db.runs.addRunUsage(ceoRun.id, ceoUsage);
    db.runs.updateRun(ceoRun.id, {
      status: status === 'failed' ? 'failed' : status === 'aborted' ? 'stopped' : 'done',
      stopReason: status === 'aborted' ? 'aborted' : status === 'failed' ? 'error' : status === 'budget_stopped' ? 'budget_exhausted' : 'goal_achieved',
      output: summary ? scrubText(summary, 8_000) : null,
      errorMessage: error ? scrubText(error, 500) : null,
      endedAt,
    });
    db.runs.updateCycle(cycle.id, {
      status,
      summary: summary || null,
      stopReason,
      error: error ? scrubText(error, 500) : null,
      endedAt,
    });
    const final = db.runs.getCycle(cycle.id)!;
    const pendingCreated = db.approvals.list({ companyId: company.id, statuses: ['pending'] }).filter((p) => p.cycleId === cycle.id).length;
    const runs = db.runs.runsForCycle(cycle.id).filter((r) => r.role !== 'ceo' || kind === 'role');
    this.deps.feed({
      companyId: company.id,
      cycleId: cycle.id,
      runId: ceoRun.id,
      role: 'ceo',
      kind: 'cycle-end',
      text: `Cycle ${status.replace('_', ' ')} · ${runs.length} run(s) · ${pendingCreated} need approval · ${final.creditsSpent.toFixed(1)}/${Math.floor(final.creditsCap)} credits`,
    });
    this.deps.notify?.(company.id, {
      templateKey: kind === 'evening' ? 'evening_digest' : 'cycle_finished',
      title: `${company.name}: ${kind === 'evening' ? 'end-of-day summary' : `cycle ${status.replace('_', ' ')}`}`,
      body: `Cycle finished with ${runs.length} run(s); ${pendingCreated} action(s) need your approval.`,
      ...(summary ? { digest: summary } : {}),
    });
    return final;
  }

  // ── PERCEIVE ────────────────────────────────────────────────────────────

  private async perceive(company: CompanyDto, cycle: CycleDto, budget: CycleBudget, trace: (s: NewStep) => void, signal: AbortSignal): Promise<string[]> {
    const notes: string[] = [];
    const ctx = this.deps.makeContext({ companyId: company.id, role: 'finance', runId: null, cycleId: cycle.id, taskId: null, signal });
    const reconcile = this.deps.registry.get('stripe.reconcile');
    if (reconcile && this.deps.registry.isAvailable(reconcile, ctx)) {
      const out = await this.deps.gate.invoke(ctx, reconcile, { days: 30 }, { remainingCredits: budget.remaining().credits });
      if (out.kind === 'executed') {
        budget.spend(out.credits, 0, 'skill');
        notes.push(out.result.ok ? 'Stripe reconciled (last 30 days).' : `Stripe read failed: ${out.result.content.slice(0, 200)}`);
      }
    }
    const site = company.config.links.site;
    if (site) {
      const url = /^https?:\/\//.test(site) ? site : `https://${site}`;
      const t0 = this.now();
      try {
        const res = await ctx.fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8_000) });
        const up = res.status < 500 ? 1 : 0;
        this.deps.db.work.recordKpi(company.id, { key: 'site_up', value: up, unit: `HTTP ${res.status}`, source: 'site check' }, this.now());
        notes.push(`Site ${url} → HTTP ${res.status} in ${this.now() - t0}ms.`);
      } catch (err) {
        this.deps.db.work.recordKpi(company.id, { key: 'site_up', value: 0, unit: 'unreachable', source: 'site check' }, this.now());
        notes.push(`Site ${url} unreachable: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
      }
    }
    trace({ phase: 'perceive', stepKind: 'note', content: scrubText(notes.join('\n') || 'No connected data sources to read.', 1_000) });
    return notes;
  }

  // ── PLAN + EXECUTE ──────────────────────────────────────────────────────

  private async planAndExecute(
    company: CompanyDto,
    cycle: CycleDto,
    trigger: TriggerType,
    ceoChat: (req: Omit<GatewayChatRequest, 'companyId' | 'meta'>, label: string) => Promise<GatewayChatResult>,
    budget: CycleBudget,
    trace: (s: NewStep) => void,
    signal: AbortSignal,
  ): Promise<{ summary: string; stopReason: string | null; failed: boolean }> {
    const db = this.deps.db;
    const cfg = company.config;
    await this.perceive(company, cycle, budget, trace, signal);

    const agents = db.companies.agentConfigs(company.id);
    const enabledRoles = agents.filter((a) => a.enabled).map((a) => a.role);
    const validationPending = cfg.validation.required && cfg.validation.status === 'pending';
    const blockedRoles = validationPending ? enabledRoles.filter((r) => ROLES[r].buildsProduct) : [];
    const openTasks = db.work.listTasks(company.id, { statuses: ['backlog', 'todo'] });
    const humanTasks = openTasks.filter((t) => t.source === 'human').slice(0, 5);
    const backlog = openTasks.filter((t) => t.source !== 'human').slice(0, 10);
    const memories = await this.deps.knowledge.search(company.id, [...cfg.goals, cfg.niche].join('; ') || cfg.name, { k: 5 });
    const reserve = Math.min(10, cycle.creditsCap * 0.1);
    const planBudget = Math.max(0, budget.remaining().credits - reserve);
    const lastSummary = db.runs.lastCycle(company.id, { withSummary: true })?.summary ?? null;
    const rules = this.deps.kaizen.activeRules(company.id);
    const constraints = db.knowledge.constraints(company.id).map((c) => c.rule);

    const planCtx = {
      enabledRoles: new Set(enabledRoles),
      validationPending,
      budgetCredits: planBudget,
      maxItems: LIMITS.maxPlanItems,
      humanTasks,
      knownTasks: new Map(openTasks.map((t) => [t.id, t])),
    };
    const system = orchestratorSystemPrompt(cfg, rules, constraints);
    const prompt = orchestratorPlanPrompt({
      now: this.now(),
      remainingCredits: planBudget,
      maxItems: LIMITS.maxPlanItems,
      kpis: db.work.latestKpis(company.id),
      openTickets: db.work.countOpenTickets(company.id),
      pendingApprovals: db.approvals.countPending(company.id),
      lastSummary,
      backlog,
      humanTasks,
      enabledRoles,
      blockedRoles,
      memories,
      validationPending,
    });

    this.deps.feed({ companyId: company.id, cycleId: cycle.id, runId: null, role: 'ceo', kind: 'phase', text: 'Planning from config, state and memory' });
    const ask = async (extra: string): Promise<ValidatedPlan | null> => {
      const res = await ceoChat(
        {
          alias: 'planner',
          json: true,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: extra ? `${prompt}\n\n${extra}` : prompt },
          ],
        },
        'plan',
      );
      return validatePlan(extractJsonObject(res.text), planCtx);
    };
    let validated = await ask('');
    if (!validated) validated = await ask('Reply with ONLY the JSON object — no prose, no markdown.');
    if (!validated) {
      return { summary: '## Cycle report\nThe planner did not return a valid plan, so nothing was dispatched.', stopReason: 'planner returned invalid JSON', failed: true };
    }
    if (validated.overBudget && !budget.exhausted()) {
      const retry = await ask(
        `Your previous plan cost ${validated.rawCost} credits but only ${Math.floor(planBudget)} remain. The plan is invalid — shrink it to fit.`,
      );
      if (retry && retry.plan.plan.length) validated = retry;
    }

    // Persist tasks (link or create) — the task board mirrors the plan.
    const items: PlanItem[] = [];
    for (const item of validated.plan.plan) {
      let task: TaskDto | null = null;
      if (item.taskId) {
        task = db.work.updateTask(company.id, item.taskId, { status: 'todo', cycleId: cycle.id }, this.now());
      }
      if (!task) {
        task = db.work.createTask({
          companyId: company.id,
          cycleId: cycle.id,
          title: item.title,
          description: item.description,
          assignedRole: item.role,
          priority: Math.min(5, items.length + 1),
          status: 'todo',
          source: 'ceo',
          riskLevel: item.risk_level,
          estimatedCredits: item.estimated_cost_credits,
          approvalRequired: item.requires_approval,
          now: this.now(),
        });
      }
      items.push({ ...item, taskId: task.id });
    }
    const plan = { ...validated.plan, plan: items };
    // The stored plan is part of the trace: scrub it (tasks keep the working text).
    db.runs.updateCycle(cycle.id, { plan: scrubValue(plan) as typeof plan });
    trace({
      phase: 'plan',
      stepKind: 'note',
      content: scrubText(
        `${items.length} task(s), est. ${planCost(items)} credits of ${Math.floor(planBudget)}.\n${items.map((i) => `- (${i.role}) ${i.title} ~${i.estimated_cost_credits}cr`).join('\n')}${plan.dropped?.length ? `\nDropped: ${plan.dropped.map((d) => `${d.title} (${d.reason})`).join('; ')}` : ''}`,
        LIMITS.stepContentChars,
      ),
    });
    this.deps.feed({
      companyId: company.id,
      cycleId: cycle.id,
      runId: null,
      role: 'ceo',
      kind: 'plan',
      text: `Plan: ${items.length} task(s) · est. ${planCost(items)} credits${plan.dropped?.length ? ` · ${plan.dropped.length} dropped` : ''}`,
    });

    // EXECUTE with a deterministic replanner.
    let stopReason: string | null = null;
    let consecutiveFailures = 0;
    const results: Array<{ title: string; role: RoleKey; status: TaskStatus; result: string | null }> = [];
    for (const item of items) {
      const skip = (reason: string): void => {
        db.work.updateTask(company.id, item.taskId!, { status: 'skipped', result: reason }, this.now());
        results.push({ title: item.title, role: item.role, status: 'skipped', result: reason });
      };
      if (signal.aborted) {
        skip('cycle aborted');
        stopReason = 'aborted';
        continue;
      }
      if (this.now() > budget.deadline) {
        skip('cycle time limit reached');
        stopReason = 'timeout';
        continue;
      }
      if (budget.exhausted()) {
        skip('cycle budget exhausted');
        stopReason = 'budget_exhausted';
        continue;
      }
      if (consecutiveFailures >= 3) {
        skip('stopped after 3 consecutive failures');
        stopReason = stopReason ?? 'too many failures';
        continue;
      }
      if (budget.remaining().credits < item.estimated_cost_credits * 0.5) {
        skip(`not enough budget left (${budget.remaining().credits.toFixed(1)} < half of ~${item.estimated_cost_credits})`);
        continue;
      }
      const { outcome } = await this.runRole({
        company,
        cycle,
        role: item.role,
        title: item.title,
        description: item.description,
        taskId: item.taskId ?? null,
        trigger,
        budget,
        signal,
      });
      const status = statusForOutcome(outcome);
      results.push({ title: item.title, role: item.role, status, result: outcome.output || outcome.error || outcome.stopReason });
      consecutiveFailures = status === 'failed' ? consecutiveFailures + 1 : 0;
      if (outcome.stopReason === 'budget_exhausted' && budget.exhausted()) stopReason = 'budget_exhausted';
    }

    const summary = await this.summarize(company, cycle, 'morning', results, ceoChat, stopReason);
    const failures = results.filter((r) => r.status === 'failed').map((r) => `${r.role}: ${r.title} — ${(r.result ?? '').slice(0, 200)}`);
    if (!signal.aborted) {
      await this.deps.kaizen.reviewCycle({ companyId: company.id, cycleId: cycle.id, config: cfg, summary, failures });
    }
    return { summary, stopReason, failed: false };
  }

  // ── one role run (a loop) ───────────────────────────────────────────────

  async runRole(input: {
    company: CompanyDto;
    cycle: CycleDto;
    role: RoleKey;
    title: string;
    description: string;
    taskId: string | null;
    trigger: TriggerType;
    budget: CycleBudget;
    signal: AbortSignal;
    extra?: string;
  }): Promise<{ outcome: LoopOutcome; run: RunDto }> {
    const db = this.deps.db;
    const { company, cycle, role } = input;
    const agent = db.companies.agentConfig(company.id, role);
    const run = db.runs.createRun({
      companyId: company.id,
      cycleId: cycle.id,
      taskId: input.taskId,
      role,
      triggerType: input.trigger,
      goal: scrubText(`${input.title}${input.description ? ` — ${input.description}` : ''}`, 4_000),
      now: this.now(),
    });
    const ctx = this.deps.makeContext({
      companyId: company.id,
      role,
      runId: run.id,
      cycleId: cycle.id,
      taskId: input.taskId,
      signal: input.signal,
    });
    ctx.feed = (text) =>
      this.deps.feed({ companyId: company.id, cycleId: cycle.id, runId: run.id, role, kind: 'alert', text });
    const skills = this.deps.registry.forRole(role, ctx);
    const rem = input.budget.remaining();
    const creditCap = Math.max(0, Math.min(agent?.costCapCredits ?? ROLES[role].costCapCredits, rem.credits));
    const maxIterations = agent?.maxIterations ?? ROLES[role].maxIterations;
    let memories: KnowledgeDto[] = [];
    try {
      memories = await this.deps.knowledge.search(company.id, `${input.title} ${input.description}`, { k: 5 });
    } catch {
      memories = [];
    }
    if (input.taskId) db.work.updateTask(company.id, input.taskId, { status: 'in_progress' }, this.now());
    this.deps.feed({ companyId: company.id, cycleId: cycle.id, runId: run.id, role, kind: 'task-start', text: input.title });

    const outcome = await runLoop(
      {
        gateway: this.deps.gateway,
        gate: this.deps.gate,
        trace: (step) => {
          db.runs.appendStep(run.id, step, this.now());
        },
        now: this.now,
      },
      {
        companyId: company.id,
        cycleId: cycle.id,
        runId: run.id,
        taskId: input.taskId,
        role,
        alias: agent?.modelAlias ?? ROLES[role].modelAlias,
        systemPrompt: roleSystemPrompt(
          role,
          company.config,
          this.deps.kaizen.activeRules(company.id),
          db.knowledge.constraints(company.id).map((c) => c.rule),
          agent?.standingInstruction ?? '',
          this.now(),
        ),
        userPrompt: roleTaskPrompt({
          title: input.title,
          description: input.description,
          creditCap,
          maxIterations,
          memories,
          ...(input.extra ? { extra: input.extra } : {}),
        }),
        goal: `${input.title}${input.description ? `: ${input.description}` : ''}`,
        skills,
        ctx,
        limits: {
          maxIterations,
          creditCap,
          usdCap: 0,
          wallClockMs: Math.max(1_000, Math.min(this.runWallClockMs, input.budget.deadline - this.now())),
          noProgressWindow: LIMITS.noProgressWindow,
        },
        signal: input.signal,
        cycleRemaining: () => input.budget.remaining(),
        onSpend: (c, u, source) => input.budget.spend(c, u, source),
        onTool: (name) =>
          this.deps.feed({ companyId: company.id, cycleId: cycle.id, runId: run.id, role, kind: 'tool', text: `tool: ${name}` }),
      },
    );

    const now = this.now();
    db.runs.addRunUsage(run.id, { tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, costUsd: outcome.usd, credits: outcome.credits });
    db.runs.updateRun(run.id, {
      status: runStatusFor(outcome),
      stopReason: outcome.stopReason,
      output: outcome.output ? scrubText(outcome.output, 8_000) : null,
      iterationCount: outcome.iterations,
      errorMessage: outcome.error ? scrubText(outcome.error, 500) : null,
      endedAt: now,
    });
    if (input.taskId) {
      const current = db.work.getTask(input.taskId, company.id);
      const next = statusForOutcome(outcome);
      const keepAwaiting = current?.status === 'awaiting_approval' && next !== 'failed';
      db.work.updateTask(
        company.id,
        input.taskId,
        {
          status: keepAwaiting ? 'awaiting_approval' : next,
          result: scrubText(outcome.output || outcome.error || `stopped: ${outcome.stopReason}`, 2_000),
          ...(next === 'done' ? { completedAt: now } : {}),
        },
        now,
      );
    }
    const ok = runStatusFor(outcome) === 'done' || outcome.queuedActions.length > 0;
    this.deps.feed({
      companyId: company.id,
      cycleId: cycle.id,
      runId: run.id,
      role,
      kind: ok ? 'task-done' : 'task-failed',
      text: `${input.title} — ${outcome.stopReason.replace(/_/g, ' ')}${outcome.queuedActions.length ? ` · ${outcome.queuedActions.length} queued for approval` : ''}`,
      credits: round4(outcome.credits),
    });
    return { outcome, run: db.runs.getRun(run.id)! };
  }

  // ── scheduled per-role routine ──────────────────────────────────────────

  private async roleRoutine(
    company: CompanyDto,
    cycle: CycleDto,
    role: RoleKey,
    trigger: TriggerType,
    budget: CycleBudget,
    signal: AbortSignal,
    retryOf?: { runId: string; fromSeq?: number },
  ): Promise<{ summary: string; stopReason: string | null; skipped: boolean }> {
    const cfg = company.config;
    const agent = this.deps.db.companies.agentConfig(company.id, role);
    if (!agent?.enabled) return { summary: `${ROLES[role].label} is disabled.`, stopReason: 'role disabled', skipped: true };
    if (cfg.validation.required && cfg.validation.status === 'pending' && ROLES[role].buildsProduct) {
      return { summary: `${ROLES[role].label} is blocked until the idea is validated.`, stopReason: 'validation gate', skipped: true };
    }
    let title = `${ROLES[role].label} routine`;
    let description = agent.standingInstruction || ROLE_ROUTINE[role];
    let extra: string | undefined;
    let taskId: string | null = null;
    if (retryOf) {
      const prev = this.deps.db.runs.getRun(retryOf.runId, company.id);
      if (prev) {
        title = `Retry: ${prev.goal.slice(0, 150)}`;
        description = prev.goal;
        taskId = prev.taskId;
        const steps = this.deps.db.runs.steps(prev.id).filter((s) => retryOf.fromSeq === undefined || s.seqNo <= retryOf.fromSeq);
        extra = `## Previous attempt (up to step ${retryOf.fromSeq ?? steps.length})\n${steps
          .filter((s) => s.stepKind === 'tool' || s.stepKind === 'approval')
          .map((s) => `- ${s.toolName}: ${(s.toolResultRedacted ?? '').slice(0, 300)}`)
          .join('\n') || '(no tool results)'}\nContinue from there; do not redo finished work.`;
      }
    }
    const { outcome } = await this.runRole({ company, cycle, role, title, description, taskId, trigger, budget, signal, ...(extra ? { extra } : {}) });
    const summary = [
      `## ${ROLES[role].label} — ${outcome.stopReason.replace(/_/g, ' ')}`,
      outcome.output ? outcome.output.slice(0, 1_500) : '(no report)',
      outcome.queuedActions.length ? `**Needs you:** ${outcome.queuedActions.length} action(s) in the approval queue.` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return { summary, stopReason: outcome.stopReason === 'budget_exhausted' ? 'budget_exhausted' : null, skipped: false };
  }

  // ── evening digest ──────────────────────────────────────────────────────

  private async evening(
    company: CompanyDto,
    cycle: CycleDto,
    ceoChat: (req: Omit<GatewayChatRequest, 'companyId' | 'meta'>, label: string) => Promise<GatewayChatResult>,
    budget: CycleBudget,
    trace: (s: NewStep) => void,
  ): Promise<string> {
    const since = startOfDay(this.now());
    const tasks = this.deps.db.work
      .listTasks(company.id, { limit: 200 })
      .filter((t) => t.updatedAt >= since && t.status !== 'backlog');
    trace({ phase: 'perceive', stepKind: 'note', content: `${tasks.length} task(s) touched today.` });
    const summary = await this.summarize(
      company,
      cycle,
      'evening',
      tasks.map((t) => ({ title: t.title, role: t.assignedRole, status: t.status, result: t.result })),
      ceoChat,
      null,
    );
    const findings = await this.deps.kaizen.checkDrift(company.id);
    trace({ phase: 'observe', stepKind: 'note', content: `drift check: ${findings.length} finding(s)` });
    void budget;
    return summary;
  }

  // ── summaries ───────────────────────────────────────────────────────────

  private async summarize(
    company: CompanyDto,
    cycle: CycleDto,
    kind: 'morning' | 'evening',
    results: Array<{ title: string; role: string; status: string; result: string | null }>,
    ceoChat: (req: Omit<GatewayChatRequest, 'companyId' | 'meta'>, label: string) => Promise<GatewayChatResult>,
    stopReason: string | null,
  ): Promise<string> {
    const db = this.deps.db;
    const pending = db.approvals.list({ companyId: company.id, statuses: ['pending'], limit: 20 }).map((p) => ({ ...p }));
    const current = db.runs.getCycle(cycle.id)!;
    const fallback = (): string =>
      [
        kind === 'evening' ? '## Evening summary' : '## Cycle report',
        `**Done**\n${results.filter((r) => r.status === 'done').map((r) => `- (${r.role}) ${r.title}`).join('\n') || '- nothing completed'}`,
        `**Needs you**\n${pending.map((p) => `- ${p.title}`).join('\n') || '- nothing'}`,
        results.some((r) => r.status === 'failed' || r.status === 'skipped')
          ? `**Blocked / failed**\n${results.filter((r) => r.status === 'failed' || r.status === 'skipped').map((r) => `- (${r.role}) ${r.title}: ${(r.result ?? '').slice(0, 160)}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
    let text: string;
    const room = current.creditsCap - current.creditsSpent;
    if (room <= 0) {
      text = fallback();
    } else {
      try {
        const res = await ceoChat(
          {
            alias: 'planner',
            messages: [
              { role: 'system', content: `You are the CEO reporting to the owner. Be concise and honest.\n\n${companyBlock(company.config)}` },
              {
                role: 'user',
                content: summaryPrompt({
                  kind,
                  config: company.config,
                  plan: results,
                  runs: db.runs.runsForCycle(cycle.id),
                  pending,
                  kpis: db.work.latestKpis(company.id),
                  creditsSpent: current.creditsSpent,
                  creditsCap: current.creditsCap,
                  stopReason,
                }),
              },
            ],
          },
          'summary',
        );
        text = res.text.trim() || fallback();
      } catch {
        text = fallback();
      }
    }
    this.deps.feed({ companyId: company.id, cycleId: cycle.id, runId: null, role: 'ceo', kind: 'summary', text: kind === 'evening' ? 'Evening summary ready' : 'Cycle report ready' });
    await this.deps.knowledge.add(company.id, {
      content: `${kind === 'evening' ? 'Day summary' : 'Cycle summary'} ${localDate(this.now())}: ${text.replace(/[#*_>]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 1_200)}`,
      category: 'summary',
      source: `cycle ${cycle.id}`,
      confidence: 0.5,
    });
    return text;
  }

  // ── chat with the CEO ───────────────────────────────────────────────────

  async chat(companyId: string, sessionId: string | null, message: string): Promise<{ session: ChatSessionDto; messages: ChatMessageDto[]; error?: string }> {
    const db = this.deps.db;
    const company = db.companies.get(companyId);
    if (!company) throw new Error('unknown company');
    const session = (sessionId && db.ops.chatSession(companyId, sessionId)) || db.ops.createChatSession(companyId, message.slice(0, 60) || 'Chat with the CEO', this.now());
    db.ops.addChatMessage(session.id, 'user', message, null, this.now());
    const verdict = this.budgetVerdict(company);
    if (verdict.level === 'block') {
      db.ops.addChatMessage(session.id, 'assistant', `I can't work right now: ${verdict.message}`, null, this.now());
      return { session, messages: db.ops.chatMessages(session.id), error: verdict.message };
    }
    const history = db.ops.chatMessages(session.id).slice(-12, -1);
    const run = db.runs.createRun({ companyId, cycleId: null, role: 'ceo', triggerType: 'chat', goal: scrubText(message, 500), now: this.now() });
    const ctx = this.deps.makeContext({ companyId, role: 'ceo', runId: run.id, cycleId: null, taskId: null });
    const pending = db.approvals.list({ companyId, statuses: ['pending'], limit: 10 });
    const open = db.work.listTasks(companyId, { statuses: ['backlog', 'todo', 'in_progress', 'awaiting_approval'], limit: 15 });
    const last = db.runs.lastCycle(companyId, { withSummary: true });
    const state = [
      `KPIs: ${db.work.latestKpis(companyId).map((k) => `${k.key}=${k.value}${k.unit ? ` ${k.unit}` : ''}`).join('; ') || 'none'}`,
      `Pending approvals: ${pending.map((p) => p.title).join('; ') || 'none'}`,
      `Open tasks: ${open.map((t) => `[${t.status}] (${t.assignedRole}) ${t.title}`).join('; ') || 'none'}`,
      last?.summary ? `Last cycle report:\n${last.summary.slice(0, 1_500)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const creditCap = Math.min(40, verdict.balance);
    const outcome = await runLoop(
      {
        gateway: this.deps.gateway,
        gate: this.deps.gate,
        trace: (step) => {
          db.runs.appendStep(run.id, step, this.now());
        },
        now: this.now,
      },
      {
        companyId,
        cycleId: null,
        runId: run.id,
        taskId: null,
        role: 'ceo',
        alias: 'planner',
        systemPrompt: `${roleSystemPrompt('ceo', company.config, this.deps.kaizen.activeRules(companyId), db.knowledge.constraints(companyId).map((c) => c.rule), '', this.now())}\n\n## Current state\n${state}\n\nYou are chatting with the owner. Answer directly and honestly. If they ask for work, create tasks with tasks_create (they run in the next cycle).`,
        userPrompt: `${history.map((m) => `${m.role === 'user' ? 'Owner' : 'You'}: ${m.content.slice(0, 1_500)}`).join('\n\n')}${history.length ? '\n\n' : ''}Owner: ${message}`,
        goal: message,
        skills: this.deps.registry.forRole('ceo', ctx),
        ctx,
        limits: { maxIterations: 6, creditCap, usdCap: 0, wallClockMs: 5 * 60_000, noProgressWindow: LIMITS.noProgressWindow },
        goalCheck: false,
        onSpend: (credits, _usd, source) => {
          if (source === 'llm' && credits > 0) {
            db.billing.entry({ companyId, delta: -credits, reason: 'cycle_spend', refType: 'chat', refId: run.id, now: this.now() });
          }
        },
      },
    );
    db.runs.addRunUsage(run.id, { tokensIn: outcome.tokensIn, tokensOut: outcome.tokensOut, costUsd: outcome.usd, credits: outcome.credits });
    db.runs.updateRun(run.id, {
      status: outcome.stopReason === 'error' ? 'failed' : 'done',
      stopReason: outcome.stopReason,
      output: outcome.output ? scrubText(outcome.output, 8_000) : null,
      iterationCount: outcome.iterations,
      errorMessage: outcome.error ?? null,
      endedAt: this.now(),
    });
    const reply = outcome.output || (outcome.error ? `Something went wrong: ${outcome.error}` : 'I have nothing to add.');
    db.ops.addChatMessage(session.id, 'assistant', reply, run.id, this.now());
    return { session, messages: db.ops.chatMessages(session.id), ...(outcome.error ? { error: outcome.error } : {}) };
  }
}
