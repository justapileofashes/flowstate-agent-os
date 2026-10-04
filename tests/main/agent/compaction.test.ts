import { describe, it, expect } from 'vitest';
import { applySummary, compactionCut, historyTokens } from '@main/agent/compaction';
import type { ConversationMessage } from '@main/agent/types';

const big = 'x'.repeat(4000); // ~1000 tokens

function chat(turns: number): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  for (let i = 0; i < turns; i++) {
    out.push({ role: 'user', content: `q${i} ${big}` });
    out.push({ role: 'assistant', content: '', toolCalls: [{ id: `c${i}`, name: 'read_file', args: { path: 'a' } }] });
    out.push({ role: 'tool', content: big, toolCallId: `c${i}`, toolName: 'read_file' });
    out.push({ role: 'assistant', content: `a${i}` });
  }
  return out;
}

describe('compactionCut', () => {
  it('no cut while the history fits', () => {
    expect(compactionCut(chat(2), 100_000)).toBe(0);
  });

  it('cuts before a user message, keeping roughly half the budget of recent turns', () => {
    const h = chat(10);
    const budget = 8000;
    const cut = compactionCut(h, budget);
    expect(cut).toBeGreaterThan(0);
    expect(h[cut]!.role).toBe('user');
    const kept = historyTokens(h.slice(cut));
    expect(kept).toBeGreaterThanOrEqual(budget / 2 - 2500);
    expect(kept).toBeLessThan(budget);
  });

  it('never separates a tool call from its result', () => {
    const h = chat(8);
    const cut = compactionCut(h, 5000);
    expect(h[cut]!.role).toBe('user');
    expect(h[cut - 1]!.toolCalls).toBeUndefined(); // the call before the cut already has its result
    const kept = h.slice(cut);
    for (const m of kept.filter((x) => x.role === 'tool')) {
      expect(kept.some((x) => x.toolCalls?.some((c) => c.id === m.toolCallId))).toBe(true);
    }
  });
});

describe('applySummary', () => {
  it('replaces the summarized prefix and keeps the system prompt', () => {
    const h: ConversationMessage[] = [{ role: 'system', content: 'sys' }, ...chat(3)];
    const out = applySummary(h, { count: 5, summary: 'did stuff' });
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]!.content).toContain('did stuff');
    expect(out.slice(3)).toEqual(h.slice(5));
  });
});
