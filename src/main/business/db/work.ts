// Work products: the task board, saved drafts (copy never auto-publishes),
// leads (SDR pipeline), support tickets, KPI snapshots, and the outbound log
// that backs dedupe ("no recipient emailed twice in 7 days") + daily caps.

import type { Database } from 'better-sqlite3';
import type {
  DraftDto,
  DraftKind,
  KpiDto,
  LeadDto,
  RiskLevel,
  RoleKey,
  TaskDto,
  TaskSource,
  TaskStatus,
  TicketDto,
} from '@shared/business/types';
import { buildUpdate, parseJson, startOfDay, uid, type Row } from './util';

function mapTask(r: Row): TaskDto {
  return {
    id: r.id,
    companyId: r.company_id,
    cycleId: r.cycle_id ?? null,
    title: r.title,
    description: r.description,
    assignedRole: r.assigned_role as RoleKey,
    priority: r.priority,
    status: r.status as TaskStatus,
    source: r.source as TaskSource,
    riskLevel: r.risk_level as RiskLevel,
    estimatedCredits: r.estimated_credits,
    approvalRequired: r.approval_required === 1,
    result: r.result ?? null,
    rejectedReason: r.rejected_reason ?? null,
    sourceRunId: r.source_run_id ?? null,
    dueAt: r.due_at ?? null,
    completedAt: r.completed_at ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDraft(r: Row): DraftDto {
  return {
    id: r.id,
    companyId: r.company_id,
    runId: r.run_id ?? null,
    kind: r.kind as DraftKind,
    channel: r.channel,
    title: r.title,
    body: r.body,
    meta: parseJson<Record<string, unknown>>(r.meta, {}),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapLead(r: Row): LeadDto {
  return {
    id: r.id,
    companyId: r.company_id,
    name: r.name,
    email: r.email,
    companyName: r.company_name,
    source: r.source,
    signal: r.signal,
    icpReason: r.icp_reason,
    status: r.status,
    lastContactedAt: r.last_contacted_at ?? null,
    createdAt: r.created_at,
  };
}

function mapTicket(r: Row): TicketDto {
  return {
    id: r.id,
    companyId: r.company_id,
    subject: r.subject,
    body: r.body,
    customer: r.customer,
    status: r.status,
    priority: r.priority,
    tags: parseJson<string[]>(r.tags, []),
    draftReplyId: r.draft_reply_id ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const TASK_COLUMNS: Record<string, string> = {
  title: 'title',
  description: 'description',
  assignedRole: 'assigned_role',
  priority: 'priority',
  status: 'status',
  riskLevel: 'risk_level',
  estimatedCredits: 'estimated_credits',
  approvalRequired: 'approval_required',
  result: 'result',
  rejectedReason: 'rejected_reason',
  cycleId: 'cycle_id',
  dueAt: 'due_at',
  completedAt: 'completed_at',
  updatedAt: 'updated_at',
};

export const OPEN_TASK_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'awaiting_approval'];

export class WorkRepo {
  constructor(private readonly db: Database) {}

  // ── tasks ───────────────────────────────────────────────────────────────

  createTask(input: {
    companyId: string;
    title: string;
    description?: string;
    assignedRole: RoleKey;
    priority?: number;
    status?: TaskStatus;
    source: TaskSource;
    riskLevel?: RiskLevel;
    estimatedCredits?: number;
    approvalRequired?: boolean;
    cycleId?: string | null;
    sourceRunId?: string | null;
    dueAt?: number | null;
    now?: number;
  }): TaskDto {
    const id = uid();
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO biz_tasks (id, company_id, cycle_id, title, description, assigned_role, priority, status,
           source, risk_level, estimated_credits, approval_required, source_run_id, due_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.cycleId ?? null,
        input.title.slice(0, 200),
        (input.description ?? '').slice(0, 4_000),
        input.assignedRole,
        Math.max(1, Math.min(5, Math.round(input.priority ?? 3))),
        input.status ?? 'backlog',
        input.source,
        input.riskLevel ?? 'low',
        input.estimatedCredits ?? 0,
        input.approvalRequired ? 1 : 0,
        input.sourceRunId ?? null,
        input.dueAt ?? null,
        now,
        now,
      );
    return this.getTask(id)!;
  }

  getTask(id: string, companyId?: string): TaskDto | null {
    const r = (
      companyId
        ? this.db.prepare('SELECT * FROM biz_tasks WHERE id = ? AND company_id = ?').get(id, companyId)
        : this.db.prepare('SELECT * FROM biz_tasks WHERE id = ?').get(id)
    ) as Row | undefined;
    return r ? mapTask(r) : null;
  }

  listTasks(companyId: string, opts: { statuses?: TaskStatus[]; limit?: number } = {}): TaskDto[] {
    const where = ['company_id = ?'];
    const args: unknown[] = [companyId];
    if (opts.statuses?.length) {
      where.push(`status IN (${opts.statuses.map(() => '?').join(',')})`);
      args.push(...opts.statuses);
    }
    args.push(opts.limit ?? 500);
    return (
      this.db
        .prepare(
          `SELECT * FROM biz_tasks WHERE ${where.join(' AND ')} ORDER BY priority ASC, created_at DESC LIMIT ?`,
        )
        .all(...args) as Row[]
    ).map(mapTask);
  }

  updateTask(
    companyId: string,
    id: string,
    patch: Partial<Omit<TaskDto, 'id' | 'companyId' | 'createdAt' | 'source' | 'sourceRunId'>>,
    now = Date.now(),
  ): TaskDto | null {
    const upd = buildUpdate('biz_tasks', 'id = ? AND company_id = ?', { ...patch, updatedAt: now }, TASK_COLUMNS);
    if (upd) this.db.prepare(upd.sql).run(...upd.values, id, companyId);
    return this.getTask(id, companyId);
  }

  deleteTask(companyId: string, id: string): void {
    this.db.prepare('DELETE FROM biz_tasks WHERE id = ? AND company_id = ?').run(id, companyId);
  }

  countTasks(companyId: string, statuses: TaskStatus[]): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM biz_tasks WHERE company_id = ? AND status IN (${statuses.map(() => '?').join(',')})`,
      )
      .get(companyId, ...statuses) as { n: number };
    return row.n;
  }

  // ── drafts ──────────────────────────────────────────────────────────────

  createDraft(input: {
    companyId: string;
    runId?: string | null;
    kind: DraftKind;
    channel?: string;
    title: string;
    body: string;
    meta?: Record<string, unknown>;
    now?: number;
  }): DraftDto {
    const id = uid();
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO biz_drafts (id, company_id, run_id, kind, channel, title, body, meta, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.runId ?? null,
        input.kind,
        input.channel ?? '',
        input.title.slice(0, 200),
        input.body.slice(0, 50_000),
        JSON.stringify(input.meta ?? {}),
        now,
        now,
      );
    return this.getDraft(input.companyId, id)!;
  }

  getDraft(companyId: string, id: string): DraftDto | null {
    const r = this.db
      .prepare('SELECT * FROM biz_drafts WHERE id = ? AND company_id = ?')
      .get(id, companyId) as Row | undefined;
    return r ? mapDraft(r) : null;
  }

  listDrafts(companyId: string, opts: { since?: number; limit?: number; status?: DraftDto['status'] } = {}): DraftDto[] {
    const where = ['company_id = ?'];
    const args: unknown[] = [companyId];
    if (opts.since) {
      where.push('created_at >= ?');
      args.push(opts.since);
    }
    if (opts.status) {
      where.push('status = ?');
      args.push(opts.status);
    }
    args.push(opts.limit ?? 200);
    return (
      this.db
        .prepare(`SELECT * FROM biz_drafts WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`)
        .all(...args) as Row[]
    ).map(mapDraft);
  }

  updateDraft(
    companyId: string,
    id: string,
    patch: Partial<Pick<DraftDto, 'title' | 'body' | 'status' | 'meta'>>,
    now = Date.now(),
  ): DraftDto | null {
    const upd = buildUpdate(
      'biz_drafts',
      'id = ? AND company_id = ?',
      { ...patch, updatedAt: now },
      { title: 'title', body: 'body', status: 'status', meta: 'meta', updatedAt: 'updated_at' },
    );
    if (upd) this.db.prepare(upd.sql).run(...upd.values, id, companyId);
    return this.getDraft(companyId, id);
  }

  countPublished(companyId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM biz_drafts WHERE company_id = ? AND status = 'published'")
      .get(companyId) as { n: number };
    return row.n;
  }

  // ── leads ───────────────────────────────────────────────────────────────

  upsertLead(input: {
    companyId: string;
    email: string;
    name?: string;
    companyName?: string;
    source?: string;
    signal?: string;
    icpReason?: string;
    status?: LeadDto['status'];
    now?: number;
  }): LeadDto {
    const email = input.email.trim().toLowerCase();
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO biz_leads (id, company_id, name, email, company_name, source, signal, icp_reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(company_id, email) DO UPDATE SET
           name = CASE WHEN excluded.name != '' THEN excluded.name ELSE biz_leads.name END,
           company_name = CASE WHEN excluded.company_name != '' THEN excluded.company_name ELSE biz_leads.company_name END,
           signal = CASE WHEN excluded.signal != '' THEN excluded.signal ELSE biz_leads.signal END,
           icp_reason = CASE WHEN excluded.icp_reason != '' THEN excluded.icp_reason ELSE biz_leads.icp_reason END,
           status = CASE WHEN biz_leads.status = 'unsubscribed' THEN 'unsubscribed' ELSE excluded.status END`,
      )
      .run(
        uid(),
        input.companyId,
        (input.name ?? '').slice(0, 120),
        email,
        (input.companyName ?? '').slice(0, 160),
        (input.source ?? '').slice(0, 300),
        (input.signal ?? '').slice(0, 1000),
        (input.icpReason ?? '').slice(0, 500),
        input.status ?? 'new',
        now,
      );
    return this.getLeadByEmail(input.companyId, email)!;
  }

  getLeadByEmail(companyId: string, email: string): LeadDto | null {
    const r = this.db
      .prepare('SELECT * FROM biz_leads WHERE company_id = ? AND email = ?')
      .get(companyId, email.trim().toLowerCase()) as Row | undefined;
    return r ? mapLead(r) : null;
  }

  listLeads(companyId: string, limit = 500): LeadDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_leads WHERE company_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(companyId, limit) as Row[]
    ).map(mapLead);
  }

  markLeadContacted(companyId: string, email: string, now = Date.now()): void {
    this.db
      .prepare(
        "UPDATE biz_leads SET last_contacted_at = ?, status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END WHERE company_id = ? AND email = ?",
      )
      .run(now, companyId, email.trim().toLowerCase());
  }

  setLeadStatus(companyId: string, id: string, status: LeadDto['status']): void {
    this.db.prepare('UPDATE biz_leads SET status = ? WHERE id = ? AND company_id = ?').run(status, id, companyId);
  }

  // ── tickets ─────────────────────────────────────────────────────────────

  createTicket(input: {
    companyId: string;
    subject: string;
    body?: string;
    customer?: string;
    priority?: TicketDto['priority'];
    now?: number;
  }): TicketDto {
    const id = uid();
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO biz_tickets (id, company_id, subject, body, customer, status, priority, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?, '[]', ?, ?)`,
      )
      .run(
        id,
        input.companyId,
        input.subject.slice(0, 200),
        (input.body ?? '').slice(0, 20_000),
        (input.customer ?? '').slice(0, 200),
        input.priority ?? 'normal',
        now,
        now,
      );
    return this.getTicket(input.companyId, id)!;
  }

  getTicket(companyId: string, id: string): TicketDto | null {
    const r = this.db
      .prepare('SELECT * FROM biz_tickets WHERE id = ? AND company_id = ?')
      .get(id, companyId) as Row | undefined;
    return r ? mapTicket(r) : null;
  }

  listTickets(companyId: string, opts: { status?: TicketDto['status']; limit?: number } = {}): TicketDto[] {
    const rows = opts.status
      ? this.db
          .prepare('SELECT * FROM biz_tickets WHERE company_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?')
          .all(companyId, opts.status, opts.limit ?? 200)
      : this.db
          .prepare('SELECT * FROM biz_tickets WHERE company_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(companyId, opts.limit ?? 200);
    return (rows as Row[]).map(mapTicket);
  }

  updateTicket(
    companyId: string,
    id: string,
    patch: Partial<Pick<TicketDto, 'status' | 'priority' | 'tags' | 'draftReplyId'>>,
    now = Date.now(),
  ): TicketDto | null {
    const upd = buildUpdate(
      'biz_tickets',
      'id = ? AND company_id = ?',
      { ...patch, updatedAt: now },
      {
        status: 'status',
        priority: 'priority',
        tags: 'tags',
        draftReplyId: 'draft_reply_id',
        updatedAt: 'updated_at',
      },
    );
    if (upd) this.db.prepare(upd.sql).run(...upd.values, id, companyId);
    return this.getTicket(companyId, id);
  }

  countOpenTickets(companyId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM biz_tickets WHERE company_id = ? AND status != 'closed'")
      .get(companyId) as { n: number };
    return row.n;
  }

  // ── KPIs ────────────────────────────────────────────────────────────────

  recordKpi(companyId: string, k: { key: string; value: number; unit?: string; source?: string }, now = Date.now()): void {
    this.db
      .prepare(
        'INSERT INTO biz_kpis (id, company_id, key, value, unit, source, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(uid(), companyId, k.key, k.value, k.unit ?? '', k.source ?? '', now);
  }

  /** Latest value per KPI key. */
  latestKpis(companyId: string): KpiDto[] {
    const rows = this.db
      .prepare(
        `SELECT k.* FROM biz_kpis k
         JOIN (SELECT key, MAX(captured_at) AS m FROM biz_kpis WHERE company_id = ? GROUP BY key) latest
           ON latest.key = k.key AND latest.m = k.captured_at
         WHERE k.company_id = ? ORDER BY k.key`,
      )
      .all(companyId, companyId) as Row[];
    const seen = new Set<string>();
    const out: KpiDto[] = [];
    for (const r of rows) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      out.push({ key: r.key, value: r.value, unit: r.unit, source: r.source, capturedAt: r.captured_at });
    }
    return out;
  }

  kpiHistory(companyId: string, key: string, limit = 30): KpiDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_kpis WHERE company_id = ? AND key = ? ORDER BY captured_at DESC LIMIT ?')
        .all(companyId, key, limit) as Row[]
    ).map((r) => ({ key: r.key, value: r.value, unit: r.unit, source: r.source, capturedAt: r.captured_at }));
  }

  // ── outbound log ────────────────────────────────────────────────────────

  logOutbound(companyId: string, channel: 'email' | 'social', recipient: string, refId: string | null, now = Date.now()): void {
    this.db
      .prepare(
        'INSERT INTO biz_outbound_log (id, company_id, channel, recipient, ref_id, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(uid(), companyId, channel, recipient.trim().toLowerCase(), refId, now);
  }

  lastContacted(companyId: string, recipient: string): number | null {
    const row = this.db
      .prepare('SELECT MAX(sent_at) AS t FROM biz_outbound_log WHERE company_id = ? AND recipient = ?')
      .get(companyId, recipient.trim().toLowerCase()) as { t: number | null };
    return row.t;
  }

  sentToday(companyId: string, channel: 'email' | 'social', now = Date.now()): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM biz_outbound_log WHERE company_id = ? AND channel = ? AND sent_at >= ?')
      .get(companyId, channel, startOfDay(now)) as { n: number };
    return row.n;
  }
}
