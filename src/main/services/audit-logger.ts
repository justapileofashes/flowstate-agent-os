// Best-effort audit logger. Wraps AuditRepository with event-shaped helpers and
// NEVER throws — recording must not break an agent run. Arg summaries are
// redacted so secrets and large blobs never land in the log.

import type { AuditRepository } from '@main/repos/audit-repository';
import { redactSensitive } from './redaction';

export interface AuditContext {
  agentId: string;
  chatId?: string | null;
  streamId?: string | null;
}

// Fields whose values are content blobs or secrets — replaced with a size hint.
const REDACT_KEYS = new Set([
  'content',
  'source',
  'body',
  'text',
  'token',
  'secret',
  'password',
  'apiKey',
  'api_key',
]);
const MAX_VALUE_LEN = 120;
const MAX_SUMMARY_LEN = 300;

/** One-line, redacted summary of tool args safe to persist. */
export function summarizeArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args !== 'object') return truncate(String(args));
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (REDACT_KEYS.has(key)) {
      const len = typeof value === 'string' ? value.length : 0;
      parts.push(`${key}=<${len} chars>`);
      continue;
    }
    if (typeof value === 'string') {
      parts.push(`${key}=${redactSensitive(truncate(value))}`);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`${key}=${value}`);
    } else if (Array.isArray(value)) {
      parts.push(`${key}=[${value.length}]`);
    } else if (value && typeof value === 'object') {
      parts.push(`${key}={…}`);
    }
  }
  return truncate(parts.join(' '), MAX_SUMMARY_LEN);
}

function truncate(s: string, max = MAX_VALUE_LEN): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max) + '…';
}

export class AuditLogger {
  constructor(private readonly repo: AuditRepository) {}

  toolCall(
    ctx: AuditContext,
    opts: {
      toolName: string;
      args: unknown;
      ok: boolean;
      durationMs: number;
      detail?: string;
    },
  ): void {
    this.safe(() =>
      this.repo.append({
        agentId: ctx.agentId,
        chatId: ctx.chatId ?? null,
        streamId: ctx.streamId ?? null,
        eventType: 'tool_call',
        toolName: opts.toolName,
        ok: opts.ok,
        durationMs: opts.durationMs,
        argSummary: summarizeArgs(opts.args),
        detail: opts.detail ?? null,
      }),
    );
  }

  approval(
    ctx: AuditContext,
    opts: { toolName: string; decision: string; args?: unknown; detail?: string },
  ): void {
    this.safe(() =>
      this.repo.append({
        agentId: ctx.agentId,
        chatId: ctx.chatId ?? null,
        streamId: ctx.streamId ?? null,
        eventType: 'approval',
        toolName: opts.toolName,
        decision: opts.decision,
        argSummary: opts.args === undefined ? null : summarizeArgs(opts.args),
        detail: opts.detail ?? null,
      }),
    );
  }

  rollback(ctx: AuditContext, opts: { detail: string }): void {
    this.safe(() =>
      this.repo.append({
        agentId: ctx.agentId,
        chatId: ctx.chatId ?? null,
        streamId: ctx.streamId ?? null,
        eventType: 'rollback',
        detail: opts.detail,
      }),
    );
  }

  checkpoint(ctx: AuditContext, opts: { toolName?: string; detail: string }): void {
    this.safe(() =>
      this.repo.append({
        agentId: ctx.agentId,
        chatId: ctx.chatId ?? null,
        streamId: ctx.streamId ?? null,
        eventType: 'checkpoint',
        toolName: opts.toolName ?? null,
        detail: opts.detail,
      }),
    );
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.warn('[flowstate] audit log write failed:', err);
    }
  }
}
