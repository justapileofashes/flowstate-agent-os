// Pure risk math, shared by the analyst agents and the Stocks screen's risk
// calculator so both agree exactly. No IO.

export interface PositionSizeInput {
  account: number;
  riskPct: number; // percent, e.g. 1 = 1%
  entry: number;
  stop: number;
}

export function positionSize(i: PositionSizeInput): { shares: number; riskAmount: number } {
  const perShare = Math.abs(i.entry - i.stop);
  if (perShare === 0) throw new Error('entry and stop cannot be equal');
  if (i.account < 0 || i.riskPct < 0) throw new Error('account and riskPct must be non-negative');
  const riskAmount = (i.account * i.riskPct) / 100;
  return { shares: Math.floor(riskAmount / perShare), riskAmount };
}

export interface AtrStopInput {
  entry: number;
  atr: number;
  mult?: number;
  side: 'long' | 'short';
}

export function atrStop(i: AtrStopInput): number {
  const mult = i.mult ?? 1.5;
  const dist = i.atr * mult;
  return i.side === 'long' ? i.entry - dist : i.entry + dist;
}

export interface TakeProfitInput {
  entry: number;
  stop: number;
  rMultiples?: number[];
}

export function takeProfits(i: TakeProfitInput): number[] {
  const r = Math.abs(i.entry - i.stop);
  const dir = i.stop < i.entry ? 1 : -1; // stop below = long = targets above
  return (i.rMultiples ?? [1, 2, 3]).map((m) => i.entry + dir * r * m);
}

export function rewardRisk(i: { entry: number; stop: number; target: number }): number {
  const risk = Math.abs(i.entry - i.stop);
  if (risk === 0) throw new Error('entry and stop cannot be equal');
  return Math.abs(i.target - i.entry) / risk;
}
