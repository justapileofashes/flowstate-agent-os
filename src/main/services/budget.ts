// Spend budget guard. Cloud models cost money; a dev wants a soft warning and a
// hard stop before a runaway agent burns the card. Pure decision function over
// current spend + caps. Caps of 0/undefined mean "no limit". The IPC layer reads
// real spend (usage repo) + caps (settings) and decides whether to block a send.

export interface BudgetCaps {
  /** USD ceiling for a single chat. 0/undefined = unlimited. */
  perChatUsd?: number;
  /** USD ceiling for all spend today. 0/undefined = unlimited. */
  perDayUsd?: number;
}

export interface BudgetInput {
  chatSpentUsd: number;
  dailySpentUsd: number;
  caps: BudgetCaps;
  /** Fraction of a cap at which we start warning. Default 0.8. */
  warnRatio?: number;
}

export interface BudgetVerdict {
  level: 'ok' | 'warn' | 'block';
  scope?: 'chat' | 'day';
  message?: string;
}

const fmt = (n: number): string => `$${n.toFixed(2)}`;

export function evaluateBudget(input: BudgetInput): BudgetVerdict {
  const warnRatio = clampRatio(input.warnRatio ?? 0.8);
  const checks: Array<{ scope: 'chat' | 'day'; spent: number; cap?: number; label: string }> = [
    { scope: 'chat', spent: input.chatSpentUsd, cap: input.caps.perChatUsd, label: 'this chat' },
    { scope: 'day', spent: input.dailySpentUsd, cap: input.caps.perDayUsd, label: 'today' },
  ];

  // Hard block wins over warn; check all caps for a block first.
  for (const c of checks) {
    if (c.cap && c.cap > 0 && c.spent >= c.cap) {
      return {
        level: 'block',
        scope: c.scope,
        message: `Budget reached for ${c.label}: ${fmt(c.spent)} of ${fmt(c.cap)}. Raise the cap in Settings to continue.`,
      };
    }
  }
  for (const c of checks) {
    if (c.cap && c.cap > 0 && c.spent >= c.cap * warnRatio) {
      return {
        level: 'warn',
        scope: c.scope,
        message: `Approaching budget for ${c.label}: ${fmt(c.spent)} of ${fmt(c.cap)}.`,
      };
    }
  }
  return { level: 'ok' };
}

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.8;
  return Math.max(0, Math.min(1, r));
}
