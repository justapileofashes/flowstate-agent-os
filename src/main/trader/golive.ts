// Go-live gate (spec Phase 5). Every item must be green before the app will
// even build a live broker adapter, and then the user still has to type the
// confirmation. Items are computed from real state, never self-reported.

import type { GoLiveDto, GoLiveItemDto, RiskConfig } from '@shared/trader/types';
import { GO_LIVE_LIMITS } from './config';

export interface GoLiveInputs {
  buildFlag: boolean;
  consent: boolean;
  paper: { firstActivityTs: number | null; closedTrades: number; maxDrawdownPct: number };
  risk: RiskConfig;
  killTestedAt: number | null;
  keys: { dataKeyId: string | null; liveKeyId: string | null; liveVerifiedAt: number | null };
  live: boolean;
  now: number;
}

export function goLiveChecklist(i: GoLiveInputs): GoLiveDto {
  const days = i.paper.firstActivityTs ? (i.now - i.paper.firstActivityTs) / 86_400_000 : 0;
  const items: GoLiveItemDto[] = [
    {
      key: 'build_flag',
      label: 'Live trading compiled in',
      ok: i.buildFlag,
      detail: i.buildFlag
        ? 'LIVE_TRADING_BUILD_ENABLED = true'
        : 'Set LIVE_TRADING_BUILD_ENABLED = true in src/main/trader/config.ts and rebuild (a deliberate code change).',
    },
    {
      key: 'consent',
      label: 'Risk disclosure accepted',
      ok: i.consent,
      detail: i.consent ? 'Accepted' : 'Accept the automated-trading disclosure first.',
    },
    {
      key: 'paper_history',
      label: `≥ ${GO_LIVE_LIMITS.minPaperDays} days of paper trading with acceptable stats`,
      ok: days >= GO_LIVE_LIMITS.minPaperDays && i.paper.closedTrades >= GO_LIVE_LIMITS.minPaperClosedTrades && i.paper.maxDrawdownPct <= i.risk.maxOpenDrawdownPct,
      detail: `${days.toFixed(1)} days, ${i.paper.closedTrades} closed trades (need ${GO_LIVE_LIMITS.minPaperClosedTrades}), max drawdown ${i.paper.maxDrawdownPct.toFixed(1)}% (limit ${i.risk.maxOpenDrawdownPct}%)`,
    },
    {
      key: 'risk_limits',
      label: 'Conservative risk limits',
      ok: i.risk.riskPerTradePct <= GO_LIVE_LIMITS.maxRiskPerTradePct && i.risk.dailyLossLimitPct <= GO_LIVE_LIMITS.maxDailyLossPct,
      detail: `risk/trade ${i.risk.riskPerTradePct}% (≤ ${GO_LIVE_LIMITS.maxRiskPerTradePct}%), daily loss ${i.risk.dailyLossLimitPct}% (≤ ${GO_LIVE_LIMITS.maxDailyLossPct}%)`,
    },
    {
      key: 'kill_switch_tested',
      label: 'Kill switch tested in the last 30 days',
      ok: i.killTestedAt !== null && i.now - i.killTestedAt <= GO_LIVE_LIMITS.killTestMaxAgeMs,
      detail: i.killTestedAt ? `last tested ${new Date(i.killTestedAt).toISOString().slice(0, 10)}` : 'Run "Test kill switch" in paper mode.',
    },
    {
      key: 'separate_keys',
      label: 'Separate market-data and trading keys',
      ok: Boolean(i.keys.dataKeyId) && Boolean(i.keys.liveKeyId) && i.keys.dataKeyId !== i.keys.liveKeyId,
      detail: !i.keys.dataKeyId ? 'Add a market-data key.' : i.keys.dataKeyId === i.keys.liveKeyId ? 'The data key must differ from the live trading key.' : 'Data and trading keys are separate.',
    },
    {
      key: 'live_keys',
      label: 'Live trading key verified',
      ok: Boolean(i.keys.liveKeyId) && i.keys.liveVerifiedAt !== null,
      detail: i.keys.liveKeyId ? (i.keys.liveVerifiedAt ? 'Verified against the live account' : 'Test the live key.') : 'Add a live trading key.',
    },
  ];
  return { items, ready: items.every((x) => x.ok), live: i.live };
}
