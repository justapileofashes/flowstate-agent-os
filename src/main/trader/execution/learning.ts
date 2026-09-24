// Learning loop on every closed trade: a deterministic post-mortem (what the
// entry snapshot says went wrong), strategy win/loss stats with automatic
// retirement on proven negative expectancy, and the replay buffer that the
// weekly micro-update trains on (Tickeron-style continuous learning).

import type { StrategyDto } from '@shared/trader/types';
import type { TradeRecord } from '../db/ledger';

export function writePostMortem(trade: TradeRecord, features: Record<string, number | string | null>, confidence: number | null): string {
  const pnl = trade.pnl ?? 0;
  if (pnl >= 0) {
    return `WIN ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} (${trade.exitReason ?? 'exit'}): plan executed — entry ${trade.entryPrice.toFixed(2)}, exit ${(trade.exitPrice ?? 0).toFixed(2)}. Keep the setup and the sizing.`;
  }
  const notes = [`LOSS ${pnl.toFixed(2)} on ${trade.symbol} (${trade.exitReason ?? 'exit'})`];
  if (trade.exitReason === 'stop') notes.push('stopped at the planned level — risk control worked; the read was wrong, not the exit');
  const regime = typeof features['regime'] === 'string' ? (features['regime'] as string) : '';
  if (trade.side === 'long' && regime.startsWith('trend_down')) notes.push('mistake: long against a down-trend regime');
  if (trade.side === 'short' && regime.startsWith('trend_up')) notes.push('mistake: short against an up-trend regime');
  if (regime.includes('high_vol')) notes.push('entered in a high-volatility regime — consider a strategy regime filter');
  if (confidence !== null && confidence < 0.66) notes.push(`entered at modest confidence ${confidence.toFixed(2)} — the threshold may be too low`);
  const roc = typeof features['roc_15'] === 'number' ? (features['roc_15'] as number) : null;
  if (roc !== null && trade.side === 'long' && roc < 0) notes.push('momentum (15-bar ROC) was negative at entry');
  if (trade.exitReason === 'time') notes.push('exited on the time stop — the move did not develop within the horizon');
  if (notes.length === 1) notes.push('no single factor at fault — likely a market-wide move');
  return notes.join('; ');
}

/** Retire a strategy once it has proven negative expectancy. */
export function shouldRetireStrategy(s: StrategyDto): boolean {
  const total = s.wins + s.losses;
  if (total < 8) return false;
  return s.wins / total < 0.4 && s.totalPnl < 0;
}
