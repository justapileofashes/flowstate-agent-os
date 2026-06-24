import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools/file-tools';
import { PathSandboxError } from '@main/tools/path-sandbox';

let workspace: string;
let tools: FileTools;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-ft-write-'));
  tools = new FileTools(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('FileTools.writeFile', () => {
  it('creates a new file', async () => {
    const result = await tools.writeFile('hello.txt', 'hi');
    expect(result.created).toBe(true);
    expect(readFileSync(join(workspace, 'hello.txt'), 'utf8')).toBe('hi');
  });

  it('creates parent directories as needed', async () => {
    await tools.writeFile('deeply/nested/file.txt', 'x');
    expect(readFileSync(join(workspace, 'deeply', 'nested', 'file.txt'), 'utf8')).toBe('x');
  });

  it('overwrites an existing file and reports created=false', async () => {
    await tools.writeFile('a.txt', 'first');
    const result = await tools.writeFile('a.txt', 'second');
    expect(result.created).toBe(false);
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('second');
  });

  it('rejects absolute paths', async () => {
    await expect(tools.writeFile('/etc/x', 'y')).rejects.toBeInstanceOf(PathSandboxError);
    expect(existsSync('/etc/x')).toBe(false);
  });

  it('rejects traversal', async () => {
    await expect(tools.writeFile('../escape.txt', 'y')).rejects.toBeInstanceOf(PathSandboxError);
  });

  it('refuses to overwrite a directory', async () => {
    await tools.writeFile('dir/inner.txt', 'x');
    await expect(tools.writeFile('dir', 'y')).rejects.toThrow(/directory/i);
  });
});
