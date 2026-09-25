// Trader-node validation: "reasoning stops; software acts". Every numeric
// field of an approved trade is checked against a schema before an order can
// be created. Failure aborts the trade (and the tick) — no order is sent.

import { z } from 'zod';
import { TIMEFRAMES } from '@shared/trader/types';
import type { ApprovedTrade } from './types';

const finitePos = z.number().finite().positive();

export const approvedTradeSchema = z
  .object({
    signalId: z.string().min(1).max(64),
    symbol: z.string().min(1).max(16),
    side: z.enum(['long', 'short']),
    qty: finitePos,
    entry: finitePos,
    stop: finitePos,
    takeProfit: finitePos,
    timeframe: z.enum(TIMEFRAMES),
    maxHoldBars: z.number().int().min(0).max(10_000),
    expiresAt: z.number().int().positive(),
    modelVersion: z.string().max(120).nullable(),
    strategyId: z.string().max(64).nullable(),
  })
  .superRefine((t, ctx) => {
    if (t.stop === t.entry) ctx.addIssue({ code: 'custom', message: 'stop equals entry' });
    if (t.side === 'long' && !(t.stop < t.entry)) ctx.addIssue({ code: 'custom', message: 'long stop must be below entry' });
    if (t.side === 'long' && !(t.takeProfit > t.entry)) ctx.addIssue({ code: 'custom', message: 'long take-profit must be above entry' });
    if (t.side === 'short' && !(t.stop > t.entry)) ctx.addIssue({ code: 'custom', message: 'short stop must be above entry' });
    if (t.side === 'short' && !(t.takeProfit < t.entry)) ctx.addIssue({ code: 'custom', message: 'short take-profit must be below entry' });
    if (Math.abs(t.entry - t.stop) / t.entry > 0.5) ctx.addIssue({ code: 'custom', message: 'stop is more than 50% away from entry' });
  });

export function validateApprovedTrade(t: ApprovedTrade, now: number): { ok: true; trade: ApprovedTrade } | { ok: false; error: string } {
  const parsed = approvedTradeSchema.safeParse(t);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'trade'}: ${i.message}`).join('; ') };
  if (t.expiresAt <= now) return { ok: false, error: 'expiry is in the past' };
  if (t.expiresAt > now + 7 * 86_400_000) return { ok: false, error: 'expiry is more than 7 days out' };
  if (t.symbol.includes('/') ? false : !Number.isInteger(t.qty)) return { ok: false, error: 'equity quantity must be whole shares' };
  return { ok: true, trade: t };
}
