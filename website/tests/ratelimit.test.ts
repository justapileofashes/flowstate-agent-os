import { describe, it, expect } from 'vitest';
import { rateLimit } from '../lib/ratelimit';

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const k = 'ip1:test';
    expect(rateLimit(k, 2, 1000, 1000)).toBe(true);
    expect(rateLimit(k, 2, 1000, 1000)).toBe(true);
    expect(rateLimit(k, 2, 1000, 1000)).toBe(false);
  });
  it('resets after the window elapses', () => {
    const k = 'ip2:test';
    expect(rateLimit(k, 1, 1000, 5000)).toBe(true);
    expect(rateLimit(k, 1, 1000, 5000)).toBe(false);
    expect(rateLimit(k, 1, 1000, 6001)).toBe(true);
  });
});
