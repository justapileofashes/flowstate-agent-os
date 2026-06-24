import { describe, it, expect } from 'vitest';
import { evaluateBudget } from '@main/services/budget';

describe('evaluateBudget', () => {
  it('is ok when well under caps', () => {
    expect(
      evaluateBudget({ chatSpentUsd: 0.1, dailySpentUsd: 1, caps: { perChatUsd: 5, perDayUsd: 20 } }).level,
    ).toBe('ok');
  });

  it('warns at 80% of a cap by default', () => {
    const v = evaluateBudget({ chatSpentUsd: 4, dailySpentUsd: 0, caps: { perChatUsd: 5 } });
    expect(v.level).toBe('warn');
    expect(v.scope).toBe('chat');
  });

  it('blocks at or over a cap', () => {
    const v = evaluateBudget({ chatSpentUsd: 0, dailySpentUsd: 20, caps: { perDayUsd: 20 } });
    expect(v.level).toBe('block');
    expect(v.scope).toBe('day');
    expect(v.message).toContain('$20.00');
  });

  it('block beats warn when both fire', () => {
    const v = evaluateBudget({
      chatSpentUsd: 4.5, // warn vs perChat 5
      dailySpentUsd: 20, // block vs perDay 20
      caps: { perChatUsd: 5, perDayUsd: 20 },
    });
    expect(v.level).toBe('block');
  });

  it('treats 0/undefined caps as unlimited', () => {
    expect(evaluateBudget({ chatSpentUsd: 999, dailySpentUsd: 999, caps: {} }).level).toBe('ok');
    expect(
      evaluateBudget({ chatSpentUsd: 999, dailySpentUsd: 0, caps: { perChatUsd: 0 } }).level,
    ).toBe('ok');
  });

  it('honors a custom warn ratio', () => {
    const v = evaluateBudget({
      chatSpentUsd: 5,
      dailySpentUsd: 0,
      caps: { perChatUsd: 10 },
      warnRatio: 0.5,
    });
    expect(v.level).toBe('warn');
  });
});
