import { describe, it, expect } from 'vitest';
import { buildRunBundle } from '@main/services/run-export';

const input = {
  chat: { id: 'chat-1', title: 'Fix login bug', createdAt: 1765500000000 },
  agent: { id: 'agent-code-helper', name: 'Code Helper', model: 'qwen2.5-coder:14b' },
  messages: [
    { role: 'user' as const, content: 'fix the login bug', createdAt: 1765500001000 },
    {
      role: 'assistant' as const,
      content: 'Found it — token expiry used < instead of <=.',
      createdAt: 1765500002000,
      toolCalls: [{ id: 't1', name: 'read_file', args: { path: 'auth.ts' } }],
    },
    {
      role: 'tool' as const,
      content: 'x'.repeat(9000),
      toolName: 'read_file',
      createdAt: 1765500001500,
    },
  ],
  audit: [
    {
      id: 'a1',
      ts: 1765500001500,
      agentId: 'agent-code-helper',
      chatId: 'chat-1',
      streamId: 's1',
      eventType: 'tool_call' as const,
      toolName: 'read_file',
      decision: null,
      ok: true,
      durationMs: 12,
      argSummary: '{"path":"auth.ts"}',
      detail: null,
    },
  ],
};

describe('buildRunBundle', () => {
  it('includes metadata, transcript, and audit trail', () => {
    const md = buildRunBundle(input);
    expect(md).toContain('Fix login bug');
    expect(md).toContain('Code Helper');
    expect(md).toContain('qwen2.5-coder:14b');
    expect(md).toContain('fix the login bug');
    expect(md).toContain('token expiry');
    expect(md).toContain('read_file');
    expect(md).toContain('12'); // duration
  });

  it('labels roles and tool calls in the transcript', () => {
    const md = buildRunBundle(input);
    expect(md).toMatch(/## Transcript/);
    expect(md).toMatch(/\*\*User\*\*/);
    expect(md).toMatch(/\*\*Code Helper\*\*/);
    expect(md).toContain('→ read_file'); // tool call marker
  });

  it('clips giant tool outputs', () => {
    const md = buildRunBundle(input);
    expect(md.length).toBeLessThan(9000);
    expect(md).toContain('[truncated');
  });

  it('renders an empty audit section gracefully', () => {
    const md = buildRunBundle({ ...input, audit: [] });
    expect(md).toMatch(/## Audit trail/);
    expect(md).toContain('No audit entries');
  });

  it('uses ISO timestamps, not epoch millis, in headers', () => {
    const md = buildRunBundle(input);
    expect(md).toContain('2025-12-12'); // 1765500000000 → 2025-12-12 UTC
  });
});
