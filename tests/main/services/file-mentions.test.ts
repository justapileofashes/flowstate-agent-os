import { describe, it, expect } from 'vitest';
import { parseMentions, buildContextBlock } from '@main/services/file-mentions';

describe('parseMentions', () => {
  it('extracts relative paths, de-duped, first-seen order', () => {
    expect(parseMentions('look at @src/auth.ts and @lib/x.js then @src/auth.ts again')).toEqual([
      'src/auth.ts',
      'lib/x.js',
    ]);
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(parseMentions('@src\\main\\index.ts')).toEqual(['src/main/index.ts']);
  });

  it('only matches @ at start or after whitespace (skips emails)', () => {
    expect(parseMentions('mail me at foo@bar.com please')).toEqual([]);
  });

  it('matches a mention at the very start', () => {
    expect(parseMentions('@README.md summarize')).toEqual(['README.md']);
  });
});

describe('buildContextBlock', () => {
  it('returns empty string with no files', () => {
    expect(buildContextBlock([])).toBe('');
  });

  it('fences content with a language hint', () => {
    const out = buildContextBlock([{ path: 'a.ts', content: 'const x = 1;' }]);
    expect(out).toContain('## a.ts');
    expect(out).toContain('```ts');
    expect(out).toContain('const x = 1;');
  });

  it('notes unreadable files instead of dropping them', () => {
    const out = buildContextBlock([{ path: 'gone.ts', content: null }]);
    expect(out).toContain('## gone.ts');
    expect(out).toMatch(/could not read/i);
  });

  it('clips very large files', () => {
    const big = 'x'.repeat(7000);
    const out = buildContextBlock([{ path: 'big.txt', content: big }]);
    expect(out).toContain('clipped — 7000 chars total');
  });
});
