import { describe, it, expect } from 'vitest';
import { synthesize, type Factor } from '../../src/shared/signal';

function f(key: Factor['key'], score: number, weight: number): Factor {
  return { key, score, weight, note: '' };
}

describe('synthesize', () => {
  it('calls a unanimous bullish set a buy with high confidence', () => {
    const r = synthesize([f('trend', 1, 1), f('momentum', 1, 1), f('fundamentals', 1, 1)]);
    expect(r.direction).toBe('buy');
    expect(r.confidence).toBeGreaterThan(0.7);
  });
  it('lowers confidence when factors conflict', () => {
    const agree = synthesize([f('trend', 1, 1), f('momentum', 1, 1)]);
    const conflict = synthesize([f('trend', 1, 1), f('momentum', -1, 1)]);
    expect(conflict.confidence).toBeLessThan(agree.confidence);
  });
  it('does not let a lone pattern override an opposing trend', () => {
    // strong bearish trend (heavy), single bullish pattern (light)
    const r = synthesize([f('trend', -1, 2), f('momentum', -1, 2), f('pattern', 1, 1)]);
    expect(r.direction).not.toBe('buy');
  });
  it('defaults missing factors to nothing (neutral hold on empty)', () => {
    expect(synthesize([]).direction).toBe('hold');
  });
  it('derives drift with the same sign as the composite', () => {
    expect(synthesize([f('trend', 1, 1)]).drift).toBeGreaterThan(0);
    expect(synthesize([f('trend', -1, 1)]).drift).toBeLessThan(0);
  });
});
