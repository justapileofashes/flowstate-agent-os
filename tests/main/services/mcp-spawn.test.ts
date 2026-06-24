import { describe, it, expect } from 'vitest';
import { resolveSpawn } from '@main/services/mcp-client';

describe('resolveSpawn', () => {
  it('spawns directly without a shell on POSIX', () => {
    const r = resolveSpawn('npx', ['-y', 'pkg', '/home/me/My Docs'], 'linux');
    expect(r.shell).toBe(false);
    expect(r.command).toBe('npx');
    expect(r.args).toEqual(['-y', 'pkg', '/home/me/My Docs']);
  });

  it('uses a shell on Windows so .cmd shims (npx/uvx) can launch', () => {
    const r = resolveSpawn('npx', ['-y', 'pkg'], 'win32');
    expect(r.shell).toBe(true);
    expect(r.command).toBe('npx');
    expect(r.args).toEqual(['-y', 'pkg']);
  });

  it('quotes Windows args containing spaces so paths survive shell parsing', () => {
    const r = resolveSpawn('npx', ['-y', 'pkg', 'C:\\Users\\you\\My Documents'], 'win32');
    expect(r.args[2]).toBe('"C:\\Users\\you\\My Documents"');
  });

  it('quotes Windows args containing cmd metacharacters', () => {
    const r = resolveSpawn('npx', ['--api-key=a&b|c'], 'win32');
    expect(r.args[0]).toBe('"--api-key=a&b|c"');
  });

  it('quotes a command path containing spaces on Windows', () => {
    const r = resolveSpawn('C:\\Program Files\\nodejs\\npx', [], 'win32');
    expect(r.command).toBe('"C:\\Program Files\\nodejs\\npx"');
  });

  it('leaves plain Windows args untouched', () => {
    const r = resolveSpawn('npx', ['-y', '@scope/pkg@latest', '--read-only'], 'win32');
    expect(r.args).toEqual(['-y', '@scope/pkg@latest', '--read-only']);
  });
});
