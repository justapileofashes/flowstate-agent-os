import { describe, it, expect } from 'vitest';
import { pickConventionFiles, buildConventionPreamble } from '@main/services/project-context';

describe('pickConventionFiles', () => {
  it('prefers agent-instruction files over README, max two', () => {
    expect(pickConventionFiles(['README.md', 'CLAUDE.md', 'AGENTS.md'])).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
    ]);
  });

  it('returns README alone when it is the only one', () => {
    expect(pickConventionFiles(['README.md', 'package.json'])).toEqual(['README.md']);
  });

  it('returns [] when none present', () => {
    expect(pickConventionFiles(['package.json', 'tsconfig.json'])).toEqual([]);
  });
});

describe('buildConventionPreamble', () => {
  it('returns empty for no/blank files', () => {
    expect(buildConventionPreamble([])).toBe('');
    expect(buildConventionPreamble([{ name: 'AGENTS.md', content: '   ' }])).toBe('');
  });

  it('includes each non-empty file under a header', () => {
    const out = buildConventionPreamble([
      { name: 'AGENTS.md', content: 'Use tabs.' },
      { name: 'README.md', content: 'A tool.' },
    ]);
    expect(out).toContain('--- AGENTS.md ---');
    expect(out).toContain('Use tabs.');
    expect(out).toContain('--- README.md ---');
  });

  it('truncates within a shared budget', () => {
    const out = buildConventionPreamble([{ name: 'README.md', content: 'y'.repeat(9000) }]);
    expect(out).toContain('[truncated]');
  });
});
