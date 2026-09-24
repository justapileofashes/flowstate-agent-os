// Internal skills: memory, the task board, drafts, leads, tickets, the
// validation gate, config/pricing proposals, and a sandboxed JS check. None
// of these touch the outside world except through the approval queue
// (validation / config / pricing are gated by category).

import { z } from 'zod';
import { companyConfigSchema, ROLE_KEYS, type KnowledgeCategory, type RoleKey } from '@shared/business/types';
import { brandViolations } from '../memory/brand';
import { localDate } from '../db/util';
import { skillToolName, type Skill } from './types';

const KNOWLEDGE_CATEGORIES = [
  'market',
  'competitor',
  'pricing',
  'customer',
  'support',
  'validation',
  'finance',
  'note',
  'other',
] as const;

const DRAFT_KINDS = ['post', 'email', 'blog', 'reply', 'landing', 'sequence', 'ad', 'spec', 'other'] as const;

function json(v: unknown): string {
  return JSON.stringify(v, null, 1);
}

// ── memory ──────────────────────────────────────────────────────────────────

const knowledgeSearchArgs = z.object({
  query: z.string().min(2).max(300),
  category: z.enum(KNOWLEDGE_CATEGORIES).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

export const knowledgeSearch: Skill<z.infer<typeof knowledgeSearchArgs>> = {
  key: 'knowledge.search',
  toolName: skillToolName('knowledge.search'),
  name: 'Search company memory',
  description:
    'Semantic search over what the company already knows (research findings, customer language, pricing tests, resolved support cases). Check memory before researching again.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      category: { type: 'string', enum: [...KNOWLEDGE_CATEGORIES] },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
    },
    required: ['query'],
  },
  schema: knowledgeSearchArgs,
  category: 'read',
  risk: 'low',
  costCredits: 0,
  rubric: ['Returned entries are relevant to the query'],
  failureConditions: ['Memory is empty'],
  preview: (a) => ({ title: `Search memory: ${a.query}`, summary: a.query }),
  async execute(ctx, a) {
    const hits = await ctx.knowledge.search(ctx.companyId, a.query, {
      k: a.limit ?? 5,
      ...(a.category ? { category: a.category as KnowledgeCategory } : {}),
    });
    if (!hits.length) return { ok: true, content: 'No matching memories.', empty: true };
    return {
      ok: true,
      content: json(hits.map((h) => ({ id: h.id, category: h.category, score: h.score, content: h.content, source: h.source }))),
      data: hits,
    };
  },
};

const knowledgeSaveArgs = z.object({
  content: z.string().min(10).max(4_000),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  source: z.string().max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const knowledgeSave: Skill<z.infer<typeof knowledgeSaveArgs>> = {
  key: 'knowledge.save',
  toolName: skillToolName('knowledge.save'),
  name: 'Save a finding to memory',
  description:
    'Store one durable finding in company memory (one fact per call). Include the source URL when it came from the web.',
  parameters: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The finding, self-contained.' },
      category: { type: 'string', enum: [...KNOWLEDGE_CATEGORIES] },
      source: { type: 'string', description: 'URL or where this came from.' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['content', 'category'],
  },
  schema: knowledgeSaveArgs,
  category: 'internal',
  risk: 'low',
  costCredits: 0,
  rubric: ['Finding is specific and sourced', 'Not a duplicate of existing memory'],
  failureConditions: ['Finding is speculation presented as fact'],
  preview: (a) => ({ title: `Remember (${a.category})`, summary: a.content }),
  async execute(ctx, a) {
    // Near-duplicate guard: skip when memory already holds this finding.
    const near = await ctx.knowledge.search(ctx.companyId, a.content, { k: 1, minScore: 0.92 });
    if (near.length) {
      return { ok: true, content: `Already in memory as ${near[0]!.id} — not saved again.`, empty: true };
    }
    const row = await ctx.knowledge.add(ctx.companyId, {
      content: a.content,
      category: a.category,
      source: a.source ?? `${ctx.role} run`,
      sourceRunId: ctx.runId,
      confidence: a.confidence ?? 0.6,
    });
    return { ok: true, content: `Saved to memory (${row.id}).`, stateChange: true, data: row };
  },
};

// ── task board ──────────────────────────────────────────────────────────────

const tasksCreateArgs = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2_000).optional(),
  role: z.enum(ROLE_KEYS),
  priority: z.number().int().min(1).max(5).optional(),
  estimated_credits: z.number().min(0).max(10_000).optional(),
});

export const tasksCreate: Skill<z.infer<typeof tasksCreateArgs>> = {
  key: 'tasks.create',
  toolName: skillToolName('tasks.create'),
  name: 'Add a roadmap task',
  description:
    'Add a concrete task to the company roadmap, assigned to exactly one role. Priority 1 = most urgent. It is picked up by a future cycle.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      role: { type: 'string', enum: [...ROLE_KEYS] },
      priority: { type: 'integer', minimum: 1, maximum: 5 },
      estimated_credits: { type: 'number', minimum: 0 },
    },
    required: ['title', 'role'],
  },
  schema: tasksCreateArgs,
  category: 'internal',
  risk: 'low',
  costCredits: 0,
  rubric: ['Task is concrete and testable', 'Assigned to the right role', 'Not a duplicate of an open task'],
  failureConditions: ['Vague task ("improve marketing")'],
  preview: (a) => ({ title: `New task for ${a.role}: ${a.title}`, summary: a.description ?? '' }),
  precondition(ctx, a) {
    const open = ctx.db.work.listTasks(ctx.companyId, { statuses: ['backlog', 'todo', 'in_progress', 'awaiting_approval'] });
    const dupe = open.find((t) => t.title.trim().toLowerCase() === a.title.trim().toLowerCase());
    return dupe ? { ok: false, reason: `an open task with this title already exists (${dupe.id})` } : { ok: true };
  },
  async execute(ctx, a) {
    const source = ctx.role === 'planner' ? 'planner' : ctx.role === 'ceo' ? 'ceo' : 'agent';
    const task = ctx.db.work.createTask({
      companyId: ctx.companyId,
      title: a.title,
      description: a.description ?? '',
      assignedRole: a.role as RoleKey,
      priority: a.priority ?? 3,
      status: 'backlog',
      source,
      estimatedCredits: a.estimated_credits ?? 20,
      sourceRunId: ctx.runId,
      now: ctx.now(),
    });
    return { ok: true, content: `Task created (${task.id}) for ${a.role}.`, stateChange: true, data: task };
  },
};

// ── drafts ──────────────────────────────────────────────────────────────────

const draftSaveArgs = z.object({
  kind: z.enum(DRAFT_KINDS),
  title: z.string().min(2).max(200),
  body: z.string().min(10).max(40_000),
  channel: z.string().max(60).optional(),
  ticket_id: z.string().max(64).optional(),
  lead_email: z.string().max(200).optional(),
});

export const draftSave: Skill<z.infer<typeof draftSaveArgs>> = {
  key: 'draft.save',
  toolName: skillToolName('draft.save'),
  name: 'Save a draft',
  description:
    'Save content as a draft for the owner to review (posts, emails, blog posts, support replies, landing copy, sequences, ad copy, specs). Drafts are never published by saving.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...DRAFT_KINDS] },
      title: { type: 'string' },
      body: { type: 'string' },
      channel: { type: 'string', description: 'e.g. x, linkedin, blog, email' },
      ticket_id: { type: 'string', description: 'For support replies: the ticket this answers.' },
      lead_email: { type: 'string', description: 'For outreach: the lead this is for.' },
    },
    required: ['kind', 'title', 'body'],
  },
  schema: draftSaveArgs,
  category: 'draft',
  risk: 'low',
  costCredits: 0,
  rubric: [
    "Matches the company's brand voice and respects every don't",
    'Makes no claim the company cannot support',
    'Specific to the audience (ICP) rather than generic',
  ],
  failureConditions: ['Contains a brand "don\'t" phrase', 'Invents customers, numbers or testimonials'],
  preview: (a) => ({ title: `Draft ${a.kind}: ${a.title}`, summary: a.body }),
  async execute(ctx, a) {
    const violations = brandViolations(`${a.title}\n${a.body}`, ctx.company.config.brandDonts);
    const draft = ctx.db.work.createDraft({
      companyId: ctx.companyId,
      runId: ctx.runId,
      kind: a.kind,
      channel: a.channel ?? '',
      title: a.title,
      body: a.body,
      meta: {
        role: ctx.role,
        ...(a.ticket_id ? { ticketId: a.ticket_id } : {}),
        ...(a.lead_email ? { leadEmail: a.lead_email } : {}),
        ...(violations.length ? { brandViolations: violations } : {}),
      },
      now: ctx.now(),
    });
    if (a.ticket_id && ctx.db.work.getTicket(ctx.companyId, a.ticket_id)) {
      ctx.db.work.updateTicket(ctx.companyId, a.ticket_id, { draftReplyId: draft.id, status: 'pending' }, ctx.now());
    }
    const warn = violations.length
      ? ` WARNING: it contains brand "don't" phrases (${violations.join(', ')}) — revise with a new draft.`
      : '';
    return { ok: true, content: `Draft saved (${draft.id}).${warn}`, stateChange: true, data: draft };
  },
};

// ── leads ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const leadsSaveArgs = z.object({
  email: z.string().max(200).regex(EMAIL_RE, 'must be an email address'),
  name: z.string().max(120).optional(),
  company: z.string().max(160).optional(),
  source: z.string().max(300).optional(),
  signal: z.string().min(5).max(1_000),
  icp_reason: z.string().min(5).max(500),
});

export const leadsSave: Skill<z.infer<typeof leadsSaveArgs>> = {
  key: 'leads.save',
  toolName: skillToolName('leads.save'),
  name: 'Save a qualified lead',
  description:
    'Record a prospect who matches the ICP. signal = a real, specific fact you can reference in outreach (with where you found it); icp_reason = why they fit.',
  parameters: {
    type: 'object',
    properties: {
      email: { type: 'string' },
      name: { type: 'string' },
      company: { type: 'string' },
      source: { type: 'string', description: 'URL where you found them' },
      signal: { type: 'string' },
      icp_reason: { type: 'string' },
    },
    required: ['email', 'signal', 'icp_reason'],
  },
  schema: leadsSaveArgs,
  category: 'internal',
  risk: 'low',
  costCredits: 0,
  rubric: ['Lead matches the ICP', 'Signal is real and specific', 'Source is recorded'],
  failureConditions: ['Guessed email address', 'No personalization signal'],
  preview: (a) => ({ title: `Lead: ${a.name ?? a.email}`, summary: `${a.icp_reason} — ${a.signal}` }),
  async execute(ctx, a) {
    const lead = ctx.db.work.upsertLead({
      companyId: ctx.companyId,
      email: a.email,
      name: a.name ?? '',
      companyName: a.company ?? '',
      source: a.source ?? '',
      signal: a.signal,
      icpReason: a.icp_reason,
      now: ctx.now(),
    });
    const note = lead.status === 'unsubscribed' ? ' (they unsubscribed — never contact them)' : '';
    return { ok: true, content: `Lead saved (${lead.id}, status ${lead.status})${note}.`, stateChange: true, data: lead };
  },
};

const leadsListArgs = z.object({ limit: z.number().int().min(1).max(100).optional() });

export const leadsList: Skill<z.infer<typeof leadsListArgs>> = {
  key: 'leads.list',
  toolName: skillToolName('leads.list'),
  name: 'List leads',
  description: 'List known leads with status and last-contacted time (never re-contact within 7 days or after unsubscribe).',
  parameters: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } } },
  schema: leadsListArgs,
  category: 'read',
  risk: 'low',
  costCredits: 0,
  rubric: ['Uses the list to avoid duplicate outreach'],
  failureConditions: [],
  preview: () => ({ title: 'List leads', summary: '' }),
  async execute(ctx, a) {
    const leads = ctx.db.work.listLeads(ctx.companyId, a.limit ?? 30);
    if (!leads.length) return { ok: true, content: 'No leads yet.', empty: true };
    return {
      ok: true,
      content: json(
        leads.map((l) => ({
          email: l.email,
          name: l.name,
          company: l.companyName,
          status: l.status,
          lastContacted: l.lastContactedAt ? localDate(l.lastContactedAt) : null,
          signal: l.signal,
        })),
      ),
    };
  },
};

// ── tickets ─────────────────────────────────────────────────────────────────

const ticketsListArgs = z.object({
  status: z.enum(['open', 'pending', 'closed']).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const ticketsList: Skill<z.infer<typeof ticketsListArgs>> = {
  key: 'tickets.list',
  toolName: skillToolName('tickets.list'),
  name: 'Read the support inbox',
  description: 'List support tickets (default: open ones) with subject, customer, body and current priority.',
  parameters: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['open', 'pending', 'closed'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
  },
  schema: ticketsListArgs,
  category: 'read',
  risk: 'low',
  costCredits: 0,
  rubric: ['Every open ticket is triaged'],
  failureConditions: [],
  preview: () => ({ title: 'Read tickets', summary: '' }),
  async execute(ctx, a) {
    const tickets = ctx.db.work.listTickets(ctx.companyId, { status: a.status ?? 'open', limit: a.limit ?? 20 });
    if (!tickets.length) return { ok: true, content: `No ${a.status ?? 'open'} tickets.`, empty: true };
    return {
      ok: true,
      content: json(
        tickets.map((t) => ({
          id: t.id,
          subject: t.subject,
          customer: t.customer,
          priority: t.priority,
          tags: t.tags,
          hasDraftReply: Boolean(t.draftReplyId),
          body: t.body.slice(0, 2_000),
        })),
      ),
    };
  },
};

const ticketsUpdateArgs = z.object({
  ticket_id: z.string().min(1).max(64),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  tags: z.array(z.string().min(1).max(40)).max(10).optional(),
  status: z.enum(['open', 'pending', 'closed']).optional(),
});

export const ticketsUpdate: Skill<z.infer<typeof ticketsUpdateArgs>> = {
  key: 'tickets.update',
  toolName: skillToolName('tickets.update'),
  name: 'Triage a ticket',
  description: 'Set priority, tags or status on a support ticket.',
  parameters: {
    type: 'object',
    properties: {
      ticket_id: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'string', enum: ['open', 'pending', 'closed'] },
    },
    required: ['ticket_id'],
  },
  schema: ticketsUpdateArgs,
  category: 'internal',
  risk: 'low',
  costCredits: 0,
  rubric: ['Priority reflects urgency and customer impact'],
  failureConditions: ['Unknown ticket'],
  preview: (a) => ({ title: `Triage ticket ${a.ticket_id}`, summary: JSON.stringify(a) }),
  precondition(ctx, a) {
    return ctx.db.work.getTicket(ctx.companyId, a.ticket_id)
      ? { ok: true }
      : { ok: false, reason: `ticket ${a.ticket_id} not found` };
  },
  async execute(ctx, a) {
    const t = ctx.db.work.updateTicket(
      ctx.companyId,
      a.ticket_id,
      {
        ...(a.priority ? { priority: a.priority } : {}),
        ...(a.tags ? { tags: a.tags } : {}),
        ...(a.status ? { status: a.status } : {}),
      },
      ctx.now(),
    );
    return { ok: true, content: `Ticket ${a.ticket_id} updated (priority ${t?.priority}, status ${t?.status}).`, stateChange: true };
  },
};

// ── validation gate ─────────────────────────────────────────────────────────

const validationArgs = z.object({
  verdict: z.enum(['validated', 'not_validated', 'unclear']),
  problem: z.string().min(20).max(2_000),
  competitors: z.array(z.string().min(2).max(300)).max(15),
  demand_signals: z.array(z.string().min(5).max(500)).max(15),
  summary: z.string().min(20).max(3_000),
  sources: z.array(z.string().max(500)).max(20),
});

export const validationSubmit: Skill<z.infer<typeof validationArgs>> = {
  key: 'validation.submit',
  toolName: skillToolName('validation.submit'),
  name: 'Submit idea validation',
  description:
    'Submit the validate-before-build report (problem, competitor map, demand signals, sources, verdict). The owner decides whether the idea is validated; until then no build/outreach/ads work is dispatched.',
  parameters: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['validated', 'not_validated', 'unclear'] },
      problem: { type: 'string' },
      competitors: { type: 'array', items: { type: 'string' } },
      demand_signals: { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
      sources: { type: 'array', items: { type: 'string' } },
    },
    required: ['verdict', 'problem', 'competitors', 'demand_signals', 'summary', 'sources'],
  },
  schema: validationArgs,
  category: 'validation',
  risk: 'high',
  costCredits: 0,
  rubric: ['At least 3 competitors or substitutes', 'Demand signals are real and sourced', 'Verdict follows from evidence'],
  failureConditions: ['No sources', 'Verdict contradicts the evidence'],
  available: (ctx) => ctx.company.config.validation.required && ctx.company.config.validation.status === 'pending',
  precondition: (_ctx, a) =>
    a.sources.length === 0 ? { ok: false, reason: 'a validation report needs at least one source' } : { ok: true },
  preview: (a) => ({
    title: `Idea validation: ${a.verdict.replace('_', ' ')}`,
    summary: `${a.summary}\n\nCompetitors: ${a.competitors.join('; ')}\nDemand: ${a.demand_signals.join('; ')}`,
  }),
  async execute(ctx, a) {
    const company = ctx.db.companies.get(ctx.companyId)!;
    const evidence = [
      `Verdict: ${a.verdict}`,
      `Problem: ${a.problem}`,
      `Competitors: ${a.competitors.join('; ')}`,
      `Demand signals: ${a.demand_signals.join('; ')}`,
      `Summary: ${a.summary}`,
      `Sources: ${a.sources.join(' ')}`,
    ].join('\n');
    ctx.db.companies.updateConfig(
      ctx.companyId,
      { ...company.config, validation: { ...company.config.validation, status: 'passed', evidence: evidence.slice(0, 6_000) } },
      'agent',
      'owner accepted the validation report',
      ctx.now(),
    );
    await ctx.knowledge.add(ctx.companyId, {
      content: `Validation (${a.verdict}): ${a.summary}`,
      category: 'validation',
      source: a.sources[0] ?? 'researcher',
      sourceRunId: ctx.runId,
      confidence: 0.8,
    });
    return { ok: true, content: 'Validation accepted by the owner — build roles are unlocked.', stateChange: true };
  },
};

// ── config + pricing proposals ─────────────────────────────────────────────

// Owner-only fields (autonomy, budgets, channels, limits, models, …) are not
// in this enum: agents have no path to change their own guardrails.
const PROPOSABLE = ['mission', 'brandVoice', 'icp', 'valueProp', 'niche', 'goals', 'brandDos', 'brandDonts'] as const;
const LIST_FIELDS = new Set(['goals', 'brandDos', 'brandDonts']);

const configArgs = z.object({
  field: z.enum(PROPOSABLE),
  value: z.union([z.string().min(1).max(1_500), z.array(z.string().min(1).max(300)).min(1).max(10)]),
  rationale: z.string().min(10).max(1_000),
});

export const configProposeChange: Skill<z.infer<typeof configArgs>> = {
  key: 'config.propose_change',
  toolName: skillToolName('config.propose_change'),
  name: 'Propose a company-config change',
  description:
    'Propose changing the single source of truth (mission, voice, ICP, value prop, niche, goals, brand dos/donts) with evidence. Applied only after the owner approves or an objection window passes.',
  parameters: {
    type: 'object',
    properties: {
      field: { type: 'string', enum: [...PROPOSABLE] },
      value: {
        description: 'New value (string, or array of strings for goals / brandDos / brandDonts)',
        anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
      },
      rationale: { type: 'string' },
    },
    required: ['field', 'value', 'rationale'],
  },
  schema: configArgs,
  category: 'config_edit',
  risk: 'medium',
  costCredits: 0,
  rubric: ['Change is backed by observed evidence', 'Does not contradict the mission'],
  failureConditions: ['Change driven by one anecdote'],
  precondition: (_ctx, a) =>
    LIST_FIELDS.has(a.field) === Array.isArray(a.value)
      ? { ok: true }
      : { ok: false, reason: `${a.field} expects ${LIST_FIELDS.has(a.field) ? 'a list of strings' : 'a string'}` },
  preview: (a) => ({
    title: `Change ${a.field}`,
    summary: `${Array.isArray(a.value) ? a.value.join('; ') : a.value}\n\nWhy: ${a.rationale}`,
  }),
  async execute(ctx, a) {
    const company = ctx.db.companies.get(ctx.companyId)!;
    const next = companyConfigSchema.parse({ ...company.config, [a.field]: a.value });
    const updated = ctx.db.companies.updateConfig(ctx.companyId, next, 'agent', `${a.field}: ${a.rationale}`, ctx.now());
    return { ok: true, content: `Config updated to version ${updated.activeConfigVersion} (${a.field}).`, stateChange: true };
  },
};

const pricingArgs = z.object({
  price_points: z.array(z.string().min(1).max(200)).min(1).max(10),
  rationale: z.string().min(10).max(1_000),
});

export const pricingProposeChange: Skill<z.infer<typeof pricingArgs>> = {
  key: 'pricing.propose_change',
  toolName: skillToolName('pricing.propose_change'),
  name: 'Propose new pricing',
  description:
    'Propose new price points / pricing claims. Always requires the owner; when approved the company config is updated so every agent uses the new prices.',
  parameters: {
    type: 'object',
    properties: {
      price_points: { type: 'array', items: { type: 'string' }, description: 'e.g. "Starter $9/mo — 10k pageviews"' },
      rationale: { type: 'string' },
    },
    required: ['price_points', 'rationale'],
  },
  schema: pricingArgs,
  category: 'pricing',
  risk: 'high',
  costCredits: 0,
  rubric: ['Grounded in competitor pricing or customer data', 'Impact on existing customers considered'],
  failureConditions: ['No evidence for the change'],
  preview: (a) => ({ title: 'Change pricing', summary: `${a.price_points.join('\n')}\n\nWhy: ${a.rationale}` }),
  async execute(ctx, a) {
    const company = ctx.db.companies.get(ctx.companyId)!;
    ctx.db.companies.updateConfig(
      ctx.companyId,
      { ...company.config, pricePoints: a.price_points },
      'agent',
      `pricing: ${a.rationale}`,
      ctx.now(),
    );
    return { ok: true, content: 'Pricing updated in the company config.', stateChange: true };
  },
};

// ── sandboxed JS ────────────────────────────────────────────────────────────

const runJsArgs = z.object({ source: z.string().min(1).max(20_000) });

export const codeRunJs: Skill<z.infer<typeof runJsArgs>> = {
  key: 'code.run_js',
  toolName: skillToolName('code.run_js'),
  name: 'Run JavaScript in a sandbox',
  description:
    'Evaluate JavaScript in an isolated sandbox (no network, no filesystem, 5s limit) to check logic. console.log output and the returned value come back.',
  parameters: { type: 'object', properties: { source: { type: 'string' } }, required: ['source'] },
  schema: runJsArgs,
  category: 'internal',
  risk: 'low',
  costCredits: 0,
  rubric: ['Used to verify, not to guess'],
  failureConditions: ['Timeout', 'Exception'],
  preview: (a) => ({ title: 'Run JS', summary: a.source.slice(0, 300) }),
  async execute(_ctx, a) {
    const vm = await import('node:vm');
    const logs: string[] = [];
    const fmt = (x: unknown): string => (typeof x === 'string' ? x : JSON.stringify(x));
    const sandbox = {
      console: { log: (...xs: unknown[]) => logs.push(xs.map(fmt).join(' ')) },
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
    };
    try {
      const script = new vm.Script(`(async () => { ${a.source}\n })()`);
      const value = await Promise.race([
        script.runInContext(vm.createContext(sandbox), { timeout: 5_000 }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 5s')), 5_200)),
      ]);
      return { ok: true, content: json({ logs: logs.slice(0, 100), result: value ?? null }) };
    } catch (err) {
      return { ok: false, content: `ERROR: ${err instanceof Error ? err.message : String(err)}\n${logs.join('\n')}` };
    }
  },
};

export const CORE_SKILLS: Skill[] = [
  knowledgeSearch,
  knowledgeSave,
  tasksCreate,
  draftSave,
  leadsSave,
  leadsList,
  ticketsList,
  ticketsUpdate,
  validationSubmit,
  configProposeChange,
  pricingProposeChange,
  codeRunJs,
];
