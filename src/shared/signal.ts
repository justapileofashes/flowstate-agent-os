// Pure multi-factor synthesis. Patterns are ONE weighted factor among many — no
// single factor decides. Output drives the signal card and forecast drift.

export type Direction = 'buy' | 'hold' | 'sell';

export type FactorKey =
  | 'trend'
  | 'momentum'
  | 'volatility'
  | 'levels'
  | 'volume'
  | 'pattern'
  | 'fundamentals'
  | 'sentiment';

export interface Factor {
  key: FactorKey;
  score: number; // -1..+1
  weight: number; // >= 0
  note: string;
}

export interface SignalResult {
  direction: Direction;
  confidence: number; // 0..1
  composite: number; // -1..+1
  factors: Factor[];
  drift: number; // per-bar drift proxy (price-fraction); agent scales by lastClose
}

const BUY_THRESHOLD = 0.25;
const DRIFT_SCALE = 0.005; // composite of 1 => 0.5% per-bar drift fraction-of-price proxy

export function synthesize(factors: Factor[]): SignalResult {
  const totalWeight = factors.reduce((a, f) => a + Math.max(0, f.weight), 0);
  if (totalWeight === 0) {
    return { direction: 'hold', confidence: 0, composite: 0, factors, drift: 0 };
  }
  const composite =
    factors.reduce((a, f) => a + clamp(f.score) * Math.max(0, f.weight), 0) / totalWeight;

  // Agreement: 1 when all factors point the same way, lower when they conflict.
  const weightedAbs =
    factors.reduce((a, f) => a + Math.abs(clamp(f.score)) * Math.max(0, f.weight), 0) / totalWeight;
  const agreement = weightedAbs === 0 ? 0 : Math.abs(composite) / weightedAbs;
  const confidence = clampUnit(Math.abs(composite) * 0.5 + agreement * 0.5);

  const direction: Direction =
    composite >= BUY_THRESHOLD ? 'buy' : composite <= -BUY_THRESHOLD ? 'sell' : 'hold';

  return { direction, confidence, composite, factors, drift: composite * DRIFT_SCALE };
}

function clamp(v: number): number {
  return Math.min(1, Math.max(-1, v));
}
function clampUnit(v: number): number {
  return Math.min(1, Math.max(0, v));
}
