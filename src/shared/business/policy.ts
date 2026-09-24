// Approval-gate matrix (spec §10.1). Pure decision over the skill's declared
// category + risk and the company's policy/counters — never over anything the
// model claims. Shared so the UI can explain why an action is waiting.

import type { ActionCategory, AutoApproveLevel, AutonomyTier, RiskLevel } from './types';

export type Gate = 'none' | 'approval' | 'objection_window' | 'deny';

export interface GateInput {
  category: ActionCategory;
  risk: RiskLevel;
  autonomy: AutonomyTier;
  /** Per-role ceiling (agent_configs.auto_approve_up_to). */
  roleAutoApprove: AutoApproveLevel;
  /** Successful publishes so far (for the "N clean publishes" rule). */
  cleanPublishes?: number;
  publishCleanThreshold?: number;
  postsToday?: number;
  postsPerDay?: number;
  sendsToday?: number;
  emailsPerDay?: number;
  /** |new - current| / current * 100, computed server-side from a real read. */
  adChangePct?: number;
  adChangeLimitPct?: number;
  adNewDailyUsd?: number;
  adDailyCapUsd?: number;
}

export interface GateDecision {
  gate: Gate;
  reason: string;
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };
const AUTO_ORDER: Record<AutoApproveLevel, number> = { none: -1, low: 0, medium: 1 };

/** True when the role is allowed to auto-approve an action of this risk. */
export function roleMayAutoApprove(level: AutoApproveLevel, risk: RiskLevel): boolean {
  return AUTO_ORDER[level] >= RISK_ORDER[risk];
}

export function riskAtLeast(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

/** Categories that always require a human, whatever the tier (not configurable). */
export const ALWAYS_APPROVE: ReadonlySet<ActionCategory> = new Set<ActionCategory>([
  'deploy',
  'pricing',
  'refund',
  'validation',
]);

export const NO_GATE: ReadonlySet<ActionCategory> = new Set<ActionCategory>([
  'read',
  'draft',
  'internal',
]);

export function decideGate(i: GateInput): GateDecision {
  if (NO_GATE.has(i.category)) {
    return { gate: 'none', reason: `${i.category} actions never need approval` };
  }
  if (ALWAYS_APPROVE.has(i.category)) {
    return { gate: 'approval', reason: `${i.category} always requires the owner's approval` };
  }
  // Belt and braces: anything a skill marks high-risk needs a human.
  if (i.risk === 'high') {
    return { gate: 'approval', reason: 'high-risk actions always require approval' };
  }

  const tierAllows = i.autonomy !== 'safe';
  const roleAllows = roleMayAutoApprove(i.roleAutoApprove, i.risk);

  switch (i.category) {
    case 'publish': {
      const cap = i.postsPerDay ?? Infinity;
      if ((i.postsToday ?? 0) >= cap) {
        return { gate: 'deny', reason: `daily post limit reached (${i.postsToday}/${cap})` };
      }
      const clean = i.cleanPublishes ?? 0;
      const need = i.publishCleanThreshold ?? 5;
      if (tierAllows && roleAllows && clean >= need) {
        return { gate: 'none', reason: `auto-approved: ${clean} clean publishes ≥ ${need}` };
      }
      return {
        gate: 'approval',
        reason:
          clean < need
            ? `publishing needs approval until ${need} clean publishes (${clean} so far)`
            : 'publishing needs approval at this autonomy level',
      };
    }
    case 'outbound': {
      const cap = i.emailsPerDay ?? Infinity;
      if ((i.sendsToday ?? 0) >= cap) {
        return { gate: 'deny', reason: `daily send limit reached (${i.sendsToday}/${cap})` };
      }
      if (i.autonomy === 'autonomous' && roleAllows) {
        return { gate: 'none', reason: 'auto-approved: autonomous tier, within daily send cap' };
      }
      return { gate: 'approval', reason: 'outbound messages need approval by default' };
    }
    case 'ad_budget': {
      const cap = i.adDailyCapUsd ?? Infinity;
      if ((i.adNewDailyUsd ?? 0) > cap) {
        return {
          gate: 'deny',
          reason: `new daily budget $${i.adNewDailyUsd} exceeds the hard cap $${cap}`,
        };
      }
      const limit = i.adChangeLimitPct ?? 10;
      const change = i.adChangePct ?? Infinity;
      if (tierAllows && roleAllows && Math.abs(change) <= limit) {
        return { gate: 'none', reason: `auto-approved: change ${change.toFixed(1)}% within ±${limit}%` };
      }
      return {
        gate: 'approval',
        reason: Number.isFinite(change)
          ? `budget change ${change.toFixed(1)}% needs approval (auto limit ±${limit}%)`
          : 'budget change needs approval',
      };
    }
    case 'external_write': {
      if (tierAllows && roleAllows) {
        return { gate: 'none', reason: 'auto-approved: bounded write to an owner system' };
      }
      return { gate: 'approval', reason: 'writes to connected systems need approval in safe mode' };
    }
    case 'config_edit': {
      if (tierAllows) {
        return { gate: 'objection_window', reason: 'config edits apply after a 1h objection window' };
      }
      return { gate: 'approval', reason: 'config edits need approval in safe mode' };
    }
    default:
      return { gate: 'approval', reason: 'unclassified action — approval required' };
  }
}

export const OBJECTION_WINDOW_MS = 60 * 60_000;

/** Human-readable matrix rows for the settings screen. */
export const APPROVAL_MATRIX_ROWS: Array<{
  category: ActionCategory;
  label: string;
  risk: RiskLevel;
  defaultGate: string;
  configurable: boolean;
}> = [
  { category: 'read', label: 'Read-only (analytics, revenue, inbox, web search)', risk: 'low', defaultGate: 'none', configurable: false },
  { category: 'draft', label: 'Draft content saved for review', risk: 'low', defaultGate: 'none', configurable: true },
  { category: 'publish', label: 'Publish a draft to a channel', risk: 'medium', defaultGate: 'approval until N clean publishes', configurable: true },
  { category: 'outbound', label: 'Outbound email to prospects', risk: 'medium', defaultGate: 'approval (daily send cap)', configurable: true },
  { category: 'ad_budget', label: 'Change ad budgets', risk: 'medium', defaultGate: 'approval above ±N% (hard daily cap)', configurable: true },
  { category: 'external_write', label: 'Write to CRM / connected systems', risk: 'medium', defaultGate: 'approval in safe mode', configurable: true },
  { category: 'config_edit', label: 'Edit company config (mission/voice/ICP)', risk: 'medium', defaultGate: 'approval, or 1h objection window', configurable: true },
  { category: 'validation', label: 'Mark the idea validated', risk: 'high', defaultGate: 'always approval', configurable: false },
  { category: 'deploy', label: 'Deploy code', risk: 'high', defaultGate: 'always approval', configurable: false },
  { category: 'pricing', label: 'Change prices / pricing claims', risk: 'high', defaultGate: 'always approval', configurable: false },
  { category: 'refund', label: 'Refunds / compensation', risk: 'high', defaultGate: 'always approval', configurable: false },
];
