// The nine roles (spec §5). Each role is one loop configuration: a narrow
// system prompt, a bounded skill allowlist, a model tier (alias), and
// defaults for iterations / credit cap. Per-company overrides live in
// biz_agent_configs; the allowlist here is the hard upper bound.

import type { ModelAlias, RoleKey } from '@shared/business/types';
import { LIMITS } from '../config';
import type { AgentConfigSeed } from '../db/companies';

export interface RoleDef {
  key: RoleKey;
  label: string;
  glyph: string;
  responsibility: string;
  modelAlias: ModelAlias;
  skills: string[];
  maxIterations: number;
  costCapCredits: number;
  prompt: string;
  /** Roles that "build" — blocked while the validation gate is pending. */
  buildsProduct: boolean;
}

export const ROLES: Record<RoleKey, RoleDef> = {
  ceo: {
    key: 'ceo',
    label: 'CEO / Orchestrator',
    glyph: 'CE',
    responsibility: 'Reads state, writes the daily plan, dispatches roles, summarizes.',
    modelAlias: 'planner',
    skills: [
      'knowledge.search',
      'knowledge.save',
      'tasks.create',
      'draft.save',
      'tickets.list',
      'stripe.reconcile',
      'web.search',
      'config.propose_change',
      'pricing.propose_change',
    ],
    maxIterations: LIMITS.ceoMaxIterations,
    costCapCredits: 60,
    buildsProduct: false,
    prompt:
      'You are the CEO of this company, working for its owner. You plan, delegate, and report honestly. ' +
      'You never take irreversible actions yourself: anything that sends, spends, deploys, or changes prices goes ' +
      "through skills that route it to the owner's approval queue. You ground every claim in data you have read.",
  },
  researcher: {
    key: 'researcher',
    label: 'Researcher',
    glyph: 'RS',
    responsibility: 'Market, competitors, pricing intel, demand signals, idea validation.',
    modelAlias: 'cheap',
    skills: ['web.search', 'web.browse', 'knowledge.search', 'knowledge.save', 'validation.submit'],
    maxIterations: LIMITS.defaultMaxIterations,
    costCapCredits: 50,
    buildsProduct: false,
    prompt:
      'You are the researcher. You find real evidence on the web — competitors, pricing, customer language, demand ' +
      'signals — and save durable findings with knowledge_save (one finding per call, with the source URL). ' +
      'Cite sources. Never invent numbers. When asked to validate the idea, produce a problem/competitor/demand ' +
      'summary and submit it with validation_submit.',
  },
  planner: {
    key: 'planner',
    label: 'Planner',
    glyph: 'PL',
    responsibility: 'Turns strategy into a prioritized roadmap of concrete tasks.',
    modelAlias: 'planner',
    skills: ['knowledge.search', 'tasks.create', 'web.search'],
    maxIterations: 6,
    costCapCredits: 30,
    buildsProduct: false,
    prompt:
      'You are the planner. Convert goals and findings into a short, prioritized roadmap. Create each roadmap item ' +
      'with tasks_create — concrete, assigned to exactly one role, with a realistic credit estimate. Prefer fewer, ' +
      'sharper tasks over long lists.',
  },
  coder: {
    key: 'coder',
    label: 'Coder',
    glyph: 'CD',
    responsibility: 'Feature specs to PRs, bug fixes, landing-page edits.',
    modelAlias: 'coding',
    skills: ['web.browse', 'knowledge.search', 'draft.save', 'code.run_js', 'github.open_pr', 'deploy.trigger'],
    maxIterations: LIMITS.defaultMaxIterations,
    costCapCredits: 80,
    buildsProduct: true,
    prompt:
      'You are the engineer. Write small, reviewable changes. Save a spec with draft_save (kind "spec") first, ' +
      "verify logic with code_run_js where useful, then open a pull request on the owner's repository with " +
      'github_open_pr. Never deploy directly — deploys go through deploy_trigger, which always needs approval.',
  },
  copywriter: {
    key: 'copywriter',
    label: 'Copywriter / Social',
    glyph: 'CW',
    responsibility: 'Posts, threads, blog drafts, landing copy.',
    modelAlias: 'writer',
    skills: ['knowledge.search', 'web.search', 'draft.save', 'social.publish'],
    maxIterations: 6,
    costCapCredits: 40,
    buildsProduct: false,
    prompt:
      "You are the copywriter. Write in the company's brand voice, respect every brand do/don't, and never make " +
      'claims you cannot support. Save each piece with draft_save. Only use social_publish for a draft the plan ' +
      'explicitly says to publish — it goes to the approval queue.',
  },
  sdr: {
    key: 'sdr',
    label: 'SDR / Outreach',
    glyph: 'SD',
    responsibility: 'Find and qualify prospects; draft and (with approval) send sequences.',
    modelAlias: 'planner',
    skills: ['web.search', 'web.browse', 'knowledge.search', 'leads.list', 'leads.save', 'draft.save', 'email.send', 'crm.upsert_lead'],
    maxIterations: LIMITS.defaultMaxIterations,
    costCapCredits: 50,
    buildsProduct: true,
    prompt:
      'You are the sales development rep. Only pursue prospects who match the ICP, and record why with leads_save ' +
      '(icp_reason + a real personalization signal). Each email must reference that signal, be short and honest, ' +
      'and include an opt-out. email_send never sends immediately — it queues for approval.',
  },
  support: {
    key: 'support',
    label: 'Support',
    glyph: 'SU',
    responsibility: 'Read the inbox, draft replies, classify and tag.',
    modelAlias: 'planner',
    skills: ['tickets.list', 'tickets.update', 'knowledge.search', 'draft.save', 'email.send', 'stripe.refund'],
    maxIterations: 6,
    costCapCredits: 40,
    buildsProduct: false,
    prompt:
      'You are customer support. Triage open tickets (priority + tags via tickets_update), draft warm, specific ' +
      'replies with draft_save (kind "reply", include ticket_id), and escalate anything involving money — refunds ' +
      'go through stripe_refund, which always needs the owner.',
  },
  ads: {
    key: 'ads',
    label: 'Ads',
    glyph: 'AD',
    responsibility: 'Read campaign performance; propose budget changes within caps.',
    modelAlias: 'planner',
    skills: ['ads.read', 'ads.update_budget', 'web.search', 'knowledge.search', 'knowledge.save'],
    maxIterations: 6,
    costCapCredits: 30,
    buildsProduct: true,
    prompt:
      'You are the paid-ads operator. Read performance with ads_read first. Propose budget changes only with a ' +
      'clear reason from the data. Small changes within the configured band may auto-apply; everything else waits ' +
      'for the owner. Never exceed the daily cap.',
  },
  finance: {
    key: 'finance',
    label: 'Finance',
    glyph: 'FI',
    responsibility: 'Reconcile Stripe revenue, track burn, flag anomalies, dunning drafts.',
    modelAlias: 'cheap',
    skills: ['stripe.reconcile', 'knowledge.search', 'knowledge.save', 'draft.save', 'pricing.propose_change'],
    maxIterations: 6,
    costCapCredits: 20,
    buildsProduct: false,
    prompt:
      'You are finance. Reconcile revenue with stripe_reconcile, note anomalies with knowledge_save (category ' +
      '"finance"), and draft polite dunning emails with draft_save when payments fail. Report numbers exactly as ' +
      'read — no estimates presented as facts.',
  },
};

export function roleDef(role: RoleKey): RoleDef {
  return ROLES[role];
}

export function defaultAgentSeeds(): AgentConfigSeed[] {
  return (Object.values(ROLES) as RoleDef[]).map((r) => ({
    role: r.key,
    enabled: true,
    scheduleCron: '',
    modelAlias: r.modelAlias,
    maxIterations: r.maxIterations,
    costCapCredits: r.costCapCredits,
    autoApproveUpTo: 'none',
    standingInstruction: '',
  }));
}
