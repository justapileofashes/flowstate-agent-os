import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateConstitution,
  loadConstitution,
  type ConstitutionRule,
} from '@main/agent/constitution';

describe('evaluateConstitution', () => {
  it('returns null when no rule matches', () => {
    const rules: ConstitutionRule[] = [{ effect: 'deny', tool: 'run_shell' }];
    expect(evaluateConstitution(rules, { toolName: 'read_file', args: {} })).toBeNull();
  });

  it('matches by tool name', () => {
    const rules: ConstitutionRule[] = [{ effect: 'deny', tool: 'delete_file' }];
    expect(evaluateConstitution(rules, { toolName: 'delete_file', args: {} })).toBe('deny');
  });

  it("treats '*' and missing tool as any tool", () => {
    expect(evaluateConstitution([{ effect: 'ask', tool: '*' }], { toolName: 'x', args: {} })).toBe(
      'ask',
    );
    expect(evaluateConstitution([{ effect: 'ask' }], { toolName: 'y', args: {} })).toBe('ask');
  });

  it('matches a pattern against arg values', () => {
    const rules: ConstitutionRule[] = [
      { effect: 'deny', tool: 'run_shell', pattern: 'rm\\s+-rf' },
    ];
    expect(
      evaluateConstitution(rules, { toolName: 'run_shell', args: { command: 'rm -rf /tmp/x' } }),
    ).toBe('deny');
    expect(
      evaluateConstitution(rules, { toolName: 'run_shell', args: { command: 'ls -la' } }),
    ).toBeNull();
  });

  it('matches a pattern against the tool name too', () => {
    const rules: ConstitutionRule[] = [{ effect: 'allow', pattern: 'read_file' }];
    expect(evaluateConstitution(rules, { toolName: 'read_file', args: {} })).toBe('allow');
  });

  it('is case-insensitive', () => {
    const rules: ConstitutionRule[] = [{ effect: 'deny', pattern: 'SECRET' }];
    expect(
      evaluateConstitution(rules, { toolName: 'write_file', args: { path: 'my-secret.txt' } }),
    ).toBe('deny');
  });

  it('first matching rule wins', () => {
    const rules: ConstitutionRule[] = [
      { effect: 'allow', tool: 'write_file' },
      { effect: 'deny', tool: 'write_file' },
    ];
    expect(evaluateConstitution(rules, { toolName: 'write_file', args: {} })).toBe('allow');
  });

  it('skips a rule with an invalid regex instead of throwing', () => {
    const rules: ConstitutionRule[] = [
      { effect: 'deny', pattern: '([unclosed' },
      { effect: 'ask', tool: 'run_shell' },
    ];
    expect(
      evaluateConstitution(rules, { toolName: 'run_shell', args: { command: 'x' } }),
    ).toBe('ask');
  });

  it('searches nested object and array args', () => {
    const rules: ConstitutionRule[] = [{ effect: 'deny', pattern: 'forbidden' }];
    expect(
      evaluateConstitution(rules, {
        toolName: 'brain_note',
        args: { tags: ['ok', 'forbidden'], meta: { note: 'x' } },
      }),
    ).toBe('deny');
  });
});

describe('loadConstitution', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'flowstate-const-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when the file is missing', async () => {
    expect(await loadConstitution(dir)).toEqual([]);
  });

  it('returns [] for invalid JSON', async () => {
    mkdirSync(join(dir, '.flowstate'));
    writeFileSync(join(dir, '.flowstate', 'constitution.json'), 'not json{');
    expect(await loadConstitution(dir)).toEqual([]);
  });

  it('returns [] when a rule has a bad effect', async () => {
    mkdirSync(join(dir, '.flowstate'));
    writeFileSync(
      join(dir, '.flowstate', 'constitution.json'),
      JSON.stringify([{ effect: 'nuke' }]),
    );
    expect(await loadConstitution(dir)).toEqual([]);
  });

  it('parses a valid constitution file', async () => {
    mkdirSync(join(dir, '.flowstate'));
    const rules = [
      { effect: 'deny', tool: 'run_shell', pattern: 'rm -rf', description: 'no rm' },
      { effect: 'allow', tool: 'read_file' },
    ];
    writeFileSync(join(dir, '.flowstate', 'constitution.json'), JSON.stringify(rules));
    expect(await loadConstitution(dir)).toEqual(rules);
  });
});
