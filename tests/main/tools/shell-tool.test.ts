import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { runShell } from '@main/tools/shell-tool';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-shell-'));
  writeFileSync(join(workspace, 'README.md'), '# test\n');
});

afterEach(async () => {
  // Windows can hold workspace temporarily after a killed child exits;
  // give the OS a moment, then best-effort cleanup.
  await new Promise((r) => setTimeout(r, 50));
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // ignored — leaked tmpdir is harmless
  }
});

describe('runShell', () => {
  it('runs node --version successfully', async () => {
    const r = await runShell('node --version', workspace);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^v\d+\./);
  });

  it('captures stderr', async () => {
    const r = await runShell(
      "node -e \"process.stderr.write('err'); process.exit(2)\"",
      workspace,
    );
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toBe('err');
  });

  it('returns ok=false when binary not found', async () => {
    const r = await runShell('definitelynotacommand_xyz', workspace);
    expect(r.ok).toBe(false);
  });

  it('rejects shell metacharacters (pipes/redirects)', async () => {
    const r = await runShell('echo hi | cat', workspace);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/metachar/i);
  });

  it('rejects sudo prefix', async () => {
    const r = await runShell('sudo ls', workspace);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/sudo/i);
  });

  it('rejects empty command', async () => {
    const r = await runShell('   ', workspace);
    expect(r.ok).toBe(false);
  });

  it('truncates output above 1MB', async () => {
    const r = await runShell(
      "node -e \"for(let i=0;i<200000;i++) process.stdout.write('abcdefghij')\"",
      workspace,
    );
    expect(r.truncated).toBe(true);
    expect(r.stdout.length + r.stderr.length).toBeLessThanOrEqual(1_000_500);
  }, 30_000);

  it('kills on timeout', async () => {
    const r = await runShell(
      "node -e \"setInterval(()=>{},1000)\"",
      workspace,
      { timeoutMs: 500 },
    );
    expect(r.exitCode).not.toBe(0);
  }, 10_000);

  it('runs in the workspace cwd', async () => {
    const r = await runShell(
      'node -e "process.stdout.write(process.cwd())"',
      workspace,
    );
    expect(r.stdout).toContain(basename(workspace));
  });
});
