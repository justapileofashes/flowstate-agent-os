import { resolve, isAbsolute, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

export class PathSandboxError extends Error {
  constructor(message: string, public readonly input: string) {
    super(message);
    this.name = 'PathSandboxError';
  }
}

const NUL = '\0';

function looksAbsolute(input: string): boolean {
  if (input.length === 0) return false;
  if (input.startsWith('/') || input.startsWith('\\')) return true;
  if (/^[A-Za-z]:/.test(input)) return true;
  return false;
}

function looksUNC(input: string): boolean {
  return input.startsWith('\\\\') || input.startsWith('//');
}

export function resolveSafe(workspaceRoot: string, relPath: string): string {
  if (!isAbsolute(workspaceRoot)) {
    throw new PathSandboxError('workspaceRoot must be absolute', workspaceRoot);
  }

  if (relPath.includes(NUL)) {
    throw new PathSandboxError('path contains NUL byte', relPath);
  }

  if (looksUNC(relPath)) {
    throw new PathSandboxError('UNC paths are not allowed', relPath);
  }

  if (looksAbsolute(relPath)) {
    throw new PathSandboxError('absolute paths are not allowed', relPath);
  }

  const normalized = relPath.replaceAll('/', sep);

  const root = resolve(workspaceRoot);
  const target = normalized === '' || normalized === '.' ? root : resolve(root, normalized);

  // Verify resolved target is inside the root.
  // Append sep to root to avoid /tmp/foo matching /tmp/foobar.
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new PathSandboxError('path escapes workspace', relPath);
  }

  return target;
}

export async function resolveSafeReal(workspaceRoot: string, relPath: string): Promise<string> {
  const syntactic = resolveSafe(workspaceRoot, relPath);
  const root = resolve(workspaceRoot);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;

  let real: string;
  try {
    real = await realpath(syntactic);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Caller may be about to create the file; syntactic check already
      // confirmed the parent chain is inside the workspace.
      return syntactic;
    }
    throw err;
  }

  if (real !== root && !real.startsWith(rootWithSep)) {
    throw new PathSandboxError('symlink escapes workspace', relPath);
  }
  return real;
}
