import { describe, it, expect } from 'vitest';
import { positionSize, atrStop, takeProfits, rewardRisk } from '../../src/shared/trade-math';

describe('positionSize', () => {
  it('risks the right dollar amount and shares', () => {
    // $10k account, risk 1% = $100, entry 50 stop 45 => $5 risk/share => 20 shares
    expect(positionSize({ account: 10000, riskPct: 1, entry: 50, stop: 45 })).toEqual({
      shares: 20,
      riskAmount: 100,
    });
  });
  it('throws when entry equals stop', () => {
    expect(() => positionSize({ account: 1000, riskPct: 1, entry: 50, stop: 50 })).toThrow();
  });
});

describe('atrStop', () => {
  it('places a long stop below entry by mult*atr', () => {
    expect(atrStop({ entry: 100, atr: 2, mult: 1.5, side: 'long' })).toBeCloseTo(97, 5);
  });
  it('places a short stop above entry', () => {
    expect(atrStop({ entry: 100, atr: 2, mult: 1.5, side: 'short' })).toBeCloseTo(103, 5);
  });
});

describe('takeProfits', () => {
  it('projects R-multiples in the trade direction (long)', () => {
    // entry 50 stop 45 => R = 5 ; targets at 1R,2R,3R => 55,60,65
    expect(takeProfits({ entry: 50, stop: 45, rMultiples: [1, 2, 3] })).toEqual([55, 60, 65]);
  });
  it('projects downward for a short (stop above entry)', () => {
    expect(takeProfits({ entry: 50, stop: 55, rMultiples: [1, 2] })).toEqual([45, 40]);
  });
});

describe('rewardRisk', () => {
  it('is reward over risk', () => {
    expect(rewardRisk({ entry: 50, stop: 45, target: 65 })).toBeCloseTo(3, 5);
  });
});
