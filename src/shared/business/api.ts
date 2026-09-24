// Business-agent RPC contract (replaces the spec's REST routes under
// /api/business-agent). One IPC channel (CHANNELS.BUSINESS_RPC) carries
// { method, params }; every method has a zod request schema (validated in
// main) and a response type. Pushes arrive on CHANNELS.BUSINESS_EVENT.

import { z } from 'zod';
import {
  AUTO_APPROVE_LEVELS,
  companyConfigSchema,
  MODEL_ALIASES,
  RISK_LEVELS,
  ROLE_KEYS,
  TASK_STATUSES,
  type AgentConfigDto,
  type AlertDto,
  type ChatMessageDto,
  type ChatSessionDto,
  type CompanyDto,
  type ConfigVersionDto,
  type ConstraintDto,
  type CredentialDto,
  type CycleDto,
  type DashboardDto,
  type DraftDto,
  type FeedEventDto,
  type IntegrationDto,
  type KnowledgeDto,
  type LeadDto,
  type LearnedRuleDto,
  type PendingActionDetailDto,
  type PendingActionDto,
  type ReplayStateDto,
  type RoleKey,
  type RunDto,
  type StepDto,
  type TaskDto,
  type TicketDto,
  type UsageSummaryDto,
} from './types';

const id = z.string().min(1).max(64);
const company = { companyId: id };

export const bizRequestSchemas = {
  status: z.object({}),
  setEnabled: z.object({ enabled: z.boolean() }),

  'companies.list': z.object({ includeArchived: z.boolean().optional() }),
  'companies.create': z.object({ config: companyConfigSchema, initialCredits: z.number().min(0).max(1_000_000).optional() }),
  'companies.dashboard': z.object(company),
  'companies.updateConfig': z.object({ ...company, config: companyConfigSchema, note: z.string().max(500).optional() }),
  'companies.configHistory': z.object(company),
  'companies.setStatus': z.object({ ...company, status: z.enum(['active', 'paused', 'archived']) }),
  'companies.delete': z.object({ ...company, confirmName: z.string().max(200) }),
  'companies.export': z.object(company),

  'cycles.estimate': z.object(company),
  'cycles.trigger': z.object({ ...company, kind: z.enum(['manual', 'morning', 'evening']).default('manual') }),
  'cycles.abort': z.object(company),
  'cycles.list': z.object({ ...company, limit: z.number().int().min(1).max(500).optional() }),
  'cycles.get': z.object({ ...company, cycleId: id }),

  'agents.list': z.object(company),
  'agents.update': z.object({
    ...company,
    agentId: id,
    enabled: z.boolean().optional(),
    scheduleCron: z.string().max(100).optional(),
    modelAlias: z.enum(MODEL_ALIASES).optional(),
    maxIterations: z.number().int().min(1).max(40).optional(),
    costCapCredits: z.number().min(1).max(10_000).optional(),
    autoApproveUpTo: z.enum(AUTO_APPROVE_LEVELS).optional(),
    standingInstruction: z.string().max(2_000).optional(),
  }),
  'agents.runRole': z.object({ ...company, role: z.enum(ROLE_KEYS) }),

  'runs.list': z.object({
    ...company,
    role: z.enum(ROLE_KEYS).optional(),
    status: z.enum(['running', 'done', 'failed', 'stopped']).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  'runs.get': z.object({ ...company, runId: id }),
  'runs.replay': z.object({ ...company, runId: id, uptoSeq: z.number().int().min(0).optional() }),
  'runs.retry': z.object({ ...company, runId: id, fromSeq: z.number().int().min(0).optional() }),

  'tasks.list': z.object(company),
  'tasks.create': z.object({
    ...company,
    title: z.string().trim().min(3).max(200),
    description: z.string().max(4_000).optional(),
    role: z.enum(ROLE_KEYS),
    priority: z.number().int().min(1).max(5).optional(),
    estimatedCredits: z.number().min(0).max(10_000).optional(),
    riskLevel: z.enum(RISK_LEVELS).optional(),
  }),
  'tasks.update': z.object({
    ...company,
    taskId: id,
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.number().int().min(1).max(5).optional(),
    assignedRole: z.enum(ROLE_KEYS).optional(),
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().max(4_000).optional(),
  }),
  'tasks.delete': z.object({ ...company, taskId: id }),

  'approvals.list': z.object({ ...company, status: z.enum(['pending', 'resolved', 'all']).default('all') }),
  'approvals.get': z.object({ ...company, actionId: id }),
  'approvals.approve': z.object({ ...company, actionId: id, note: z.string().max(1_000).optional() }),
  'approvals.reject': z.object({ ...company, actionId: id, reason: z.string().trim().min(1).max(1_000) }),

  'knowledge.list': z.object({ ...company, query: z.string().max(300).optional() }),
  'knowledge.add': z.object({
    ...company,
    content: z.string().trim().min(5).max(4_000),
    category: z.enum(['market', 'competitor', 'pricing', 'customer', 'support', 'validation', 'finance', 'note', 'other']),
  }),
  'knowledge.delete': z.object({ ...company, id }),
  'rules.setStatus': z.object({ ...company, ruleId: id, status: z.enum(['proposed', 'active', 'rejected']) }),
  'rules.delete': z.object({ ...company, ruleId: id }),
  'constraints.add': z.object({ ...company, rule: z.string().trim().min(5).max(500) }),
  'constraints.delete': z.object({ ...company, id }),

  'credentials.list': z.object(company),
  'credentials.save': z.object({
    ...company,
    provider: z.string().min(1).max(40),
    label: z.string().max(120).optional(),
    secret: z.string().trim().min(4).max(4_000),
    meta: z.record(z.string().max(300)).optional(),
    shared: z.boolean().optional(),
  }),
  'credentials.delete': z.object({ ...company, credentialId: id }),
  'credentials.test': z.object({ ...company, provider: z.string().min(1).max(40) }),
  'integrations.list': z.object(company),

  'usage.summary': z.object({ ...company, days: z.number().int().min(1).max(365).optional() }),
  'budgets.addCredits': z.object({ ...company, credits: z.number().positive().max(1_000_000), note: z.string().max(200).optional() }),

  'drafts.list': z.object({ ...company, status: z.enum(['draft', 'queued', 'published', 'discarded']).optional() }),
  'drafts.update': z.object({
    ...company,
    draftId: id,
    status: z.enum(['draft', 'discarded']).optional(),
    title: z.string().max(200).optional(),
    body: z.string().max(40_000).optional(),
  }),
  'leads.list': z.object(company),
  'leads.setStatus': z.object({
    ...company,
    leadId: id,
    status: z.enum(['new', 'contacted', 'replied', 'qualified', 'unsubscribed', 'lost']),
  }),
  'tickets.list': z.object(company),
  'tickets.add': z.object({
    ...company,
    subject: z.string().trim().min(2).max(200),
    body: z.string().max(20_000).optional(),
    customer: z.string().max(200).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  }),
  'tickets.update': z.object({ ...company, ticketId: id, status: z.enum(['open', 'pending', 'closed']).optional() }),

  'chat.sessions': z.object(company),
  'chat.messages': z.object({ ...company, sessionId: id }),
  'chat.send': z.object({ ...company, sessionId: id.optional(), message: z.string().trim().min(1).max(8_000) }),

  'feed.list': z.object({ ...company, limit: z.number().int().min(1).max(2_000).optional() }),
  'alerts.list': z.object(company),
  'audit.list': z.object(company),
  'models.list': z.object({}),
  'models.health': z.object(company),
  'mcp.tools': z.object({}),
  'vault.rotate': z.object({}),
} as const;

export type BizMethod = keyof typeof bizRequestSchemas;
export type BizRequest<M extends BizMethod> = z.input<(typeof bizRequestSchemas)[M]>;
export type BizParsed<M extends BizMethod> = z.output<(typeof bizRequestSchemas)[M]>;

export interface RoleMetaDto {
  key: RoleKey;
  label: string;
  glyph: string;
  responsibility: string;
  skills: string[];
  buildsProduct: boolean;
}

export interface CycleEstimateDto {
  creditsCap: number;
  usdCap: number;
  avgRecentCredits: number;
  balance: number;
  monthSpent: number;
  monthlyCredits: number;
  verdict: 'ok' | 'warn' | 'block';
  message: string;
  running: boolean;
}

export interface GatewayHealthDto {
  alias: string;
  chain: string[];
  primary: string | null;
  provider: string | null;
  circuitOpen: boolean;
  textProtocol: boolean;
}

export interface AuditEntryDto {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export type ApprovalDecisionDto = { ok: boolean; status?: string; result?: string; error?: string };

export interface BizResponses {
  status: { enabled: boolean; runningCompanies: string[]; version: string; vaultAvailable: boolean };
  setEnabled: { enabled: boolean };
  'companies.list': { companies: CompanyDto[] };
  'companies.create': { company: CompanyDto };
  'companies.dashboard': DashboardDto;
  'companies.updateConfig': { company: CompanyDto };
  'companies.configHistory': { versions: ConfigVersionDto[] };
  'companies.setStatus': { company: CompanyDto };
  'companies.delete': { ok: boolean; error?: string };
  'companies.export': { ok: boolean; path?: string; canceled?: boolean; error?: string };
  'cycles.estimate': CycleEstimateDto;
  'cycles.trigger': { cycle?: CycleDto; alreadyRunning?: boolean; error?: string };
  'cycles.abort': { ok: boolean };
  'cycles.list': { cycles: CycleDto[] };
  'cycles.get': { cycle: CycleDto | null; runs: RunDto[]; tasks: TaskDto[] };
  'agents.list': { agents: AgentConfigDto[]; roles: RoleMetaDto[] };
  'agents.update': { agent: AgentConfigDto | null; error?: string };
  'agents.runRole': { cycle?: CycleDto; alreadyRunning?: boolean; error?: string };
  'runs.list': { runs: RunDto[] };
  'runs.get': { run: RunDto | null; steps: StepDto[] };
  'runs.replay': ReplayStateDto | { error: string };
  'runs.retry': { cycle?: CycleDto; error?: string };
  'tasks.list': { tasks: TaskDto[] };
  'tasks.create': { task: TaskDto };
  'tasks.update': { task: TaskDto | null };
  'tasks.delete': { ok: boolean };
  'approvals.list': { actions: PendingActionDto[] };
  'approvals.get': { action: PendingActionDetailDto | null };
  'approvals.approve': ApprovalDecisionDto;
  'approvals.reject': ApprovalDecisionDto;
  'knowledge.list': { memories: KnowledgeDto[]; rules: LearnedRuleDto[]; constraints: ConstraintDto[] };
  'knowledge.add': { memory: KnowledgeDto };
  'knowledge.delete': { ok: boolean };
  'rules.setStatus': { rule: LearnedRuleDto | null };
  'rules.delete': { ok: boolean };
  'constraints.add': { constraint: ConstraintDto };
  'constraints.delete': { ok: boolean };
  'credentials.list': { credentials: CredentialDto[] };
  'credentials.save': { credential?: CredentialDto; error?: string };
  'credentials.delete': { ok: boolean };
  'credentials.test': { ok: boolean; detail: string };
  'integrations.list': { integrations: IntegrationDto[] };
  'usage.summary': UsageSummaryDto;
  'budgets.addCredits': { balance: number };
  'drafts.list': { drafts: DraftDto[] };
  'drafts.update': { draft: DraftDto | null };
  'leads.list': { leads: LeadDto[] };
  'leads.setStatus': { ok: boolean };
  'tickets.list': { tickets: TicketDto[] };
  'tickets.add': { ticket: TicketDto };
  'tickets.update': { ticket: TicketDto | null };
  'chat.sessions': { sessions: ChatSessionDto[] };
  'chat.messages': { messages: ChatMessageDto[] };
  'chat.send': { session: ChatSessionDto; messages: ChatMessageDto[]; error?: string };
  'feed.list': { events: FeedEventDto[] };
  'alerts.list': { alerts: AlertDto[] };
  'audit.list': { entries: AuditEntryDto[] };
  'models.list': { models: string[]; defaultModel: string };
  'models.health': { aliases: GatewayHealthDto[] };
  'mcp.tools': { tools: Array<{ name: string; description: string }> };
  'vault.rotate': { keyId: string; credentials: number; actions: number };
}

/** Wire envelope. */
export type BizRpcResult<M extends BizMethod> = { ok: true; data: BizResponses[M] } | { ok: false; error: string };

/** Push events main → renderer. */
export type BizEvent =
  | { type: 'feed'; event: FeedEventDto }
  | { type: 'changed'; companyId: string; what: 'approvals' | 'cycles' | 'tasks' | 'company' | 'knowledge' };
