// Business agent — shared vocabulary, the CompanyConfig schema (single source
// of truth every agent reads at boot), and the DTOs the renderer sees. Pure:
// imported by main, preload-typed IPC, and the renderer.

import { z } from 'zod';

export const ROLE_KEYS = [
  'ceo',
  'researcher',
  'planner',
  'coder',
  'copywriter',
  'sdr',
  'support',
  'ads',
  'finance',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** What a skill does to the world. The approval matrix keys off this, never
 *  off anything the model says. */
export const ACTION_CATEGORIES = [
  'read',
  'draft',
  'internal',
  'publish',
  'outbound',
  'ad_budget',
  'external_write',
  'config_edit',
  'validation',
  'deploy',
  'pricing',
  'refund',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export const AUTONOMY_TIERS = ['safe', 'assisted', 'autonomous'] as const;
export type AutonomyTier = (typeof AUTONOMY_TIERS)[number];

export const AUTO_APPROVE_LEVELS = ['none', 'low', 'medium'] as const;
export type AutoApproveLevel = (typeof AUTO_APPROVE_LEVELS)[number];

export const MODEL_ALIASES = ['planner', 'writer', 'coding', 'cheap', 'embed'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

export const CHANNEL_KEYS = ['email', 'social', 'ads', 'crm', 'code'] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const shortList = (max: number, len = 200) =>
  z.array(z.string().trim().min(1).max(len)).max(max).default([]);

export const companyConfigSchema = z.object({
  name: z.string().trim().min(1).max(120),
  niche: z.string().trim().max(300).default(''),
  valueProp: z.string().trim().max(1000).default(''),
  mission: z.string().trim().max(1000).default(''),
  icp: z.string().trim().max(1500).default(''),
  brandVoice: z.string().trim().max(1000).default(''),
  brandDos: shortList(30),
  brandDonts: shortList(30),
  pricePoints: shortList(20),
  goals: shortList(10, 300),
  kpis: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        target: z.string().trim().max(60).default(''),
      }),
    )
    .max(12)
    .default([]),
  links: z
    .object({
      site: z.string().trim().max(300).default(''),
      repo: z.string().trim().max(300).default(''),
    })
    .default({}),
  /** Outward channels are opt-in (Polsia lesson: never act on unapproved channels). */
  channels: z
    .object({
      email: z.boolean().default(false),
      social: z.boolean().default(false),
      ads: z.boolean().default(false),
      crm: z.boolean().default(false),
      code: z.boolean().default(false),
    })
    .default({}),
  autonomy: z.enum(AUTONOMY_TIERS).default('safe'),
  budgets: z
    .object({
      cycleCredits: z.number().min(1).max(100_000).default(200),
      monthlyCredits: z.number().min(1).max(10_000_000).default(5_000),
      cycleUsd: z.number().min(0).max(10_000).default(2),
      monthlyUsd: z.number().min(0).max(100_000).default(50),
      alertRatio: z.number().min(0.1).max(1).default(0.8),
    })
    .default({}),
  limits: z
    .object({
      emailsPerDay: z.number().int().min(0).max(10_000).default(20),
      postsPerDay: z.number().int().min(0).max(500).default(3),
      crawlPagesPerDay: z.number().int().min(0).max(10_000).default(60),
      adBudgetChangePct: z.number().min(0).max(100).default(10),
      adDailyCapUsd: z.number().min(0).max(1_000_000).default(50),
      publishCleanThreshold: z.number().int().min(0).max(1000).default(5),
    })
    .default({}),
  schedule: z
    .object({
      enabled: z.boolean().default(true),
      morning: hhmm.default('07:00'),
      evening: hhmm.default('19:00'),
      /** Missed-run catch-up window in minutes (spec default: 15). */
      catchUpMinutes: z.number().int().min(0).max(1440).default(15),
    })
    .default({}),
  /** Validate-before-build gate (default on for new companies). */
  validation: z
    .object({
      required: z.boolean().default(true),
      status: z.enum(['pending', 'passed', 'waived']).default('pending'),
      evidence: z.string().max(6000).default(''),
    })
    .default({}),
  /** Alias → model id. Empty string = app default (orchestrator model). */
  models: z
    .object({
      planner: z.string().max(200).default(''),
      writer: z.string().max(200).default(''),
      coding: z.string().max(200).default(''),
      cheap: z.string().max(200).default(''),
      embed: z.string().max(200).default(''),
    })
    .default({}),
  browse: z
    .object({
      allowDomains: shortList(100),
      blockDomains: shortList(100),
    })
    .default({}),
  email: z
    .object({
      fromAddress: z.string().trim().max(200).default(''),
      fromName: z.string().trim().max(120).default(''),
      optOutFooter: z
        .string()
        .max(500)
        .default("Not interested? Reply 'unsubscribe' and I won't email you again."),
    })
    .default({}),
  notifications: z
    .object({
      desktop: z.boolean().default(true),
      digestEmail: z.string().trim().max(200).default(''),
      slack: z.boolean().default(false),
    })
    .default({}),
  /** MCP tools the owner has granted to roles (ungranted MCP tools are invisible). */
  mcpGrants: z
    .array(
      z.object({
        tool: z.string().min(1).max(200),
        roles: z.array(z.enum(ROLE_KEYS)).min(1).max(9),
        category: z.enum(['read', 'external_write']),
      }),
    )
    .max(50)
    .default([]),
  founderNotes: z.string().max(4000).default(''),
});

export type CompanyConfig = z.infer<typeof companyConfigSchema>;
export type CompanyConfigInput = z.input<typeof companyConfigSchema>;

export function defaultCompanyConfig(name: string): CompanyConfig {
  return companyConfigSchema.parse({ name });
}

// ── DTOs ────────────────────────────────────────────────────────────────────

export type CompanyStatus = 'active' | 'paused' | 'archived';

export interface CompanyDto {
  id: string;
  name: string;
  status: CompanyStatus;
  activeConfigVersion: number;
  config: CompanyConfig;
  createdAt: number;
  updatedAt: number;
}

export interface ConfigVersionDto {
  version: number;
  config: CompanyConfig;
  editedBy: 'user' | 'agent' | 'system';
  note: string;
  editedAt: number;
}

export interface AgentConfigDto {
  id: string;
  companyId: string;
  role: RoleKey;
  enabled: boolean;
  scheduleCron: string;
  modelAlias: ModelAlias;
  maxIterations: number;
  costCapCredits: number;
  autoApproveUpTo: AutoApproveLevel;
  standingInstruction: string;
  updatedAt: number;
}

export type CycleKind = 'morning' | 'evening' | 'manual' | 'role' | 'chat';
export type TriggerType = 'schedule' | 'manual' | 'catchup' | 'event' | 'retry';
export type CycleStatus = 'running' | 'done' | 'failed' | 'aborted' | 'budget_stopped' | 'skipped';

export interface PlanItem {
  title: string;
  role: RoleKey;
  description: string;
  estimated_cost_credits: number;
  risk_level: RiskLevel;
  requires_approval: boolean;
  taskId?: string;
}

export interface CyclePlan {
  plan: PlanItem[];
  notes: string;
  dropped?: Array<{ title: string; reason: string }>;
}

export interface CycleDto {
  id: string;
  companyId: string;
  kind: CycleKind;
  triggerType: TriggerType;
  status: CycleStatus;
  role: RoleKey | null;
  plan: CyclePlan | null;
  summary: string | null;
  stopReason: string | null;
  creditsCap: number;
  usdCap: number;
  creditsSpent: number;
  costUsd: number;
  configVersion: number;
  error: string | null;
  startedAt: number;
  endedAt: number | null;
}

export type RunStatus = 'running' | 'done' | 'failed' | 'stopped';

export type StopReason =
  | 'goal_achieved'
  | 'agent_done_unverified'
  | 'max_iterations'
  | 'budget_exhausted'
  | 'no_progress'
  | 'timeout'
  | 'aborted'
  | 'error';

export interface RunDto {
  id: string;
  companyId: string;
  cycleId: string | null;
  taskId: string | null;
  role: RoleKey;
  triggerType: TriggerType | 'chat';
  status: RunStatus;
  stopReason: StopReason | null;
  goal: string;
  output: string | null;
  iterationCount: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  credits: number;
  errorMessage: string | null;
  startedAt: number;
  endedAt: number | null;
}

export type StepPhase = 'perceive' | 'reason' | 'plan' | 'act' | 'observe' | 'stop';
export type StepKind = 'llm' | 'tool' | 'guardrail' | 'approval' | 'goal_check' | 'note';

export interface StepDto {
  id: string;
  runId: string;
  seqNo: number;
  phase: StepPhase;
  stepKind: StepKind;
  iteration: number;
  promptSnippet: string | null;
  content: string | null;
  toolName: string | null;
  toolArgsRedacted: string | null;
  toolResultRedacted: string | null;
  ok: boolean | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  credits: number;
  durationMs: number;
  createdAt: number;
}

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'awaiting_approval',
  'done',
  'failed',
  'rejected',
  'skipped',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskSource = 'ceo' | 'planner' | 'human' | 'agent' | 'drift' | 'system';

export interface TaskDto {
  id: string;
  companyId: string;
  cycleId: string | null;
  title: string;
  description: string;
  assignedRole: RoleKey;
  priority: number;
  status: TaskStatus;
  source: TaskSource;
  riskLevel: RiskLevel;
  estimatedCredits: number;
  approvalRequired: boolean;
  result: string | null;
  rejectedReason: string | null;
  sourceRunId: string | null;
  dueAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type PendingStatus =
  | 'pending'
  | 'approved'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'rejected'
  | 'expired';

export interface PendingActionDto {
  id: string;
  companyId: string;
  cycleId: string | null;
  runId: string | null;
  taskId: string | null;
  role: RoleKey;
  skillKey: string;
  category: ActionCategory;
  riskLevel: RiskLevel;
  title: string;
  summary: string;
  reason: string;
  gate: 'approval' | 'objection_window';
  credits: number;
  status: PendingStatus;
  executeAfter: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
  decisionNote: string | null;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Full detail for the approval drawer: decrypted args + the skill rubric. */
export interface PendingActionDetailDto extends PendingActionDto {
  args: unknown;
  rubric: string[];
  skillName: string;
}

export type KnowledgeCategory =
  | 'market'
  | 'competitor'
  | 'pricing'
  | 'customer'
  | 'support'
  | 'validation'
  | 'summary'
  | 'finance'
  | 'note'
  | 'other';

export interface KnowledgeDto {
  id: string;
  companyId: string;
  content: string;
  category: KnowledgeCategory;
  source: string;
  sourceRunId: string | null;
  confidence: number;
  active: boolean;
  createdAt: number;
  score?: number;
}

export type RuleStatus = 'proposed' | 'active' | 'rejected';

export interface LearnedRuleDto {
  id: string;
  companyId: string;
  condition: string;
  action: string;
  rationale: string;
  polarity: 'do' | 'avoid';
  confidence: number;
  sourceRunId: string | null;
  sourceActionId: string | null;
  proposedBy: 'agent' | 'user' | 'kaizen' | 'rejection';
  status: RuleStatus;
  createdAt: number;
  decidedAt: number | null;
}

export interface ConstraintDto {
  id: string;
  companyId: string | null;
  rule: string;
  immutable: boolean; // built-in constitution rows
  createdAt: number;
}

export interface CredentialDto {
  id: string;
  companyId: string | null;
  provider: string;
  label: string;
  fingerprint: string;
  meta: Record<string, string>;
  status: 'active' | 'revoked';
  createdAt: number;
  lastRotatedAt: number;
  lastUsedAt: number | null;
}

export type DraftKind = 'post' | 'email' | 'blog' | 'reply' | 'landing' | 'sequence' | 'ad' | 'spec' | 'other';

export interface DraftDto {
  id: string;
  companyId: string;
  runId: string | null;
  kind: DraftKind;
  channel: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  status: 'draft' | 'queued' | 'published' | 'discarded';
  createdAt: number;
  updatedAt: number;
}

export interface LeadDto {
  id: string;
  companyId: string;
  name: string;
  email: string;
  companyName: string;
  source: string;
  signal: string;
  icpReason: string;
  status: 'new' | 'contacted' | 'replied' | 'qualified' | 'unsubscribed' | 'lost';
  lastContactedAt: number | null;
  createdAt: number;
}

export interface TicketDto {
  id: string;
  companyId: string;
  subject: string;
  body: string;
  customer: string;
  status: 'open' | 'pending' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  tags: string[];
  draftReplyId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KpiDto {
  key: string;
  value: number;
  unit: string;
  source: string;
  capturedAt: number;
}

export interface LedgerEntryDto {
  id: string;
  companyId: string;
  delta: number;
  balanceAfter: number;
  reason: 'grant_monthly' | 'grant_manual' | 'cycle_spend' | 'skill_spend' | 'refund' | 'adjust';
  refType: string | null;
  refId: string | null;
  note: string;
  createdAt: number;
}

export interface UsageSummaryDto {
  balance: number;
  monthSpentCredits: number;
  monthSpentUsd: number;
  monthlyCredits: number;
  monthlyUsd: number;
  projectedMonthCredits: number;
  projectedMonthUsd: number;
  byRole: Array<{ role: string; credits: number; usd: number; calls: number }>;
  byModel: Array<{ model: string; credits: number; usd: number; calls: number; errors: number }>;
  daily: Array<{ day: string; credits: number; usd: number }>;
  ledger: LedgerEntryDto[];
}

export type FeedKind =
  | 'cycle-start'
  | 'phase'
  | 'plan'
  | 'task-start'
  | 'tool'
  | 'task-done'
  | 'task-failed'
  | 'approval-requested'
  | 'approval-decided'
  | 'action-executed'
  | 'action-failed'
  | 'summary'
  | 'cycle-end'
  | 'alert'
  | 'learn'
  | 'error';

export interface FeedEventDto {
  id: string;
  companyId: string;
  cycleId: string | null;
  runId: string | null;
  role: string | null;
  kind: FeedKind;
  text: string;
  credits?: number;
  ts: number;
}

export interface AlertDto {
  key: 'cost_spike' | 'approval_backlog' | 'empty_loops' | 'provider_errors' | 'budget_warn' | 'budget_block';
  severity: 'warn' | 'critical';
  message: string;
}

export interface ChatSessionDto {
  id: string;
  companyId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  runId: string | null;
  createdAt: number;
}

export interface IntegrationDto {
  provider: string;
  label: string;
  purpose: string;
  skills: string[];
  connected: boolean;
  credentialId: string | null;
  fingerprint: string | null;
  metaFields: Array<{ key: string; label: string; placeholder: string }>;
  docsUrl: string;
}

export interface ReplayStateDto {
  runId: string;
  uptoSeq: number;
  totalSteps: number;
  narrative: Array<{ seqNo: number; phase: StepPhase; text: string }>;
  toolCalls: Array<{ seqNo: number; tool: string; args: string; result: string; ok: boolean | null }>;
  creditsSoFar: number;
  costSoFar: number;
  stopReason: StopReason | null;
}

export interface DashboardDto {
  company: CompanyDto;
  running: CycleDto | null;
  lastCycle: CycleDto | null;
  lastSummary: { cycleId: string; kind: CycleKind; text: string; at: number } | null;
  pendingApprovals: number;
  openTasks: number;
  kpis: KpiDto[];
  balance: number;
  monthSpentCredits: number;
  alerts: AlertDto[];
  agents: AgentConfigDto[];
  validation: CompanyConfig['validation'];
  nextRuns: Array<{ job: string; at: number }>;
}
