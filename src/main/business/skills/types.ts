// A skill is the atomic unit of execution (spec §6): a tool plus its
// pre-execution checks, success rubric, explicit failure conditions, risk /
// category (which the approval matrix keys off), a credit cost, and an
// optional post-run learning hook. Agents never see raw tools.

import type { z } from 'zod';
import type {
  ActionCategory,
  ChannelKey,
  CompanyDto,
  RiskLevel,
  RoleKey,
} from '@shared/business/types';
import type { GateInput } from '@shared/business/policy';
import type { BizDb } from '../db';
import type { ResolvedCredential } from '../crypto/credentials';
import type { ModelGateway } from '../providers/gateway';
import type { KnowledgeService } from '../memory/knowledge';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface SkillContext {
  companyId: string;
  company: CompanyDto;
  role: RoleKey;
  runId: string | null;
  cycleId: string | null;
  taskId: string | null;
  db: BizDb;
  credentials: {
    has(provider: string): boolean;
    resolve(provider: string): ResolvedCredential | null;
  };
  fetch: FetchFn;
  gateway: ModelGateway | null;
  knowledge: KnowledgeService;
  now(): number;
  signal?: AbortSignal;
  feed?: (text: string) => void;
}

export interface SkillResult {
  ok: boolean;
  /** What the model sees next (also redacted into the trace). */
  content: string;
  data?: unknown;
  /** True when the skill changed state (counts as progress). */
  stateChange?: boolean;
  /** True when the result is empty ("report it, don't retry forever"). */
  empty?: boolean;
}

export interface RuleProposal {
  condition: string;
  action: string;
  rationale: string;
  polarity: 'do' | 'avoid';
  confidence: number;
}

export type Precondition = { ok: true } | { ok: false; reason: string };

export interface Skill<A = any> {
  key: string;
  /** Name the LLM calls (provider-safe: [a-zA-Z0-9_-]). */
  toolName: string;
  name: string;
  /** How the agent "sees" the skill. */
  description: string;
  /** JSON schema for the model. */
  parameters: object;
  /** Runtime validation. */
  schema: z.ZodType<A>;
  category: ActionCategory;
  risk: RiskLevel;
  costCredits: number;
  /** Outward channel that must be enabled in the company config. */
  channel?: ChannelKey;
  /** Credential provider(s) — any one must be connected. */
  providers?: string[];
  rubric: string[];
  failureConditions: string[];
  /** Extra availability check (beyond channel + credentials). */
  available?(ctx: SkillContext): boolean;
  precondition?(ctx: SkillContext, args: A): Promise<Precondition> | Precondition;
  /** Server-computed numbers the gate needs (e.g. real ad budget delta). */
  gateMetrics?(ctx: SkillContext, args: A): Promise<Partial<GateInput>>;
  /** Approval-card preview. */
  preview(args: A): { title: string; summary: string };
  execute(ctx: SkillContext, args: A, exec: { idempotencyKey: string }): Promise<SkillResult>;
  postRunLearn?(ctx: SkillContext, args: A, result: SkillResult): RuleProposal[];
}

export function skillToolName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Standard JSON response parsing for REST skills with useful errors. */
export async function readJson(res: Response, label: string): Promise<unknown> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const detail =
      body && typeof body === 'object'
        ? JSON.stringify((body as Record<string, unknown>)['error'] ?? (body as Record<string, unknown>)['message'] ?? body).slice(0, 300)
        : String(body).slice(0, 300);
    throw new Error(`${label} HTTP ${res.status}: ${detail}`);
  }
  return body;
}
