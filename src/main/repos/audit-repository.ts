import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { AuditEntryDto, AuditEventType } from '@shared/ipc-channels';

export interface AppendAuditInput {
  agentId: string;
  eventType: AuditEventType;
  chatId?: string | null;
  streamId?: string | null;
  toolName?: string | null;
  decision?: string | null;
  ok?: boolean | null;
  durationMs?: number | null;
  argSummary?: string | null;
  detail?: string | null;
}

export interface AuditListFilter {
  agentId?: string;
  chatId?: string;
  limit?: number;
}

interface AuditDbRow {
  id: string;
  ts: number;
  agent_id: string;
  chat_id: string | null;
  stream_id: string | null;
  event_type: string;
  tool_name: string | null;
  decision: string | null;
  ok: number | null;
  duration_ms: number | null;
  arg_summary: string | null;
  detail: string | null;
  created_at: number;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

export class AuditRepository {
  constructor(private readonly db: Database) {}

  append(input: AppendAuditInput): AuditEntryDto {
    const now = Date.now();
    const row: AuditDbRow = {
      id: randomUUID(),
      ts: now,
      agent_id: input.agentId,
      chat_id: input.chatId ?? null,
      stream_id: input.streamId ?? null,
      event_type: input.eventType,
      tool_name: input.toolName ?? null,
      decision: input.decision ?? null,
      ok: input.ok == null ? null : input.ok ? 1 : 0,
      duration_ms: input.durationMs ?? null,
      arg_summary: input.argSummary ?? null,
      detail: input.detail ?? null,
      created_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO audit_log
           (id, ts, agent_id, chat_id, stream_id, event_type, tool_name,
            decision, ok, duration_ms, arg_summary, detail, created_at)
         VALUES
           (@id, @ts, @agent_id, @chat_id, @stream_id, @event_type, @tool_name,
            @decision, @ok, @duration_ms, @arg_summary, @detail, @created_at)`,
      )
      .run(row);
    return toDto(row);
  }

  list(filter: AuditListFilter = {}): AuditEntryDto[] {
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const where: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (filter.agentId) {
      where.push('agent_id = @agentId');
      params.agentId = filter.agentId;
    }
    if (filter.chatId) {
      where.push('chat_id = @chatId');
      params.chatId = filter.chatId;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM audit_log ${clause} ORDER BY ts DESC LIMIT @limit`)
      .all(params) as AuditDbRow[];
    return rows.map(toDto);
  }

  count(filter: AuditListFilter = {}): number {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.agentId) {
      where.push('agent_id = @agentId');
      params.agentId = filter.agentId;
    }
    if (filter.chatId) {
      where.push('chat_id = @chatId');
      params.chatId = filter.chatId;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log ${clause}`)
      .get(params) as { n: number };
    return row.n;
  }

  /** Clear the log. Scope to an agent when agentId given; otherwise wipe all. */
  clear(filter: { agentId?: string } = {}): number {
    if (filter.agentId) {
      const res = this.db
        .prepare('DELETE FROM audit_log WHERE agent_id = ?')
        .run(filter.agentId);
      return res.changes;
    }
    const res = this.db.prepare('DELETE FROM audit_log').run();
    return res.changes;
  }
}

function toDto(row: AuditDbRow): AuditEntryDto {
  return {
    id: row.id,
    ts: row.ts,
    agentId: row.agent_id,
    chatId: row.chat_id,
    streamId: row.stream_id,
    eventType: row.event_type as AuditEventType,
    toolName: row.tool_name,
    decision: row.decision,
    ok: row.ok == null ? null : row.ok === 1,
    durationMs: row.duration_ms,
    argSummary: row.arg_summary,
    detail: row.detail,
  };
}
