// Single side-panel view rendered next to the conversation column.
// Each view kind ('preview' / 'changes' / 'terminal' / 'files' / 'tasks' /
// 'plan' / 'artifact') pulls its data from the chat message list and
// renders a self-contained pane with its own header + close button.

import { useState, type JSX } from 'react';
import type { MessageDto } from '@shared/chat-types';
import { MarkdownText } from './MarkdownText';
import type { ChatView } from './ViewsButton';

interface Props {
  view: ChatView;
  messages: MessageDto[];
  onClose: () => void;
}

export function ViewPanel({ view, messages, onClose }: Props): JSX.Element {
  return (
    <div className="flex flex-col h-full border-l border-[var(--border)] bg-[var(--bg)] min-w-[280px] max-w-[640px]">
      <header className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)]">
        <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-[var(--ink-muted)]">
          {viewLabel(view)}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close view"
          className="w-6 h-6 inline-flex items-center justify-center rounded text-[var(--ink-faint)] hover:text-[var(--ink)] hover:bg-[var(--surface)] transition-colors"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto">{renderBody(view, messages)}</div>
    </div>
  );
}

function viewLabel(v: ChatView): string {
  switch (v) {
    case 'preview':
      return 'Preview';
    case 'artifact':
      return 'Artifact';
    case 'changes':
      return 'Changes';
    case 'terminal':
      return 'Terminal';
    case 'files':
      return 'Files';
    case 'tasks':
      return 'Tasks';
    case 'plan':
      return 'Plan';
    default:
      return 'View';
  }
}

function renderBody(view: ChatView, messages: MessageDto[]): JSX.Element {
  if (view === 'preview') {
    const text = lastAssistantText(messages);
    if (!text) return <Empty label="No agent output yet." />;
    return (
      <article className="markdown text-sm px-4 py-3 max-w-prose">
        <MarkdownText>{text}</MarkdownText>
      </article>
    );
  }

  if (view === 'artifact') {
    const art = extractLatestArtifact(messages);
    if (!art) return <Empty label="No HTML/SVG artifact. Ask the agent for ```html or ```svg." />;
    return (
      <iframe
        title="Artifact preview"
        sandbox="allow-scripts"
        srcDoc={wrapArtifact(art)}
        className="w-full h-full border-0 bg-[var(--bg)]"
      />
    );
  }

  if (view === 'changes') {
    const changes = extractFileChanges(messages);
    if (changes.length === 0)
      return <Empty label="No file changes in this session yet." />;
    return (
      <ul className="text-xs px-4 py-3 space-y-1">
        {changes.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <span
              className={`text-[10px] uppercase tracking-wide font-semibold w-14 ${
                c.op === 'delete' ? 'text-[var(--bad)]' : 'text-[var(--good)]'
              }`}
            >
              {c.op}
            </span>
            <code className="text-xs flex-1 min-w-0 truncate text-[var(--ink-muted)]">{c.path}</code>
            <span
              className={`text-[10px] ${
                c.status === 'failed'
                  ? 'text-[var(--bad)]'
                  : c.status === 'pending'
                    ? 'text-[var(--ink-faint)]'
                    : 'text-[var(--good)]'
              }`}
            >
              {c.status}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (view === 'terminal') {
    const runs = extractShellRuns(messages);
    if (runs.length === 0) return <Empty label="No shell commands have run." />;
    return (
      <div className="font-mono text-[11px] px-4 py-3 space-y-3">
        {runs.map((r) => (
          <div key={r.id} className="rounded border border-[var(--border)] overflow-hidden">
            <div className="bg-[var(--surface)] px-3 py-1.5 text-[var(--ink-muted)] border-b border-[var(--border)]">
              $ {r.command}
            </div>
            <pre className="bg-[var(--bg-elev)] px-3 py-2 text-[var(--ink-muted)] whitespace-pre-wrap break-all">
              {r.output}
            </pre>
          </div>
        ))}
      </div>
    );
  }

  if (view === 'files') {
    const paths = Array.from(
      new Set(extractFileChanges(messages).map((c) => c.path)),
    ).sort();
    if (paths.length === 0) return <Empty label="No files touched." />;
    return (
      <ul className="text-xs px-4 py-3 space-y-1 font-mono">
        {paths.map((p) => (
          <li key={p} className="text-[var(--ink-muted)]">
            {p}
          </li>
        ))}
      </ul>
    );
  }

  if (view === 'tasks') {
    const tasks = extractTasks(messages);
    if (tasks.length === 0) return <Empty label="No checklist items found." />;
    return (
      <ul className="text-sm px-4 py-3 space-y-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-start gap-2">
            <span className={t.done ? 'text-[var(--good)]' : 'text-[var(--ink-faint)]'}>
              {t.done ? '[x]' : '[ ]'}
            </span>
            <span className={t.done ? 'line-through text-[var(--ink-faint)]' : ''}>{t.text}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (view === 'plan') {
    return <PlanTabs messages={messages} />;
  }

  return <Empty label="View not implemented." />;
}

function Empty({ label }: { label: string }): JSX.Element {
  return <p className="text-xs text-[var(--ink-faint)] px-4 py-3">{label}</p>;
}

// ── Plan tabs (orchestrator + per-agent My plan blocks) ──────────────────

function PlanTabs({ messages }: { messages: MessageDto[] }): JSX.Element {
  const plans = extractPlans(messages);
  type TabId = 'orchestrator' | `agent-${number}`;
  const tabs: Array<{ id: TabId; label: string; body: string | null }> = [];
  tabs.push({ id: 'orchestrator', label: 'Orchestrator', body: plans.main });
  plans.perAgent.forEach((p, i) =>
    tabs.push({ id: `agent-${i}`, label: p.label, body: p.body }),
  );
  const [active, setActive] = useState<TabId>('orchestrator');
  const current = tabs.find((t) => t.id === active) ?? tabs[0]!;

  if (plans.main === null && plans.perAgent.length === 0) {
    return <Empty label="No plan detected. Try /plan." />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2 border-b border-[var(--border)] flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            className={`text-xs px-2.5 py-1.5 border-b-2 transition whitespace-nowrap ${
              active === t.id
                ? 'border-[var(--accent)] text-[var(--ink)]'
                : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {current.body ? (
          <article className="markdown text-sm">
            <MarkdownText>{current.body}</MarkdownText>
          </article>
        ) : (
          <Empty label="No plan from this agent yet." />
        )}
      </div>
    </div>
  );
}

// ── Extractors (mirror MessageList's logic) ──────────────────────────────

function lastAssistantText(messages: MessageDto[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'assistant' && m.content.trim().length > 0) return m.content;
  }
  return null;
}

interface Artifact {
  language: 'html' | 'svg';
  source: string;
}

function extractLatestArtifact(messages: MessageDto[]): Artifact | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    const fence = /```(html|svg)\s*\n([\s\S]*?)```/i.exec(m.content);
    if (fence) {
      return { language: fence[1]!.toLowerCase() as 'html' | 'svg', source: fence[2]!.trim() };
    }
    const t = m.content.trim();
    if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return { language: 'html', source: t };
    if (/^<svg[\s>]/i.test(t)) return { language: 'svg', source: t };
  }
  return null;
}

function wrapArtifact(art: Artifact): string {
  if (art.language === 'html') {
    if (/<!doctype/i.test(art.source) || /<html[\s>]/i.test(art.source)) return art.source;
    return `<!doctype html><html><head><meta charset="utf-8"/><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0e0d0c;color:#ece5d6;padding:1rem}</style></head><body>${art.source}</body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"/><style>html,body{margin:0;height:100%;background:#0e0d0c;display:flex;align-items:center;justify-content:center}svg{max-width:90%;max-height:90%}</style></head><body>${art.source}</body></html>`;
}

function extractFileChanges(messages: MessageDto[]): Array<{
  id: string;
  op: 'write' | 'delete';
  path: string;
  status: 'ok' | 'failed' | 'pending';
}> {
  const out: Array<{
    id: string;
    op: 'write' | 'delete';
    path: string;
    status: 'ok' | 'failed' | 'pending';
  }> = [];
  const results = new Map<string, MessageDto>();
  for (const m of messages) if (m.role === 'tool' && m.toolCallId) results.set(m.toolCallId, m);
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const call of m.toolCalls) {
      if (call.name !== 'write_file' && call.name !== 'delete_file') continue;
      const args = (call.args ?? {}) as { path?: unknown };
      if (typeof args.path !== 'string') continue;
      const result = results.get(call.id);
      const status: 'ok' | 'failed' | 'pending' = result
        ? result.content.startsWith('ERROR:')
          ? 'failed'
          : 'ok'
        : 'pending';
      out.push({
        id: call.id,
        op: call.name === 'write_file' ? 'write' : 'delete',
        path: args.path,
        status,
      });
    }
  }
  return out;
}

function extractShellRuns(messages: MessageDto[]): Array<{
  id: string;
  command: string;
  output: string;
}> {
  const calls = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const call of m.toolCalls) {
      if (call.name !== 'run_shell') continue;
      const args = (call.args ?? {}) as { command?: unknown };
      if (typeof args.command === 'string') calls.set(call.id, args.command);
    }
  }
  const out: Array<{ id: string; command: string; output: string }> = [];
  for (const m of messages) {
    if (m.role !== 'tool' || !m.toolCallId) continue;
    const cmd = calls.get(m.toolCallId);
    if (!cmd) continue;
    out.push({ id: m.toolCallId, command: cmd, output: m.content });
  }
  return out;
}

function extractTasks(
  messages: MessageDto[],
): Array<{ id: string; text: string; done: boolean }> {
  const out: Array<{ id: string; text: string; done: boolean }> = [];
  const re = /^[\s>]*[-*]\s*\[( |x|X)\]\s+(.+)$/gm;
  for (const m of messages) {
    if (!m.content) continue;
    let match: RegExpExecArray | null;
    while ((match = re.exec(m.content)) !== null) {
      out.push({
        id: `${m.id}-${match.index}`,
        done: match[1] !== ' ',
        text: match[2]!.trim(),
      });
    }
  }
  return out;
}

interface ExtractedPlan {
  main: string | null;
  perAgent: Array<{ label: string; body: string }>;
}

function extractPlans(messages: MessageDto[]): ExtractedPlan {
  let main: string | null = null;
  const perAgent: Array<{ label: string; body: string }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'assistant') continue;
    if (/(?:^|\n)#+\s*plan\b/i.test(m.content) || /^[\s]*1[.)]\s+/m.test(m.content)) {
      main = m.content;
      break;
    }
  }
  let i = 0;
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const re = /(?:^|\n)#+\s*My plan([^\n]*)\n([\s\S]*?)(?=\n#+\s|\n$|$)/i;
    const match = re.exec(m.content);
    if (!match) continue;
    i += 1;
    perAgent.push({
      label: match[1]!.trim().length > 0 ? match[1]!.trim() : `Agent ${i}`,
      body: match[2]!.trim(),
    });
  }
  return { main, perAgent };
}
