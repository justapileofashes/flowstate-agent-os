// Pure forward projection. base path follows drift; bull/bear widen with
// sqrt(time)*atr (uncertainty grows) and narrow as confidence rises. Shared by
// the analyst chart artifact and the Stocks screen.

export type Scenario = 'bull' | 'base' | 'bear';

export interface ForecastInput {
  lastClose: number;
  atr: number;
  drift: number; // per-bar expected move, signed (absolute price units)
  horizon: number; // bars forward
  confidence: number; // 0..1
}

export interface ForecastPoint {
  time: number; // bars ahead (1..horizon)
  value: number;
}

export type ForecastCone = Record<Scenario, ForecastPoint[]>;

export function forecastCone(i: ForecastInput): ForecastCone {
  const conf = Math.min(1, Math.max(0, i.confidence));
  // higher confidence -> narrower band. k in [0.5 .. 2.0]
  const k = 2 - 1.5 * conf;
  const bull: ForecastPoint[] = [];
  const baseArr: ForecastPoint[] = [];
  const bear: ForecastPoint[] = [];
  for (let t = 1; t <= i.horizon; t++) {
    const mid = i.lastClose + i.drift * t;
    const spread = k * i.atr * Math.sqrt(t);
    bull.push({ time: t, value: mid + spread });
    baseArr.push({ time: t, value: mid });
    bear.push({ time: t, value: mid - spread });
  }
  return { bull, base: baseArr, bear };
}
