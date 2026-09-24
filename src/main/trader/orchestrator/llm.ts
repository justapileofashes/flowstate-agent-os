// The LLM's whole job in the trader: write human-readable rationale and,
// when enabled, act as a risk reviewer that can only VETO. It never sees an
// order endpoint. Calls go through the app's ModelGateway (retries, circuit
// breaker, failover, cost accounting) with a hard per-tick budget, a timeout,
// and a reasoning cache reused on retries.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LLMProvider } from '@main/agent/llm-provider';
import { ModelGateway, extractJsonObject } from '@main/business/providers/gateway';
import type { TraderConfig } from '@shared/trader/types';
import type { SignalProposal } from '../types';
import type { RiskDecision } from '../risk/manager';

export interface LlmDeps {
  provider: LLMProvider;
  config: () => TraderConfig;
  fallbackModels: () => string[];
  now: () => number;
  onUsage?: (u: { model: string; inputTokens: number; outputTokens: number; costUsd: number; ok: boolean; latencyMs: number }) => void;
}

export interface LlmCall {
  model: string;
  prompt: string;
  reply: string;
  ms: number;
}

export class LlmBudgetExceeded extends Error {}

const vetoSchema = z.object({ veto: z.boolean(), reason: z.string().max(1000).default('') });

export class TraderLlm {
  private readonly gateway: ModelGateway;
  private readonly cache = new Map<string, string>();
  private used = 0;

  constructor(private readonly deps: LlmDeps) {
    this.gateway = new ModelGateway({
      provider: deps.provider,
      resolveModel: () => deps.config().llm.model,
      fallbackModels: () => deps.fallbackModels(),
      onUsage: (e) => deps.onUsage?.({ model: e.model, inputTokens: e.inputTokens, outputTokens: e.outputTokens, costUsd: e.costUsd, ok: e.ok, latencyMs: e.latencyMs }),
      now: deps.now,
    });
  }

  /** Start a new tick's budget. */
  resetBudget(): void {
    this.used = 0;
  }

  get callsThisTick(): number {
    return this.used;
  }

  enabled(): boolean {
    const c = this.deps.config().llm;
    return c.enabled && c.maxCallsPerTick > 0 && (Boolean(c.model) || this.deps.fallbackModels().length > 0);
  }

  remaining(): number {
    return Math.max(0, this.deps.config().llm.maxCallsPerTick - this.used);
  }

  private async call(system: string, user: string, json: boolean): Promise<LlmCall> {
    if (this.remaining() <= 0) throw new LlmBudgetExceeded('LLM call budget for this tick is spent');
    this.used += 1;
    const cfg = this.deps.config().llm;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    const started = this.deps.now();
    try {
      const res = await this.gateway.chat({
        alias: 'cheap',
        companyId: 'trader',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        json,
        signal: ac.signal,
        meta: { role: 'trader' },
      });
      return { model: res.model, prompt: user, reply: res.text, ms: this.deps.now() - started };
    } finally {
      clearTimeout(timer);
    }
  }

  private static key(p: SignalProposal): string {
    return createHash('sha256')
      .update(`${p.symbol}|${p.side}|${p.barTs}|${p.confidence.toFixed(3)}|${p.modelVersion}`)
      .digest('hex');
  }

  /** One LLM call per signal (within budget); cached; null → caller uses the template. */
  async rationale(p: SignalProposal, decision: RiskDecision | null): Promise<{ text: string; call: LlmCall | null } | null> {
    const k = TraderLlm.key(p);
    const cached = this.cache.get(k);
    if (cached) return { text: cached, call: null };
    if (!this.enabled() || !this.deps.config().llm.rationale || this.remaining() <= 0) return null;
    const facts = {
      symbol: p.symbol,
      side: p.side,
      confidence: Number(p.confidence.toFixed(3)),
      horizonMinutes: p.horizonMin,
      expectedEdgePct: Number(p.edgePct.toFixed(3)),
      regime: p.regime,
      perTimeframe: p.perTimeframe,
      topDrivers: p.drivers,
      entry: Number(p.entry.toFixed(2)),
      stop: Number((decision?.suggestedStop ?? p.stop).toFixed(2)),
      takeProfit: Number((decision?.suggestedTakeProfit ?? p.takeProfit).toFixed(2)),
      strategy: p.strategyName,
      riskVerdict: decision ? (decision.allowed ? 'approved' : `rejected: ${decision.reason.slice(0, 300)}`) : 'not evaluated',
    };
    try {
      const call = await this.call(
        'You explain algorithmic trade signals to the account owner. Write 2–3 plain sentences: why the model likes this trade (cite the drivers and timeframes), the key risk, and what would invalidate it. Use only the facts given. No hype, no promises, no advice to change the numbers.',
        JSON.stringify(facts),
        false,
      );
      const text = call.reply.trim().replace(/\s+/g, ' ').slice(0, 800);
      if (!text) return null;
      this.cache.set(k, text);
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      return { text, call };
    } catch {
      return null; // rationale is text, not a decision — the template covers it
    }
  }

  /**
   * Optional LLM risk officer. It can only veto. Its reply MUST parse as
   * {"veto": boolean, "reason": string}; anything else throws, which aborts
   * the tick (spec: parsing failure → no trade).
   */
  async reviewRisk(p: SignalProposal, decision: RiskDecision): Promise<{ veto: boolean; reason: string; call: LlmCall }> {
    const call = await this.call(
      'You are an independent risk officer reviewing one proposed trade that already passed deterministic risk limits. You may VETO it for a documented reason (e.g. regime conflict, event risk, poor reward/risk). You cannot change size or prices. Reply with ONLY a JSON object: {"veto": true|false, "reason": "<one sentence>"}.',
      JSON.stringify({
        symbol: p.symbol,
        side: p.side,
        confidence: p.confidence,
        edgePct: p.edgePct,
        regime: p.regime,
        drivers: p.drivers,
        perTimeframe: p.perTimeframe,
        size: decision.suggestedSize,
        entry: p.entry,
        stop: decision.suggestedStop,
        takeProfit: decision.suggestedTakeProfit,
        riskChecks: decision.results.map((r) => `${r.rule}: ${r.reason}`),
      }),
      true,
    );
    const parsed = vetoSchema.safeParse(extractJsonObject(call.reply));
    if (!parsed.success) throw new Error(`risk review reply was not valid JSON ({veto, reason}): ${call.reply.slice(0, 200)}`);
    return { veto: parsed.data.veto, reason: parsed.data.reason, call };
  }
}
