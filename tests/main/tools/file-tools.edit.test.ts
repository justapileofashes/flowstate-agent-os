import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools/file-tools';
import { PathSandboxError } from '@main/tools/path-sandbox';

let workspace: string;
let tools: FileTools;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-ft-edit-'));
  tools = new FileTools(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const read = (p: string): string => readFileSync(join(workspace, p), 'utf8');

describe('FileTools.editFile', () => {
  it('replaces a unique snippet and leaves the rest untouched', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'const a = 1;\nconst b = 2;\n');
    await expect(tools.editFile('a.ts', 'const b = 2;', 'const b = 3;')).resolves.toEqual({ replacements: 1 });
    expect(read('a.ts')).toBe('const a = 1;\nconst b = 3;\n');
  });

  it('fails when old_string is missing', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'x');
    await expect(tools.editFile('a.ts', 'nope', 'y')).rejects.toThrow(/not found/);
  });

  it('refuses an ambiguous match unless replace_all', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'foo foo foo');
    await expect(tools.editFile('a.ts', 'foo', 'bar')).rejects.toThrow(/3 times/);
    expect(read('a.ts')).toBe('foo foo foo');
    await expect(tools.editFile('a.ts', 'foo', 'bar', true)).resolves.toEqual({ replacements: 3 });
    expect(read('a.ts')).toBe('bar bar bar');
  });

  it('keeps $-patterns in new_string literal', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'price = X');
    await tools.editFile('a.ts', 'X', "'$&' + $1");
    expect(read('a.ts')).toBe("price = '$&' + $1");
  });

  it('matches LF old_string against a CRLF file and keeps CRLF', async () => {
    writeFileSync(join(workspace, 'w.txt'), 'line1\r\nline2\r\nline3\r\n');
    await tools.editFile('w.txt', 'line1\nline2', 'one\ntwo');
    expect(read('w.txt')).toBe('one\r\ntwo\r\nline3\r\n');
  });

  it('rejects empty or no-op edits and directories', async () => {
    writeFileSync(join(workspace, 'a.ts'), 'x');
    mkdirSync(join(workspace, 'dir'));
    await expect(tools.editFile('a.ts', '', 'y')).rejects.toThrow(/empty/);
    await expect(tools.editFile('a.ts', 'x', 'x')).rejects.toThrow(/identical/);
    await expect(tools.editFile('dir', 'x', 'y')).rejects.toThrow(/directory/);
  });

  it('stays inside the workspace sandbox', async () => {
    await expect(tools.editFile('../outside.txt', 'a', 'b')).rejects.toBeInstanceOf(PathSandboxError);
  });
});
