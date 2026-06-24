import { describe, it, expect } from 'vitest';
import { waitlistSchema, contactSchema } from '../lib/validate';

describe('waitlistSchema', () => {
  it('accepts a valid email', () => {
    expect(waitlistSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });
  it('rejects a bad email', () => {
    expect(waitlistSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('contactSchema', () => {
  it('accepts a full message', () => {
    const r = contactSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'hi there' });
    expect(r.success).toBe(true);
  });
  it('rejects an empty message', () => {
    const r = contactSchema.safeParse({ name: 'A', email: 'a@b.com', message: '' });
    expect(r.success).toBe(false);
  });
  it('allows the honeypot field through (filtered later, not rejected)', () => {
    const r = contactSchema.safeParse({ name: 'A', email: 'a@b.com', message: 'hi there', website: 'bot' });
    expect(r.success).toBe(true);
  });
});
