// The canonical agent loop (spec §4), implemented once and reused by every
// role: PERCEIVE (context is assembled by the caller) → REASON/PLAN (model
// call with the role's skills as tools) → ACT (every call goes through the
// ActionGate) → OBSERVE (progress + goal check). Stopping is enforced here,
// server-side, never left to the model:
//   max_iterations · credit/USD caps (run + cycle) · no_progress ·
//   wall-clock timeout · a separate cheap-model goal-achievement check.
// Each phase writes a redacted run_step, so every run is replayable.

import { createHash } from 'node:crypto';
import type { ConversationMessage, ToolSpec } from '@main/agent/types';
import type { ModelAlias, RoleKey, StopReason } from '@shared/business/types';
import type { NewStep } from '../db/runs';
import type { ActionGate, InvokeOutcome } from '../guardrails/approval';
import { scrubJson, scrubText } from '../guardrails/scrub';
import type { GatewayChatRequest, GatewayChatResult } from '../providers/gateway';
import { extractJsonObject } from '../providers/gateway';
import { SkillRegistry } from '../skills/registry';
import type { Skill, SkillContext } from '../skills/types';
import { LIMITS } from '../config';
import { canonicalJson } from '../guardrails/approval';

export interface LoopLimits {
  maxIterations: number;
  creditCap: number;
  /** 0 = no USD cap for this run. */
  usdCap: number;
  wallClockMs: number;
  noProgressWindow: number;
}

export interface LoopInput {
  companyId: string;
  cycleId: string | null;
  runId: string;
  taskId: string | null;
  role: RoleKey;
  alias: ModelAlias;
  systemPrompt: string;
  userPrompt: string;
  goal: string;
  skills: Skill[];
  ctx: SkillContext;
  limits: LoopLimits;
  signal?: AbortSignal;
  /** Cycle-level budget: remaining credits across all runs (Infinity if none). */
  cycleRemaining?: () => { credits: number; usd: number };
  /** Incremental spend; 'skill' credits are already in the ledger (ActionGate). */
  onSpend?: (credits: number, usd: number, source: 'llm' | 'skill') => void;
  onTool?: (toolName: string) => void;
  /** Skip the goal check (e.g. chat replies). */
  goalCheck?: boolean;
}

export interface LoopDeps {
  gateway: { chat(req: GatewayChatRequest): Promise<GatewayChatResult> };
  gate: Pick<ActionGate, 'invoke'>;
  trace: (step: NewStep) => void;
  now?: () => number;
}

export interface LoopOutcome {
  stopReason: StopReason;
  output: string;
  iterations: number;
  credits: number;
  usd: number;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  queuedActions: string[];
  executed: Array<{ skill: string; ok: boolean }>;
  error?: string;
}

const HISTORY_CHAR_BUDGET = 60_000;
const TOOL_BLOCK_RE = /```tool[\s\S]*?```/g;

function sig(name: string, args: unknown, content: string): string {
  return createHash('sha1').update(`${name}|${canonicalJson(args)}|${content.slice(0, 800)}`).digest('hex');
}

/** Shrink the oldest tool results when the transcript gets too long. */
export function compactHistory(messages: ConversationMessage[], budget = HISTORY_CHAR_BUDGET): void {
  let total = messages.reduce((s, m) => s + m.content.length, 0);
  if (total <= budget) return;
  // Leave the last 4 messages intact.
  for (let i = 0; i < messages.length - 4 && total > budget; i++) {
    const m = messages[i]!;
    if (m.role !== 'tool' || m.content.length <= 600) continue;
    const before = m.content.length;
    m.content = `${m.content.slice(0, 500)}…[older result compacted]`;
    total -= before - m.content.length;
  }
}

export async function runLoop(deps: LoopDeps, input: LoopInput): Promise<LoopOutcome> {
  const now = deps.now ?? Date.now;
  const started = now();
  const deadline = started + input.limits.wallClockMs;
  const toolSpecs: ToolSpec[] = SkillRegistry.toolSpecs(input.skills);
  const byTool = new Map(input.skills.map((s) => [s.toolName, s]));
  const messages: ConversationMessage[] = [
    { role: 'system', content: input.systemPrompt },
    { role: 'user', content: input.userPrompt },
  ];
  const out: LoopOutcome = {
    stopReason: 'error',
    output: '',
    iterations: 0,
    credits: 0,
    usd: 0,
    tokensIn: 0,
    tokensOut: 0,
    toolCalls: 0,
    queuedActions: [],
    executed: [],
  };
  const seen = new Set<string>();
  const progressLog: boolean[] = [];
  let nudged = false;

  const spend = (credits: number, usd: number, source: 'llm' | 'skill' = 'llm'): void => {
    out.credits += credits;
    out.usd += usd;
    input.onSpend?.(credits, usd, source);
  };
  const remainingCredits = (): number => {
    const run = input.limits.creditCap - out.credits;
    const cyc = input.cycleRemaining ? input.cycleRemaining().credits : Infinity;
    return Math.max(0, Math.min(run, cyc));
  };
  const budgetExhausted = (): boolean => {
    if (remainingCredits() <= 0) return true;
    if (input.limits.usdCap > 0 && out.usd >= input.limits.usdCap) return true;
    const cyc = input.cycleRemaining?.();
    return Boolean(cyc && cyc.usd <= 0);
  };
  const stop = (reason: StopReason, detail?: string): LoopOutcome => {
    out.stopReason = reason;
    out.output = out.output.replace(TOOL_BLOCK_RE, '').trim();
    if (detail && reason === 'error') out.error = detail;
    deps.trace({
      phase: 'stop',
      stepKind: 'note',
      iteration: out.iterations,
      content: scrubText(`stopped: ${reason}${detail ? ` — ${detail}` : ''}`, 500),
      credits: 0,
    });
    return out;
  };

  deps.trace({
    phase: 'perceive',
    stepKind: 'note',
    iteration: 0,
    promptSnippet: scrubText(`${input.systemPrompt}\n---\n${input.userPrompt}`, LIMITS.promptSnippetChars),
    content: scrubText(
      `goal: ${input.goal}\nskills: ${input.skills.map((s) => s.toolName).join(', ') || '(none)'}\nlimits: ${input.limits.maxIterations} iterations, ${input.limits.creditCap} credits`,
      LIMITS.stepContentChars,
    ),
  });

  for (;;) {
    if (input.signal?.aborted) return stop('aborted');
    if (now() > deadline) return stop('timeout');
    if (out.iterations >= input.limits.maxIterations) return stop('max_iterations');
    if (budgetExhausted()) return stop('budget_exhausted');
    out.iterations += 1;
    const iteration = out.iterations;

    // ── REASON + PLAN ───────────────────────────────────────────────────
    compactHistory(messages);
    const t0 = now();
    let res: GatewayChatResult;
    try {
      res = await deps.gateway.chat({
        alias: input.alias,
        companyId: input.companyId,
        messages,
        tools: toolSpecs,
        ...(input.signal ? { signal: input.signal } : {}),
        meta: { cycleId: input.cycleId, runId: input.runId, role: input.role },
      });
    } catch (err) {
      if (input.signal?.aborted) return stop('aborted');
      return stop('error', err instanceof Error ? err.message : String(err));
    }
    spend(res.usage.credits, res.usage.costUsd);
    out.tokensIn += res.usage.inputTokens;
    out.tokensOut += res.usage.outputTokens;
    const lastMsg = messages[messages.length - 1];
    deps.trace({
      phase: 'reason',
      stepKind: 'llm',
      iteration,
      promptSnippet: lastMsg ? scrubText(lastMsg.content, LIMITS.promptSnippetChars) : null,
      content: scrubText(
        res.text || (res.toolCalls.length ? `(calls ${res.toolCalls.map((c) => c.name).join(', ')})` : '(empty reply)'),
        LIMITS.stepContentChars,
      ),
      model: res.model,
      tokensIn: res.usage.inputTokens,
      tokensOut: res.usage.outputTokens,
      costUsd: res.usage.costUsd,
      credits: res.usage.credits,
      durationMs: now() - t0,
      ok: true,
    });
    if (res.text.trim()) out.output = res.text.trim();

    // ── no tool calls: the agent thinks it's done → OBSERVE via goal check
    if (res.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: res.text });
      if (input.goalCheck === false) return stop('agent_done_unverified');
      const verdict = await checkGoal(deps, input, res.text, out, spend);
      if (verdict === null) return stop('agent_done_unverified');
      if (verdict.achieved) return stop('goal_achieved');
      if (!nudged && out.iterations < input.limits.maxIterations && !budgetExhausted()) {
        nudged = true;
        messages.push({
          role: 'user',
          content: `A reviewer says the goal is not met yet: ${verdict.reason}\nContinue the work with your tools, or state plainly what is blocking you.`,
        });
        continue;
      }
      return stop('agent_done_unverified');
    }

    // ── ACT ─────────────────────────────────────────────────────────────
    messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });
    let progressed = false;
    let hitBudget = false;
    for (const call of res.toolCalls) {
      out.toolCalls += 1;
      input.onTool?.(call.name);
      const skill = byTool.get(call.name);
      const t1 = now();
      let content: string;
      let ok = false;
      let outcome: InvokeOutcome | null = null;
      if (!skill) {
        content = `ERROR: unknown tool "${call.name}". Available: ${[...byTool.keys()].join(', ') || 'none'}.`;
      } else {
        outcome = await deps.gate.invoke(input.ctx, skill, call.args, { remainingCredits: remainingCredits() });
        switch (outcome.kind) {
          case 'executed': {
            const r = outcome.result;
            ok = r.ok;
            content = r.content;
            spend(outcome.credits, 0, 'skill');
            out.executed.push({ skill: skill.key, ok: r.ok });
            if (r.ok && (r.stateChange || (!r.empty && !outcome.replayed))) progressed = true;
            break;
          }
          case 'queued':
            ok = true;
            content = outcome.content;
            if (!out.queuedActions.includes(outcome.actionId)) {
              out.queuedActions.push(outcome.actionId);
              progressed = true;
            }
            break;
          case 'budget':
            content = outcome.content;
            hitBudget = true;
            break;
          default:
            content = outcome.content;
        }
      }
      const s = sig(call.name, call.args, content);
      const fresh = !seen.has(s);
      seen.add(s);
      if (!fresh && outcome?.kind === 'executed') {
        content = `${content}\n(Note: identical to an earlier result — try something different or finish.)`;
      }
      deps.trace({
        phase: 'act',
        stepKind: outcome?.kind === 'queued' ? 'approval' : outcome && outcome.kind !== 'executed' ? 'guardrail' : 'tool',
        iteration,
        toolName: call.name,
        toolArgsRedacted: scrubJson(call.args, LIMITS.stepResultChars),
        toolResultRedacted: scrubText(content, LIMITS.stepResultChars),
        ok,
        durationMs: now() - t1,
        credits: outcome?.kind === 'executed' ? outcome.credits : 0,
        content: outcome ? `${outcome.kind}${'reason' in outcome ? `: ${outcome.reason}` : ''}` : 'unknown tool',
      });
      const forModel =
        content.length > LIMITS.toolResultForModelChars
          ? `${content.slice(0, LIMITS.toolResultForModelChars)}…[truncated]`
          : content;
      messages.push({ role: 'tool', content: forModel, toolCallId: call.id, toolName: call.name });
      if (hitBudget) break;
    }

    // ── OBSERVE ─────────────────────────────────────────────────────────
    progressLog.push(progressed);
    deps.trace({
      phase: 'observe',
      stepKind: 'note',
      iteration,
      content: progressed ? 'progress: new results or state change' : 'no new results this iteration',
    });
    if (hitBudget) return stop('budget_exhausted');
    const window = input.limits.noProgressWindow;
    if (progressLog.length >= window && progressLog.slice(-window).every((p) => !p)) {
      return stop('no_progress');
    }
  }
}

/** Separate small-model pass: did the work achieve the goal? null = unknown. */
async function checkGoal(
  deps: LoopDeps,
  input: LoopInput,
  finalText: string,
  out: LoopOutcome,
  spend: (credits: number, usd: number) => void,
): Promise<{ achieved: boolean; reason: string } | null> {
  const t0 = (deps.now ?? Date.now)();
  const actions = [
    ...out.executed.map((e) => `${e.skill}: ${e.ok ? 'ok' : 'failed'}`),
    ...out.queuedActions.map((id) => `queued for approval: ${id}`),
  ];
  try {
    const res = await deps.gateway.chat({
      alias: 'cheap',
      companyId: input.companyId,
      json: true,
      messages: [
        {
          role: 'system',
          content:
            'You are a strict reviewer. Decide if the work achieves the goal. Queuing an action for owner approval counts as done for that action. Reply with JSON only.',
        },
        {
          role: 'user',
          content: `GOAL:\n${input.goal}\n\nACTIONS TAKEN:\n${actions.join('\n') || '(none)'}\n\nFINAL MESSAGE:\n${finalText.slice(0, 4_000)}\n\nReply exactly: {"achieved": true|false, "reason": "<one sentence>"}`,
        },
      ],
      meta: { cycleId: input.cycleId, runId: input.runId, role: input.role },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    spend(res.usage.credits, res.usage.costUsd);
    out.tokensIn += res.usage.inputTokens;
    out.tokensOut += res.usage.outputTokens;
    const parsed = extractJsonObject(res.text) as { achieved?: unknown; reason?: unknown } | null;
    const verdict =
      parsed && typeof parsed.achieved === 'boolean'
        ? { achieved: parsed.achieved, reason: String(parsed.reason ?? '').slice(0, 300) }
        : null;
    deps.trace({
      phase: 'observe',
      stepKind: 'goal_check',
      iteration: out.iterations,
      content: verdict ? `${verdict.achieved ? 'achieved' : 'not achieved'}: ${verdict.reason}` : 'goal check: unparseable verdict',
      model: res.model,
      tokensIn: res.usage.inputTokens,
      tokensOut: res.usage.outputTokens,
      costUsd: res.usage.costUsd,
      credits: res.usage.credits,
      durationMs: (deps.now ?? Date.now)() - t0,
      ok: verdict !== null,
    });
    return verdict;
  } catch (err) {
    deps.trace({
      phase: 'observe',
      stepKind: 'goal_check',
      iteration: out.iterations,
      content: scrubText(`goal check unavailable: ${err instanceof Error ? err.message : String(err)}`, 400),
      ok: false,
    });
    return null;
  }
}
