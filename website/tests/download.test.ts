import { describe, it, expect } from 'vitest';
import { isVariant } from '../lib/download';

describe('isVariant', () => {
  it('accepts setup and portable', () => {
    expect(isVariant('setup')).toBe(true);
    expect(isVariant('portable')).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isVariant('exe')).toBe(false);
    expect(isVariant('')).toBe(false);
  });
});
