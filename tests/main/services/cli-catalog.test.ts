import { describe, it, expect } from 'vitest';
import {
  KNOWN_CLIS,
  parseVersion,
  buildCliReport,
  buildCliContext,
  type CliProbeResult,
  type DetectedCli,
} from '@main/services/cli-catalog';

describe('parseVersion', () => {
  it('extracts a semver from common --version output', () => {
    expect(parseVersion('git version 2.45.1')).toBe('2.45.1');
    expect(parseVersion('Docker version 27.0.3, build abc')).toBe('27.0.3');
    expect(parseVersion('v20.11.0')).toBe('20.11.0');
    expect(parseVersion('Python 3.12.10')).toBe('3.12.10');
  });

  it('handles two-part versions', () => {
    expect(parseVersion('gh version 2.40')).toBe('2.40');
  });

  it('returns null when there is no version-looking token', () => {
    expect(parseVersion('command not found')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });
});

describe('KNOWN_CLIS', () => {
  it('has unique ids and non-empty commands', () => {
    const ids = KNOWN_CLIS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(KNOWN_CLIS.every((c) => c.command.length > 0)).toBe(true);
  });

  it('includes the staple dev CLIs', () => {
    const ids = new Set(KNOWN_CLIS.map((c) => c.id));
    for (const id of ['git', 'gh', 'docker', 'node', 'python', 'ollama']) {
      expect(ids.has(id)).toBe(true);
    }
  });
});

describe('buildCliReport', () => {
  it('merges probe results with the catalog, preserving catalog order', () => {
    const results: CliProbeResult[] = [
      { id: 'git', installed: true, version: '2.45.1', path: '/usr/bin/git' },
      { id: 'docker', installed: false, version: null, path: null },
    ];
    const report = buildCliReport(results);
    const git = report.find((c) => c.id === 'git')!;
    expect(git.installed).toBe(true);
    expect(git.version).toBe('2.45.1');
    expect(git.name.length).toBeGreaterThan(0);
    expect(git.category.length).toBeGreaterThan(0);
    // a catalog entry with no probe result defaults to not-installed
    const node = report.find((c) => c.id === 'node')!;
    expect(node.installed).toBe(false);
    // order follows the catalog
    const gitIdx = report.findIndex((c) => c.id === 'git');
    const dockerIdx = report.findIndex((c) => c.id === 'docker');
    expect(gitIdx).toBe(KNOWN_CLIS.findIndex((c) => c.id === 'git'));
    expect(dockerIdx).toBe(KNOWN_CLIS.findIndex((c) => c.id === 'docker'));
  });

  it('ignores probe results for unknown ids', () => {
    const report = buildCliReport([
      { id: 'totally-unknown', installed: true, version: '1.0', path: '/x' },
    ]);
    expect(report.find((c) => c.id === 'totally-unknown')).toBeUndefined();
    expect(report.length).toBe(KNOWN_CLIS.length);
  });
});

describe('buildCliContext', () => {
  const mk = (id: string, name: string, command: string): DetectedCli => ({
    id,
    name,
    command,
    category: 'vcs',
    description: 'desc',
    installed: true,
    version: '1.0.0',
    path: '/x',
  });

  it('returns an empty string when nothing is connected', () => {
    expect(buildCliContext([])).toBe('');
  });

  it('lists connected CLIs with their command and mentions run_shell', () => {
    const ctx = buildCliContext([mk('gh', 'GitHub CLI', 'gh'), mk('docker', 'Docker', 'docker')]);
    expect(ctx).toContain('run_shell');
    expect(ctx).toContain('gh');
    expect(ctx).toContain('GitHub CLI');
    expect(ctx).toContain('docker');
  });
});
