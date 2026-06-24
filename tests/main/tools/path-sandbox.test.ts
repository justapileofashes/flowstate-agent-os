import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { resolveSafe, PathSandboxError, resolveSafeReal } from '@main/tools/path-sandbox';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-sandbox-'));
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'world');
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('resolveSafe — happy path', () => {
  it('resolves a relative path inside the workspace', () => {
    const out = resolveSafe(workspace, 'a.txt');
    expect(out).toBe(join(workspace, 'a.txt'));
  });

  it('resolves a nested relative path', () => {
    const out = resolveSafe(workspace, 'sub/b.txt');
    expect(out).toBe(join(workspace, 'sub', 'b.txt'));
  });

  it("resolves '.' to the workspace root", () => {
    const out = resolveSafe(workspace, '.');
    expect(out).toBe(workspace);
  });

  it('resolves an empty string to the workspace root', () => {
    const out = resolveSafe(workspace, '');
    expect(out).toBe(workspace);
  });

  it('normalizes mixed slashes', () => {
    const out = resolveSafe(workspace, 'sub\\b.txt'.split('\\').join('/'));
    expect(out).toBe(join(workspace, 'sub', 'b.txt'));
  });

  it(`accepts paths inside subdirectories using platform separator (${sep})`, () => {
    const out = resolveSafe(workspace, ['sub', 'b.txt'].join(sep));
    expect(out).toBe(join(workspace, 'sub', 'b.txt'));
  });
});

describe('resolveSafe — rejections', () => {
  it('rejects absolute POSIX paths', () => {
    expect(() => resolveSafe(workspace, '/etc/passwd')).toThrow(PathSandboxError);
  });

  it('rejects absolute Windows drive paths', () => {
    expect(() => resolveSafe(workspace, 'C:\\Windows\\System32')).toThrow(PathSandboxError);
  });

  it('rejects parent-directory traversal', () => {
    expect(() => resolveSafe(workspace, '../escape')).toThrow(PathSandboxError);
  });

  it('rejects nested traversal that escapes', () => {
    expect(() => resolveSafe(workspace, 'sub/../../escape')).toThrow(PathSandboxError);
  });

  it('rejects NUL bytes', () => {
    expect(() => resolveSafe(workspace, 'a\0.txt')).toThrow(PathSandboxError);
  });

  it('rejects Windows UNC paths', () => {
    expect(() => resolveSafe(workspace, '\\\\server\\share\\file')).toThrow(PathSandboxError);
  });

  it('rejects forward-slash UNC-style paths', () => {
    expect(() => resolveSafe(workspace, '//server/share/file')).toThrow(PathSandboxError);
  });

  it('does not reject traversal that stays inside the workspace', () => {
    const out = resolveSafe(workspace, 'sub/..');
    expect(out).toBe(workspace);
  });

  it('does not reject single dots inside paths', () => {
    const out = resolveSafe(workspace, './sub/./b.txt');
    expect(out).toBe(join(workspace, 'sub', 'b.txt'));
  });

  it('rejects paths that resolve outside the workspace via sibling traversal', () => {
    expect(() => resolveSafe(workspace, '../something')).toThrow(PathSandboxError);
  });

  it('rejects paths whose resolved location is the parent of the workspace', () => {
    expect(() => resolveSafe(workspace, '..')).toThrow(PathSandboxError);
  });
});

describe('resolveSafeReal — symlinks', () => {
  it('resolves a regular file via realpath', async () => {
    const out = await resolveSafeReal(workspace, 'a.txt');
    expect(out).toBe(join(workspace, 'a.txt'));
  });

  it('rejects a symlink that points outside the workspace', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'flowstate-outside-'));
    try {
      writeFileSync(join(outside, 'secret.txt'), 'leaked');
      try {
        symlinkSync(join(outside, 'secret.txt'), join(workspace, 'link'));
      } catch {
        // Skip if symlink creation isn't permitted on this host (e.g.,
        // Windows without developer mode). The test then trivially passes —
        // there's no escape vector to exploit.
        return;
      }
      await expect(resolveSafeReal(workspace, 'link')).rejects.toBeInstanceOf(PathSandboxError);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('accepts a symlink that points inside the workspace', async () => {
    try {
      symlinkSync(join(workspace, 'a.txt'), join(workspace, 'alias'));
    } catch {
      return;
    }
    const out = await resolveSafeReal(workspace, 'alias');
    expect(out).toBe(join(workspace, 'a.txt'));
  });

  it('returns the syntactic path for a non-existent file (no realpath possible)', async () => {
    const out = await resolveSafeReal(workspace, 'does-not-exist.txt');
    expect(out).toBe(join(workspace, 'does-not-exist.txt'));
  });
});
