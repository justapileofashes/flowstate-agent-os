import { describe, it, expect } from 'vitest';
import { clientIp } from '../lib/http';

describe('clientIp', () => {
  it('takes the first hop of x-forwarded-for', () => {
    const req = new Request('https://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIp(req)).toBe('1.2.3.4');
  });
  it('falls back to "unknown" with no header', () => {
    expect(clientIp(new Request('https://x'))).toBe('unknown');
  });
});
