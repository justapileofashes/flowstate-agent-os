// Reproducible run export (roadmap 6c): bundle a chat run — metadata,
// transcript, tool calls, and the audit trail — into a single shareable
// markdown document. Pure builder; file writing happens in the IPC handler.

import type { AuditEntryDto } from '@shared/ipc-channels';

export interface RunExportMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
  toolCalls?: Array<{ id: string; name: string; args?: unknown }>;
  toolName?: string;
}

export interface RunExportInput {
  chat: { id: string; title: string; createdAt: number };
  agent: { id: string; name: string; model: string };
  messages: RunExportMessage[];
  audit: AuditEntryDto[];
}

const MAX_TOOL_OUTPUT = 1200;

export function buildRunBundle(input: RunExportInput): string {
  const { chat, agent, messages, audit } = input;
  const lines: string[] = [];

  lines.push(`# Run export — ${chat.title || chat.id}`);
  lines.push('');
  lines.push(`- **Agent:** ${agent.name} (\`${agent.id}\`)`);
  lines.push(`- **Model:** ${agent.model}`);
  lines.push(`- **Chat started:** ${iso(chat.createdAt)}`);
  lines.push(`- **Exported:** ${iso(Date.now())}`);
  lines.push(`- **Messages:** ${messages.length} · **Audit entries:** ${audit.length}`);
  lines.push('');

  lines.push('## Transcript');
  lines.push('');
  for (const m of messages) {
    if (m.role === 'system') continue; // internal framing, not run history
    if (m.role === 'tool') {
      lines.push(`> ⚙ **${m.toolName ?? 'tool'}** output (${iso(m.createdAt)}):`);
      lines.push('>');
      lines.push(quote(clip(m.content)));
      lines.push('');
      continue;
    }
    const who = m.role === 'user' ? '**User**' : `**${agent.name}**`;
    lines.push(`${who} · ${iso(m.createdAt)}`);
    lines.push('');
    lines.push(m.content.trim());
    for (const call of m.toolCalls ?? []) {
      lines.push('');
      lines.push(`→ ${call.name} \`${clipInline(safeJson(call.args))}\``);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## Audit trail');
  lines.push('');
  if (audit.length === 0) {
    lines.push('No audit entries for this chat.');
  } else {
    lines.push('| time | event | tool | decision | ok | ms | args |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const a of audit) {
      lines.push(
        `| ${iso(a.ts)} | ${a.eventType} | ${a.toolName ?? ''} | ${a.decision ?? ''} | ${
          a.ok === null ? '' : a.ok ? '✓' : '✗'
        } | ${a.durationMs ?? ''} | ${escapeCell(clipInline(a.argSummary ?? ''))} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

function iso(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function clip(s: string): string {
  return s.length > MAX_TOOL_OUTPUT
    ? s.slice(0, MAX_TOOL_OUTPUT) + `\n[truncated — ${s.length} chars total]`
    : s;
}

function clipInline(s: string): string {
  return s.length > 120 ? s.slice(0, 119) + '…' : s;
}

function quote(s: string): string {
  return s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '[unserializable]';
  }
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
