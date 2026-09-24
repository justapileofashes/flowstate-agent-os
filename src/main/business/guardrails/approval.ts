// guardrail_check() + the approval queue (spec §4 ACT, §10.1, §10.4).
//
// Every skill call from every agent goes through ActionGate.invoke():
//   validate args → role allowlist → precondition → approval matrix →
//   { execute once (idempotency ledger) | enqueue pending action | deny }.
// The matrix decision uses the skill's declared category/risk and server
// counters only; nothing the model says can lower a gate. Approved actions
// execute through the same idempotent path, so a double-click or a retry
// can never send twice. Failed executions refund their credits.

import { createHash } from 'node:crypto';
import type {
  FeedEventDto,
  PendingActionDetailDto,
  PendingActionDto,
  RoleKey,
} from '@shared/business/types';
import { decideGate, OBJECTION_WINDOW_MS, type Gate, type GateDecision } from '@shared/business/policy';
import type { BizDb } from '../db';
import { toPendingDto, type PendingRow } from '../db/approvals';
import type { Vault } from '../crypto/vault';
import type { SkillRegistry } from '../skills/registry';
import type { RuleProposal, Skill, SkillContext, SkillResult } from '../skills/types';
import { LIMITS } from '../config';
import { scrubText } from './scrub';

export type InvokeOutcome =
  | { kind: 'executed'; result: SkillResult; credits: number; replayed: boolean }
  | { kind: 'queued'; actionId: string; gate: Gate; reason: string; content: string }
  | { kind: 'denied'; reason: string; content: string }
  | { kind: 'invalid'; content: string }
  | { kind: 'precondition_failed'; reason: string; content: string }
  | { kind: 'budget'; content: string };

export interface ActionGateDeps {
  db: BizDb;
  vault: Vault;
  registry: SkillRegistry;
  makeContext: (input: {
    companyId: string;
    role: RoleKey;
    runId: string | null;
    cycleId: string | null;
    taskId: string | null;
    signal?: AbortSignal;
  }) => SkillContext;
  feed?: (e: Omit<FeedEventDto, 'id' | 'ts'>) => void;
  /** Kaizen: learn from rejections and post-run hooks. */
  onRejected?: (action: PendingActionDto, reason: string) => void;
  onLearn?: (companyId: string, proposals: RuleProposal[], ref: { runId: string | null; actionId: string | null }) => void;
  now?: () => number;
}

/** Stable JSON: sorted keys so equal args hash equally. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
}

export function idempotencyKey(skillKey: string, companyId: string, args: unknown, scope: string): string {
  return createHash('sha256')
    .update(`${skillKey}\u0000${companyId}\u0000${canonicalJson(args)}\u0000${scope}`)
    .digest('hex');
}

export class ActionGate {
  private readonly now: () => number;

  constructor(private readonly deps: ActionGateDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Server-side gate decision for a (validated) call. */
  async decide(ctx: SkillContext, skill: Skill, args: unknown): Promise<GateDecision> {
    const cfg = ctx.company.config;
    const agent = this.deps.db.companies.agentConfig(ctx.companyId, ctx.role);
    const metrics = skill.gateMetrics ? await skill.gateMetrics(ctx, args) : {};
    return decideGate({
      category: skill.category,
      risk: skill.risk,
      autonomy: cfg.autonomy,
      roleAutoApprove: agent?.autoApproveUpTo ?? 'none',
      cleanPublishes: this.deps.db.work.countPublished(ctx.companyId),
      publishCleanThreshold: cfg.limits.publishCleanThreshold,
      postsToday: this.deps.db.work.sentToday(ctx.companyId, 'social', this.now()),
      postsPerDay: cfg.limits.postsPerDay,
      sendsToday: this.deps.db.work.sentToday(ctx.companyId, 'email', this.now()),
      emailsPerDay: cfg.limits.emailsPerDay,
      adChangeLimitPct: cfg.limits.adBudgetChangePct,
      adDailyCapUsd: cfg.limits.adDailyCapUsd,
      ...metrics,
    });
  }

  async invoke(
    ctx: SkillContext,
    skill: Skill,
    rawArgs: unknown,
    budget: { remainingCredits: number },
  ): Promise<InvokeOutcome> {
    const parsed = skill.schema.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      const detail = parsed.error.errors.map((e) => `${e.path.join('.') || 'args'}: ${e.message}`).join('; ');
      return { kind: 'invalid', content: `ERROR: invalid arguments for ${skill.toolName} — ${detail}` };
    }
    const args = parsed.data;

    if (!this.deps.registry.allowedFor(ctx.role, skill, ctx)) {
      const reason = `${skill.toolName} is not available to the ${ctx.role} role (not in its allowlist, channel disabled, or not connected)`;
      return { kind: 'denied', reason, content: `DENIED: ${reason}` };
    }

    if (skill.precondition) {
      const pre = await skill.precondition(ctx, args);
      if (!pre.ok) {
        return {
          kind: 'precondition_failed',
          reason: pre.reason,
          content: `NOT DONE — precondition failed: ${pre.reason}. Do not retry the same call.`,
        };
      }
    }

    const decision = await this.decide(ctx, skill, args);
    if (decision.gate === 'deny') {
      return { kind: 'denied', reason: decision.reason, content: `DENIED by policy: ${decision.reason}` };
    }
    const key = idempotencyKey(skill.key, ctx.companyId, args, ctx.runId ?? `adhoc:${ctx.cycleId ?? ''}`);

    if (decision.gate === 'approval' || decision.gate === 'objection_window') {
      return this.enqueue(ctx, skill, args, decision, key);
    }

    if (skill.costCredits > budget.remainingCredits) {
      return {
        kind: 'budget',
        content: `NOT DONE — ${skill.toolName} costs ${skill.costCredits} credits but only ${budget.remainingCredits.toFixed(1)} remain.`,
      };
    }
    const exec = await this.executeOnce(ctx, skill, args, key);
    return { kind: 'executed', ...exec };
  }

  /** Run a side effect at most once per idempotency key; record + meter it. */
  async executeOnce(
    ctx: SkillContext,
    skill: Skill,
    args: unknown,
    key: string,
  ): Promise<{ result: SkillResult; credits: number; replayed: boolean }> {
    const claim = this.deps.db.approvals.claimExecution(key, ctx.companyId, skill.key, LIMITS.executionStaleMs, this.now());
    if (!claim.claimed) {
      if (claim.record.status === 'succeeded') {
        let result: SkillResult = { ok: true, content: claim.record.result ?? '' };
        try {
          result = JSON.parse(claim.record.result ?? '') as SkillResult;
        } catch {
          // keep raw
        }
        return {
          result: { ...result, content: `(already done — recorded result) ${result.content}`, stateChange: false },
          credits: 0,
          replayed: true,
        };
      }
      return {
        result: { ok: false, content: 'This action is already executing — it will not be run twice.' },
        credits: 0,
        replayed: true,
      };
    }

    let result: SkillResult;
    try {
      result = await skill.execute(ctx, args, { idempotencyKey: key });
    } catch (err) {
      result = { ok: false, content: `ERROR: ${err instanceof Error ? err.message : String(err)}` };
    }
    // The ledger keeps a scrubbed copy (it doubles as the replayed result).
    const recorded = { ok: result.ok, content: scrubText(result.content, 20_000), stateChange: result.stateChange ?? false, empty: result.empty ?? false };
    this.deps.db.approvals.finishExecution(key, result.ok ? 'succeeded' : 'failed', JSON.stringify(recorded), this.now());

    let credits = 0;
    if (skill.costCredits > 0) {
      this.deps.db.billing.entry({
        companyId: ctx.companyId,
        delta: -skill.costCredits,
        reason: 'skill_spend',
        refType: 'skill',
        refId: key,
        note: skill.key,
        now: this.now(),
      });
      credits = skill.costCredits;
      if (!result.ok) {
        // Failed actions are refunded automatically (never bill for failures).
        this.deps.db.billing.entry({
          companyId: ctx.companyId,
          delta: skill.costCredits,
          reason: 'refund',
          refType: 'skill',
          refId: key,
          note: `refund: ${skill.key} failed`,
          now: this.now(),
        });
        credits = 0;
      }
    }
    if (skill.postRunLearn) {
      try {
        const proposals = skill.postRunLearn(ctx, args, result);
        if (proposals.length) this.deps.onLearn?.(ctx.companyId, proposals, { runId: ctx.runId, actionId: null });
      } catch {
        // learning hooks are best-effort
      }
    }
    return { result, credits, replayed: false };
  }

  private enqueue(
    ctx: SkillContext,
    skill: Skill,
    args: unknown,
    decision: GateDecision,
    key: string,
  ): InvokeOutcome {
    const preview = skill.preview(args);
    const now = this.now();
    const gate = decision.gate === 'objection_window' ? 'objection_window' : 'approval';
    const { row, created } = this.deps.db.approvals.create({
      companyId: ctx.companyId,
      cycleId: ctx.cycleId,
      runId: ctx.runId,
      taskId: ctx.taskId,
      role: ctx.role,
      skillKey: skill.key,
      category: skill.category,
      riskLevel: skill.risk,
      title: preview.title,
      summary: scrubText(preview.summary, 1_500),
      argsEnc: this.deps.vault.sealArgs(args),
      reason: decision.reason,
      gate,
      idempotencyKey: key,
      credits: skill.costCredits,
      executeAfter: gate === 'objection_window' ? now + OBJECTION_WINDOW_MS : null,
      now,
    });
    if (!created) {
      return {
        kind: 'queued',
        actionId: row.id,
        gate: decision.gate,
        reason: decision.reason,
        content: `Already queued as action ${row.id} (status: ${row.status}). Do not queue it again.`,
      };
    }
    if (ctx.taskId) {
      this.deps.db.work.updateTask(ctx.companyId, ctx.taskId, { status: 'awaiting_approval', approvalRequired: true }, now);
    }
    this.deps.db.ops.audit({
      companyId: ctx.companyId,
      actorType: 'agent',
      actorId: ctx.role,
      action: 'approval.requested',
      resourceType: 'pending_action',
      resourceId: row.id,
      metadata: { skill: skill.key, gate, reason: decision.reason },
      now,
    });
    this.deps.feed?.({
      companyId: ctx.companyId,
      cycleId: ctx.cycleId,
      runId: ctx.runId,
      role: ctx.role,
      kind: 'approval-requested',
      text: `${gate === 'objection_window' ? 'Will apply in 1h unless you object' : 'Needs approval'}: ${preview.title}`,
    });
    const when =
      gate === 'objection_window'
        ? 'It applies automatically in 1 hour unless the owner objects.'
        : 'It runs only if the owner approves.';
    return {
      kind: 'queued',
      actionId: row.id,
      gate: decision.gate,
      reason: decision.reason,
      content: `QUEUED for the owner as action ${row.id} (${decision.reason}). ${when} Do not call it again — continue with the rest of your task.`,
    };
  }

  // ── owner decisions ─────────────────────────────────────────────────────

  async approve(
    companyId: string,
    actionId: string,
    opts: { note?: string; actor?: string } = {},
  ): Promise<{ ok: boolean; status: PendingActionDto['status']; result?: string; error?: string }> {
    const row = this.deps.db.approvals.get(actionId, companyId);
    if (!row) return { ok: false, status: 'expired', error: 'unknown action' };
    if (row.status === 'executed') return { ok: true, status: 'executed', result: row.result ?? '' };
    const now = this.now();
    const actor = opts.actor ?? 'owner';
    const won = this.deps.db.approvals.transition(
      actionId,
      ['pending', 'failed'],
      'executing',
      { decidedBy: actor, decidedAt: now, decisionNote: opts.note ?? '' },
      now,
    );
    if (!won) {
      const current = this.deps.db.approvals.get(actionId, companyId)!;
      return { ok: false, status: current.status, error: `action is already ${current.status}` };
    }
    this.deps.db.ops.audit({
      companyId,
      actorType: actor === 'system' ? 'system' : 'user',
      actorId: actor,
      action: 'approval.approved',
      resourceType: 'pending_action',
      resourceId: actionId,
      metadata: { skill: row.skillKey, note: opts.note ?? '' },
      now,
    });
    this.deps.feed?.({
      companyId,
      cycleId: row.cycleId,
      runId: row.runId,
      role: row.role,
      kind: 'approval-decided',
      text: `${actor === 'system' ? 'Auto-applied (objection window elapsed)' : 'Approved'}: ${row.title}`,
    });
    return this.executeApproved(row);
  }

  private async executeApproved(
    row: PendingRow,
  ): Promise<{ ok: boolean; status: PendingActionDto['status']; result?: string; error?: string }> {
    const fail = (msg: string): { ok: false; status: 'failed'; error: string } => {
      this.deps.db.approvals.transition(row.id, ['executing'], 'failed', { result: scrubText(msg, 4_000) }, this.now());
      if (row.taskId) this.deps.db.work.updateTask(row.companyId, row.taskId, { status: 'failed', result: scrubText(msg, 2_000) }, this.now());
      this.deps.feed?.({
        companyId: row.companyId,
        cycleId: row.cycleId,
        runId: row.runId,
        role: row.role,
        kind: 'action-failed',
        text: `Failed: ${row.title} — ${msg}`.slice(0, 500),
      });
      return { ok: false, status: 'failed', error: msg };
    };

    const skill = this.deps.registry.get(row.skillKey);
    if (!skill) return fail(`skill ${row.skillKey} no longer exists`);
    let args: unknown;
    try {
      args = this.deps.vault.openArgs(row.argsEnc);
    } catch (err) {
      return fail(`could not decrypt the action: ${err instanceof Error ? err.message : String(err)}`);
    }
    const parsed = skill.schema.safeParse(args);
    if (!parsed.success) return fail('stored arguments no longer validate');
    const ctx = this.deps.makeContext({
      companyId: row.companyId,
      role: row.role,
      runId: row.runId,
      cycleId: row.cycleId,
      taskId: row.taskId,
    });
    if (!this.deps.registry.isAvailable(skill, ctx)) {
      return fail('the channel is disabled or its credential is missing — connect it and approve again');
    }
    if (skill.precondition) {
      const pre = await skill.precondition(ctx, parsed.data);
      if (!pre.ok) return fail(`precondition failed at execution time: ${pre.reason}`);
    }

    const exec = await this.executeOnce(ctx, skill, parsed.data, row.idempotencyKey);
    const now = this.now();
    if (exec.result.ok) {
      this.deps.db.approvals.transition(row.id, ['executing'], 'executed', { result: scrubText(exec.result.content, 8_000) }, now);
      if (row.taskId) {
        this.deps.db.work.updateTask(row.companyId, row.taskId, { status: 'done', completedAt: now, result: scrubText(exec.result.content, 2_000) }, now);
      }
      this.deps.feed?.({
        companyId: row.companyId,
        cycleId: row.cycleId,
        runId: row.runId,
        role: row.role,
        kind: 'action-executed',
        text: `Executed: ${row.title}`,
      });
      return { ok: true, status: 'executed', result: exec.result.content };
    }
    return fail(exec.result.content.replace(/^ERROR:\s*/, ''));
  }

  reject(
    companyId: string,
    actionId: string,
    reason: string,
    actor = 'owner',
  ): { ok: boolean; error?: string } {
    const row = this.deps.db.approvals.get(actionId, companyId);
    if (!row) return { ok: false, error: 'unknown action' };
    const now = this.now();
    const won = this.deps.db.approvals.transition(
      actionId,
      ['pending', 'failed'],
      'rejected',
      { decidedBy: actor, decidedAt: now, decisionNote: reason },
      now,
    );
    if (!won) return { ok: false, error: `action is already ${this.deps.db.approvals.get(actionId, companyId)?.status}` };
    if (row.taskId) {
      this.deps.db.work.updateTask(companyId, row.taskId, { status: 'rejected', rejectedReason: reason }, now);
    }
    this.deps.db.ops.audit({
      companyId,
      actorType: 'user',
      actorId: actor,
      action: 'approval.rejected',
      resourceType: 'pending_action',
      resourceId: actionId,
      metadata: { skill: row.skillKey, reason },
      now,
    });
    this.deps.feed?.({
      companyId,
      cycleId: row.cycleId,
      runId: row.runId,
      role: row.role,
      kind: 'approval-decided',
      text: `Rejected: ${row.title}${reason ? ` — ${reason}` : ''}`.slice(0, 500),
    });
    this.deps.onRejected?.(toPendingDto({ ...row, status: 'rejected', decisionNote: reason }), reason);
    return { ok: true };
  }

  /** Apply objection-window actions whose hour has passed. */
  async sweepObjectionWindows(): Promise<number> {
    let n = 0;
    for (const row of this.deps.db.approvals.dueObjectionWindow(this.now())) {
      const res = await this.approve(row.companyId, row.id, { actor: 'system', note: 'objection window elapsed' });
      if (res.ok) n += 1;
    }
    return n;
  }

  detail(companyId: string, actionId: string): PendingActionDetailDto | null {
    const row = this.deps.db.approvals.get(actionId, companyId);
    if (!row) return null;
    const skill = this.deps.registry.get(row.skillKey);
    let args: unknown = null;
    try {
      args = this.deps.vault.openArgs(row.argsEnc);
    } catch {
      args = { error: 'could not decrypt (keychain unavailable?)' };
    }
    return {
      ...toPendingDto(row),
      args,
      rubric: skill?.rubric ?? [],
      skillName: skill?.name ?? row.skillKey,
    };
  }
}
