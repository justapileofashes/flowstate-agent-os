import { describe, it, expect } from 'vitest';
import { forecastCone } from '../../src/shared/forecast';

const base = { lastClose: 100, atr: 2, drift: 0.5, horizon: 10, confidence: 0.5 };

describe('forecastCone', () => {
  it('produces horizon points per scenario, ordered bull >= base >= bear', () => {
    const c = forecastCone(base);
    expect(c.base).toHaveLength(10);
    const last = 9;
    expect(c.bull[last]!.value).toBeGreaterThanOrEqual(c.base[last]!.value);
    expect(c.base[last]!.value).toBeGreaterThanOrEqual(c.bear[last]!.value);
  });
  it('widens monotonically with time', () => {
    const c = forecastCone(base);
    const width = (i: number) => c.bull[i]!.value - c.bear[i]!.value;
    expect(width(9)).toBeGreaterThan(width(0));
  });
  it('narrows the band as confidence rises', () => {
    const low = forecastCone({ ...base, confidence: 0.1 });
    const high = forecastCone({ ...base, confidence: 0.9 });
    const w = (c: ReturnType<typeof forecastCone>) => c.bull[9]!.value - c.bear[9]!.value;
    expect(w(high)).toBeLessThan(w(low));
  });
});
