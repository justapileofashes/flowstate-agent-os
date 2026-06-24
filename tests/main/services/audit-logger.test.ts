import { describe, it, expect } from 'vitest';
import { summarizeArgs } from '@main/services/audit-logger';

describe('summarizeArgs redaction', () => {
  it('keeps paths and commands', () => {
    expect(summarizeArgs({ path: 'src/app.ts' })).toBe('path=src/app.ts');
    expect(summarizeArgs({ command: 'ls -la' })).toBe('command=ls -la');
  });

  it('redacts content/source/body blobs to a size hint', () => {
    const s = summarizeArgs({ path: 'a.txt', content: 'x'.repeat(5000) });
    expect(s).toContain('path=a.txt');
    expect(s).toContain('content=<5000 chars>');
    expect(s).not.toContain('xxxx');
  });

  it('redacts secret-like keys', () => {
    const s = summarizeArgs({ apiKey: 'sk-supersecret', token: 'abc123' });
    expect(s).not.toContain('supersecret');
    expect(s).not.toContain('abc123');
    expect(s).toContain('apiKey=<');
    expect(s).toContain('token=<');
  });

  it('truncates overly long plain values', () => {
    const s = summarizeArgs({ query: 'q'.repeat(500) });
    expect(s.length).toBeLessThan(140);
    expect(s.endsWith('…')).toBe(true);
  });

  it('summarizes arrays and nested objects without dumping them', () => {
    expect(summarizeArgs({ tags: ['a', 'b', 'c'] })).toBe('tags=[3]');
    expect(summarizeArgs({ opts: { a: 1 } })).toBe('opts={…}');
  });

  it('handles null and primitives', () => {
    expect(summarizeArgs(null)).toBe('');
    expect(summarizeArgs('hello')).toBe('hello');
  });

  it('redacts secrets that appear inside plain arg values', () => {
    const s = summarizeArgs({ command: "curl -H 'Authorization: Bearer abc123DEF456ghi789' x" });
    expect(s).toContain('command=');
    expect(s).not.toContain('abc123DEF456ghi789');
    expect(s).toContain('<token>');
  });
});
