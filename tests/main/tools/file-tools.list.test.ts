import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools/file-tools';
import { PathSandboxError } from '@main/tools/path-sandbox';

let workspace: string;
let tools: FileTools;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-ft-list-'));
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'a');
  writeFileSync(join(workspace, 'b.txt'), 'b');
  writeFileSync(join(workspace, 'sub', 'c.txt'), 'c');
  tools = new FileTools(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('FileTools.listDir', () => {
  it('lists the workspace root', async () => {
    const entries = await tools.listDir('.');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'b.txt', 'sub']);
    const sub = entries.find((e) => e.name === 'sub');
    expect(sub?.kind).toBe('dir');
    const a = entries.find((e) => e.name === 'a.txt');
    expect(a?.kind).toBe('file');
  });

  it('lists empty path as root', async () => {
    const entries = await tools.listDir('');
    expect(entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b.txt', 'sub']);
  });

  it('lists a subdirectory', async () => {
    const entries = await tools.listDir('sub');
    expect(entries.map((e) => e.name)).toEqual(['c.txt']);
  });

  it('rejects absolute paths', async () => {
    await expect(tools.listDir('/etc')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('rejects traversal', async () => {
    await expect(tools.listDir('../')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('throws ENOTDIR if path is a file', async () => {
    await expect(tools.listDir('a.txt')).rejects.toThrow(/directory/i);
  });
});
