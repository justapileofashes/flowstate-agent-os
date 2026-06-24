import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools/file-tools';
import { PathSandboxError } from '@main/tools/path-sandbox';

let workspace: string;
let tools: FileTools;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-ft-del-'));
  writeFileSync(join(workspace, 'a.txt'), 'a');
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'b');
  tools = new FileTools(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('FileTools.deleteFile', () => {
  it('deletes a file', async () => {
    await tools.deleteFile('a.txt');
    expect(existsSync(join(workspace, 'a.txt'))).toBe(false);
  });

  it('deletes a nested file', async () => {
    await tools.deleteFile('sub/b.txt');
    expect(existsSync(join(workspace, 'sub', 'b.txt'))).toBe(false);
    expect(existsSync(join(workspace, 'sub'))).toBe(true);
  });

  it('rejects absolute paths', async () => {
    await expect(tools.deleteFile('/etc/passwd')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('rejects traversal', async () => {
    await expect(tools.deleteFile('../escape')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('refuses to delete a directory by default', async () => {
    await expect(tools.deleteFile('sub')).rejects.toThrow(/directory/i);
    expect(existsSync(join(workspace, 'sub'))).toBe(true);
  });

  it('throws ENOENT on missing files', async () => {
    await expect(tools.deleteFile('missing.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
