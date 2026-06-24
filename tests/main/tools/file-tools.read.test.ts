import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools/file-tools';
import { PathSandboxError } from '@main/tools/path-sandbox';

let workspace: string;
let tools: FileTools;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-ft-read-'));
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'world');
  tools = new FileTools(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('FileTools.readFile', () => {
  it('reads a file in the workspace', async () => {
    const content = await tools.readFile('a.txt');
    expect(content).toBe('hello');
  });

  it('reads a nested file', async () => {
    const content = await tools.readFile('sub/b.txt');
    expect(content).toBe('world');
  });

  it('throws PathSandboxError for absolute paths', async () => {
    await expect(tools.readFile('/etc/passwd')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('throws PathSandboxError for traversal', async () => {
    await expect(tools.readFile('../escape')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('throws ENOENT for missing files (NodeJS error, not sandbox error)', async () => {
    await expect(tools.readFile('missing.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to read a directory', async () => {
    await expect(tools.readFile('sub')).rejects.toThrow(/directory/i);
  });
});
