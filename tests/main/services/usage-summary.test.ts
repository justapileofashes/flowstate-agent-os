import { describe, it, expect } from 'vitest';
import { summarizeUsage, type UsageLedgerRow } from '@main/services/usage-summary';

const row = (over: Partial<UsageLedgerRow>): UsageLedgerRow => ({
  chatId: 'c1',
  agentId: 'a1',
  model: 'llama3',
  promptTokens: 100,
  completionTokens: 50,
  costUsd: 0,
  at: Date.parse('2026-06-14T10:00:00Z'),
  ...over,
});

describe('summarizeUsage', () => {
  it('totals cost, calls, and tokens', () => {
    const s = summarizeUsage([row({ costUsd: 1 }), row({ costUsd: 2 })]);
    expect(s.totalUsd).toBe(3);
    expect(s.totalCalls).toBe(2);
    expect(s.totalTokens).toBe(300);
  });

  it('rolls up by agent, sorted by cost desc', () => {
    const s = summarizeUsage([
      row({ agentId: 'cheap', costUsd: 1 }),
      row({ agentId: 'pricey', costUsd: 5 }),
      row({ agentId: 'pricey', costUsd: 5 }),
    ]);
    expect(s.byAgent[0]!.agentId).toBe('pricey');
    expect(s.byAgent[0]!.costUsd).toBe(10);
    expect(s.byAgent[0]!.calls).toBe(2);
    expect(s.byAgent[1]!.agentId).toBe('cheap');
  });

  it('rolls up by model', () => {
    const s = summarizeUsage([
      row({ model: 'gpt-4o', costUsd: 3 }),
      row({ model: 'llama3', costUsd: 0 }),
    ]);
    expect(s.byModel[0]!.model).toBe('gpt-4o');
  });

  it('rolls up by UTC day, ascending', () => {
    const s = summarizeUsage([
      row({ at: Date.parse('2026-06-15T01:00:00Z'), costUsd: 2 }),
      row({ at: Date.parse('2026-06-14T23:00:00Z'), costUsd: 1 }),
    ]);
    expect(s.byDay.map((d) => d.day)).toEqual(['2026-06-14', '2026-06-15']);
    expect(s.byDay[0]!.costUsd).toBe(1);
  });

  it('handles an empty ledger', () => {
    const s = summarizeUsage([]);
    expect(s).toEqual({ totalUsd: 0, totalCalls: 0, totalTokens: 0, byAgent: [], byModel: [], byDay: [] });
  });
});
