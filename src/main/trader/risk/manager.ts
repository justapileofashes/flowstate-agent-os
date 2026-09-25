// RiskManager: a deterministic boolean gate over composable RiskRule plugins.
// Every rule runs (so the audit shows every reason, not just the first); any
// failure blocks. Adjustments only ever reduce risk: sizes can shrink, stops
// are recalibrated within configured bounds. It never learns.

import type { RiskDecisionDto, RiskRuleResultDto } from '@shared/trader/types';
import type { SignalProposal } from '../types';
import { defaultRules, type DraftOrder, type RiskContext, type RiskRule } from './rules';

export interface RiskDecision extends RiskDecisionDto {
  tripBreaker: boolean;
}

export class RiskManager {
  constructor(private readonly rules: RiskRule[] = defaultRules()) {}

  get ruleNames(): string[] {
    return this.rules.map((r) => r.name);
  }

  evaluate(p: SignalProposal, ctx: RiskContext): RiskDecision {
    const draft: DraftOrder = { size: p.requestedSize ?? 0, stop: p.stop, takeProfit: p.takeProfit };
    const results: RiskRuleResultDto[] = [];
    let tripBreaker = false;
    for (const rule of this.rules) {
      let outcome;
      try {
        outcome = rule.evaluate(p, { ...draft }, ctx);
      } catch (err) {
        // A crashing rule is a block, never a pass.
        outcome = { passed: false, reason: `rule error: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (outcome.tripBreaker) tripBreaker = true;
      if (outcome.passed && outcome.adjust) {
        const a = outcome.adjust;
        if (a.size !== undefined) draft.size = draft.size > 0 && rule.name !== 'FixedFractionalRule' ? Math.min(draft.size, a.size) : a.size;
        if (a.stop !== undefined) draft.stop = a.stop;
        if (a.takeProfit !== undefined) draft.takeProfit = a.takeProfit;
      }
      results.push({ rule: rule.name, passed: outcome.passed, reason: outcome.reason, ...(outcome.adjust ? { adjust: outcome.adjust } : {}) });
    }
    const failed = results.filter((r) => !r.passed);
    const allowed = failed.length === 0 && draft.size > 0;
    return {
      allowed,
      reason: allowed
        ? `approved ${draft.size} ${p.symbol} @ ~${p.entry.toFixed(2)} (stop ${draft.stop.toFixed(2)}, TP ${draft.takeProfit.toFixed(2)})`
        : failed.map((r) => `${r.rule}: ${r.reason}`).join(' | ') || 'size is zero',
      suggestedSize: allowed ? draft.size : 0,
      suggestedStop: draft.stop,
      suggestedTakeProfit: draft.takeProfit,
      results,
      tripBreaker,
    };
  }
}
