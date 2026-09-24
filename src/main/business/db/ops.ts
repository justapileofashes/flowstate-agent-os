// Operational tables: audit log (every write), cron leases (no overlapping
// jobs), notifications, the live feed, and CEO chat sessions.

import type { Database } from 'better-sqlite3';
import type { ChatMessageDto, ChatSessionDto, FeedEventDto, FeedKind } from '@shared/business/types';
import { parseJson, uid, type Row } from './util';

export interface CronStateRow {
  jobName: string;
  companyId: string | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lockHolder: string | null;
  lockExpiresAt: number | null;
  succeeded: boolean | null;
  lastError: string | null;
}

function mapCron(r: Row): CronStateRow {
  return {
    jobName: r.job_name,
    companyId: r.company_id ?? null,
    lastRunAt: r.last_run_at ?? null,
    nextRunAt: r.next_run_at ?? null,
    lockHolder: r.lock_holder ?? null,
    lockExpiresAt: r.lock_expires_at ?? null,
    succeeded: r.succeeded === null || r.succeeded === undefined ? null : r.succeeded === 1,
    lastError: r.last_error ?? null,
  };
}

export interface AuditEntry {
  id: string;
  companyId: string | null;
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export class OpsRepo {
  private feedWrites = 0;

  constructor(private readonly db: Database) {}

  // ── audit ───────────────────────────────────────────────────────────────

  audit(input: Omit<AuditEntry, 'id' | 'createdAt' | 'metadata'> & { metadata?: Record<string, unknown>; now?: number }): void {
    this.db
      .prepare(
        `INSERT INTO biz_audit (id, company_id, actor_type, actor_id, action, resource_type, resource_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uid(),
        input.companyId,
        input.actorType,
        input.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        JSON.stringify(input.metadata ?? {}).slice(0, 4_000),
        input.now ?? Date.now(),
      );
  }

  auditLog(companyId: string, limit = 200): AuditEntry[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_audit WHERE company_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
        .all(companyId, limit) as Row[]
    ).map((r) => ({
      id: r.id,
      companyId: r.company_id ?? null,
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      resourceType: r.resource_type,
      resourceId: r.resource_id ?? null,
      metadata: parseJson<Record<string, unknown>>(r.metadata, {}),
      createdAt: r.created_at,
    }));
  }

  // ── cron leases ─────────────────────────────────────────────────────────

  cronState(jobName: string): CronStateRow | null {
    const r = this.db.prepare('SELECT * FROM biz_cron_state WHERE job_name = ?').get(jobName) as Row | undefined;
    return r ? mapCron(r) : null;
  }

  cronStates(companyId: string): CronStateRow[] {
    return (this.db.prepare('SELECT * FROM biz_cron_state WHERE company_id = ?').all(companyId) as Row[]).map(mapCron);
  }

  ensureCron(jobName: string, companyId: string | null, nextRunAt: number): CronStateRow {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO biz_cron_state (job_name, company_id, next_run_at) VALUES (?, ?, ?)',
      )
      .run(jobName, companyId, nextRunAt);
    return this.cronState(jobName)!;
  }

  setNextRun(jobName: string, nextRunAt: number): void {
    this.db.prepare('UPDATE biz_cron_state SET next_run_at = ? WHERE job_name = ?').run(nextRunAt, jobName);
  }

  /** Atomically take the lease; false if another holder's lease is live. */
  acquireLease(jobName: string, holder: string, ttlMs: number, now = Date.now()): boolean {
    const res = this.db
      .prepare(
        `UPDATE biz_cron_state SET lock_holder = ?, lock_expires_at = ?
         WHERE job_name = ? AND (lock_holder IS NULL OR lock_expires_at IS NULL OR lock_expires_at < ?)`,
      )
      .run(holder, now + ttlMs, jobName, now);
    return res.changes === 1;
  }

  releaseLease(
    jobName: string,
    holder: string,
    outcome: { ranAt: number; nextRunAt: number; succeeded: boolean; error?: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE biz_cron_state SET lock_holder = NULL, lock_expires_at = NULL, last_run_at = ?, next_run_at = ?,
           succeeded = ?, last_error = ? WHERE job_name = ? AND lock_holder = ?`,
      )
      .run(
        outcome.ranAt,
        outcome.nextRunAt,
        outcome.succeeded ? 1 : 0,
        outcome.error ? outcome.error.slice(0, 500) : null,
        jobName,
        holder,
      );
  }

  deleteCronForCompany(companyId: string): void {
    this.db.prepare('DELETE FROM biz_cron_state WHERE company_id = ?').run(companyId);
  }

  deleteCron(jobName: string): void {
    this.db.prepare('DELETE FROM biz_cron_state WHERE job_name = ?').run(jobName);
  }

  // ── notifications ───────────────────────────────────────────────────────

  notification(input: {
    companyId: string | null;
    channel: 'desktop' | 'slack' | 'email' | 'feed';
    templateKey: string;
    payload: Record<string, unknown>;
    status: 'queued' | 'sent' | 'failed' | 'skipped';
    now?: number;
  }): void {
    const now = input.now ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO biz_notifications (id, company_id, channel, template_key, payload, status, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uid(),
        input.companyId,
        input.channel,
        input.templateKey,
        JSON.stringify(input.payload).slice(0, 4_000),
        input.status,
        now,
        input.status === 'sent' ? now : null,
      );
  }

  lastNotification(companyId: string, templateKey: string): number | null {
    const r = this.db
      .prepare('SELECT MAX(created_at) AS t FROM biz_notifications WHERE company_id = ? AND template_key = ?')
      .get(companyId, templateKey) as { t: number | null };
    return r.t;
  }

  // ── feed ────────────────────────────────────────────────────────────────

  pushFeed(e: Omit<FeedEventDto, 'id' | 'ts'> & { ts?: number }, cap: number): FeedEventDto {
    const ev: FeedEventDto = {
      id: uid(),
      companyId: e.companyId,
      cycleId: e.cycleId,
      runId: e.runId,
      role: e.role,
      kind: e.kind,
      text: e.text.slice(0, 1_000),
      ...(e.credits !== undefined ? { credits: e.credits } : {}),
      ts: e.ts ?? Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO biz_feed (id, company_id, cycle_id, run_id, role, kind, text, credits, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ev.id, ev.companyId, ev.cycleId, ev.runId, ev.role, ev.kind, ev.text, ev.credits ?? null, ev.ts);
    // Trim every 50 inserts rather than on every write.
    this.feedWrites += 1;
    if (this.feedWrites % 50 === 0) {
      this.db
        .prepare(
          `DELETE FROM biz_feed WHERE company_id = ? AND id NOT IN (
             SELECT id FROM biz_feed WHERE company_id = ? ORDER BY ts DESC LIMIT ?)`,
        )
        .run(e.companyId, e.companyId, cap);
    }
    return ev;
  }

  feed(companyId: string, limit = 300): FeedEventDto[] {
    const rows = this.db
      .prepare('SELECT * FROM biz_feed WHERE company_id = ? ORDER BY ts DESC, rowid DESC LIMIT ?')
      .all(companyId, limit) as Row[];
    return rows
      .map((r) => ({
        id: r.id,
        companyId: r.company_id,
        cycleId: r.cycle_id ?? null,
        runId: r.run_id ?? null,
        role: r.role ?? null,
        kind: r.kind as FeedKind,
        text: r.text,
        ...(r.credits !== null && r.credits !== undefined ? { credits: r.credits as number } : {}),
        ts: r.ts,
      }))
      .reverse();
  }

  // ── chat ────────────────────────────────────────────────────────────────

  createChatSession(companyId: string, title: string, now = Date.now()): ChatSessionDto {
    const id = uid();
    this.db
      .prepare('INSERT INTO biz_chat_sessions (id, company_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, companyId, title.slice(0, 120), now, now);
    return { id, companyId, title: title.slice(0, 120), createdAt: now, updatedAt: now };
  }

  chatSession(companyId: string, id: string): ChatSessionDto | null {
    const r = this.db
      .prepare('SELECT * FROM biz_chat_sessions WHERE id = ? AND company_id = ?')
      .get(id, companyId) as Row | undefined;
    return r
      ? { id: r.id, companyId: r.company_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }
      : null;
  }

  chatSessions(companyId: string): ChatSessionDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_chat_sessions WHERE company_id = ? ORDER BY updated_at DESC LIMIT 50')
        .all(companyId) as Row[]
    ).map((r) => ({ id: r.id, companyId: r.company_id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  addChatMessage(sessionId: string, role: 'user' | 'assistant', content: string, runId: string | null, now = Date.now()): ChatMessageDto {
    const id = uid();
    this.db
      .prepare('INSERT INTO biz_chat_messages (id, session_id, role, content, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, sessionId, role, content.slice(0, 20_000), runId, now);
    this.db.prepare('UPDATE biz_chat_sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);
    return { id, sessionId, role, content: content.slice(0, 20_000), runId, createdAt: now };
  }

  chatMessages(sessionId: string, limit = 200): ChatMessageDto[] {
    return (
      this.db
        .prepare('SELECT * FROM biz_chat_messages WHERE session_id = ? ORDER BY created_at, rowid LIMIT ?')
        .all(sessionId, limit) as Row[]
    ).map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      runId: r.run_id ?? null,
      createdAt: r.created_at,
    }));
  }
}
