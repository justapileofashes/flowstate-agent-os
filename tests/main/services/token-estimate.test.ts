import { describe, it, expect } from 'vitest';
import { estimateTokens, preflightPrompt, contextWindowFor } from '@main/services/token-estimate';

describe('contextWindowFor', () => {
  it('maps known model families', () => {
    expect(contextWindowFor('claude-opus-4-8')).toBe(200_000);
    expect(contextWindowFor('gemini-2.5-pro')).toBe(1_000_000);
    expect(contextWindowFor('llama3:8b')).toBe(8_192);
    expect(contextWindowFor('llama-3.1-70b')).toBe(128_000);
  });
  it('returns 0 for unknown models', () => {
    expect(contextWindowFor('totally-made-up')).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('is 0 for empty', () => {
    expect(estimateTokens('')).toBe(0);
  });
  it('grows with length', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
    expect(estimateTokens('x'.repeat(400))).toBeGreaterThanOrEqual(100);
  });
});

describe('preflightPrompt', () => {
  it('is unknown without a cap', () => {
    expect(preflightPrompt({ text: 'hi' }).level).toBe('unknown');
  });

  it('is ok well under the window', () => {
    expect(preflightPrompt({ text: 'hi', capTokens: 8192 }).level).toBe('ok');
  });

  it('warns near the usable window', () => {
    const text = 'x'.repeat(4 * 6500); // ~6500 tokens
    const v = preflightPrompt({ text, capTokens: 8192, replyReserveTokens: 1024 });
    expect(v.level).toBe('warn');
  });

  it('flags over when it exceeds usable window', () => {
    const text = 'x'.repeat(4 * 9000); // ~9000 tokens > 8192-1024
    const v = preflightPrompt({ text, capTokens: 8192 });
    expect(v.level).toBe('over');
    expect(v.message).toMatch(/exceeds/i);
  });

  it('counts attached context chars', () => {
    const a = preflightPrompt({ text: 'hi', capTokens: 8192 }).estTokens;
    const b = preflightPrompt({ text: 'hi', contextChars: 4000, capTokens: 8192 }).estTokens;
    expect(b).toBeGreaterThan(a);
  });
});
