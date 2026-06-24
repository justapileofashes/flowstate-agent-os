import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpManager } from '@main/services/mcp-manager';

// A real child process exercises the spawn path (incl. resolveSpawn quoting on
// win32) end to end, without depending on any network MCP package.
let dir: string;
let failScript: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-client-'));
  failScript = join(dir, 'fail.cjs');
  // Write a recognizable cause to stderr, then exit non-zero before any
  // handshake reply — mimics a missing runner / bad package / bad token.
  writeFileSync(failScript, 'process.stderr.write("DISTINCT_CAUSE_123\\n");process.exit(1);');
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('McpManager.testServer', () => {
  it('surfaces the child stderr cause when a server exits before handshake', async () => {
    const mgr = new McpManager();
    const res = await mgr.testServer({
      id: 'failing',
      name: 'Failing',
      command: process.execPath, // node binary — always present, no shell needed
      args: [failScript],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('DISTINCT_CAUSE_123');
  });

  it('reports a clean handshake failure for a server that produces no output', async () => {
    const mgr = new McpManager();
    const res = await mgr.testServer({
      id: 'silent',
      name: 'Silent',
      command: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(2), 10)'],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/exited with code 2/);
  });
});
