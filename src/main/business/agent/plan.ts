// Typed plan (spec §4 plan-and-execute): parse the CEO's JSON leniently,
// then validate it server-side — enabled roles only, validation gate,
// high risk ⇒ requires_approval, item cap, owner tasks always included,
// and the whole plan must fit the remaining cycle budget.

import { z } from 'zod';
import { RISK_LEVELS, ROLE_KEYS, type CyclePlan, type PlanItem, type RoleKey, type TaskDto } from '@shared/business/types';
import { fitPlanToBudget, planCost } from '../guardrails/budgets';
import { ROLES } from './roles';

const ROLE_ALIASES: Record<string, RoleKey> = {
  research: 'researcher',
  researcher: 'researcher',
  planning: 'planner',
  planner: 'planner',
  engineer: 'coder',
  developer: 'coder',
  coder: 'coder',
  code: 'coder',
  copywriter: 'copywriter',
  copy: 'copywriter',
  social: 'copywriter',
  marketing: 'copywriter',
  content: 'copywriter',
  sdr: 'sdr',
  sales: 'sdr',
  outreach: 'sdr',
  support: 'support',
  ads: 'ads',
  advertising: 'ads',
  finance: 'finance',
  ceo: 'ceo',
};

const itemSchema = z.object({
  title: z.string().trim().min(3).max(200),
  role: z.string().trim(),
  description: z.string().max(3_000).optional().default(''),
  estimated_cost_credits: z.coerce.number().min(0).max(10_000).optional().default(20),
  risk_level: z.enum(RISK_LEVELS).catch('low').optional().default('low'),
  requires_approval: z.coerce.boolean().optional().default(false),
  task_id: z.string().max(64).optional(),
});

export interface PlanContext {
  enabledRoles: Set<RoleKey>;
  validationPending: boolean;
  budgetCredits: number;
  maxItems: number;
  humanTasks: TaskDto[];
  knownTasks: Map<string, TaskDto>;
}

export interface ValidatedPlan {
  plan: CyclePlan;
  overBudget: boolean;
  rawCost: number;
}

/** Accepts {plan:[…]}, {tasks:[…]} or a bare array. null when unusable. */
export function normalizeRawPlan(raw: unknown): { items: unknown[]; notes: string } | null {
  if (Array.isArray(raw)) return { items: raw, notes: '' };
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const items = Array.isArray(o['plan']) ? o['plan'] : Array.isArray(o['tasks']) ? o['tasks'] : null;
  if (!items) return null;
  return { items, notes: typeof o['notes'] === 'string' ? o['notes'] : '' };
}

export function validatePlan(raw: unknown, ctx: PlanContext): ValidatedPlan | null {
  const norm = normalizeRawPlan(raw);
  if (!norm) return null;
  const dropped: Array<{ title: string; reason: string }> = [];
  const items: PlanItem[] = [];
  const usedTasks = new Set<string>();

  const accept = (item: PlanItem): void => {
    if (items.length >= ctx.maxItems) {
      dropped.push({ title: item.title, reason: `plan capped at ${ctx.maxItems} tasks` });
      return;
    }
    items.push(item);
  };

  for (const entry of norm.items) {
    const parsed = itemSchema.safeParse(entry);
    if (!parsed.success) {
      const title = (entry as { title?: unknown })?.title;
      dropped.push({ title: typeof title === 'string' ? title : '(untitled)', reason: 'malformed task' });
      continue;
    }
    const p = parsed.data;
    const role = ROLE_ALIASES[p.role.toLowerCase()] ?? (ROLE_KEYS as readonly string[]).find((r) => r === p.role.toLowerCase());
    if (!role) {
      dropped.push({ title: p.title, reason: `unknown role "${p.role}"` });
      continue;
    }
    if (role === 'ceo') {
      dropped.push({ title: p.title, reason: 'the CEO does not execute tasks — assign a role' });
      continue;
    }
    if (!ctx.enabledRoles.has(role as RoleKey)) {
      dropped.push({ title: p.title, reason: `${role} is disabled` });
      continue;
    }
    if (ctx.validationPending && ROLES[role as RoleKey].buildsProduct) {
      dropped.push({ title: p.title, reason: `${role} is blocked until the idea is validated` });
      continue;
    }
    const taskId = p.task_id && ctx.knownTasks.has(p.task_id) && !usedTasks.has(p.task_id) ? p.task_id : undefined;
    if (taskId) usedTasks.add(taskId);
    accept({
      title: p.title,
      role: role as RoleKey,
      description: p.description,
      estimated_cost_credits: Math.round(p.estimated_cost_credits * 10) / 10,
      risk_level: p.risk_level,
      // Server-side: high risk always requires approval, whatever the model said.
      requires_approval: p.risk_level === 'high' ? true : p.requires_approval,
      ...(taskId ? { taskId } : {}),
    });
  }

  // Owner-requested tasks are guaranteed a slot (front of the plan).
  const missingHuman = ctx.humanTasks.filter((t) => !usedTasks.has(t.id));
  for (const t of missingHuman.reverse()) {
    if (!ctx.enabledRoles.has(t.assignedRole) || t.assignedRole === 'ceo') {
      dropped.push({ title: t.title, reason: `${t.assignedRole} is disabled` });
      continue;
    }
    if (ctx.validationPending && ROLES[t.assignedRole].buildsProduct) {
      dropped.push({ title: t.title, reason: `${t.assignedRole} is blocked until the idea is validated` });
      continue;
    }
    items.unshift({
      title: t.title,
      role: t.assignedRole,
      description: t.description,
      estimated_cost_credits: t.estimatedCredits || 20,
      risk_level: t.riskLevel,
      requires_approval: t.riskLevel === 'high' || t.approvalRequired,
      taskId: t.id,
    });
    usedTasks.add(t.id);
  }
  while (items.length > ctx.maxItems) {
    const extra = items.pop()!;
    dropped.push({ title: extra.title, reason: `plan capped at ${ctx.maxItems} tasks` });
  }

  const rawCost = planCost(items);
  const { kept, dropped: overBudget } = fitPlanToBudget(items, ctx.budgetCredits);
  return {
    plan: { plan: kept, notes: norm.notes.slice(0, 2_000), dropped: [...dropped, ...overBudget] },
    overBudget: overBudget.length > 0,
    rawCost,
  };
}
