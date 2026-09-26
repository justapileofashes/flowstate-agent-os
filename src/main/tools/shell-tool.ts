import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseShell } from 'shell-quote';

export interface ShellResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

const MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;

// Matched case-insensitively: Windows spells these Path, ComSpec, windir, …
// npm/npx need APPDATA/LOCALAPPDATA for their caches and global prefix.
const SCRUB_ENV_KEEP = new Set([
  'PATH',
  'PATHEXT',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'TERM',
  'TMPDIR',
  'USERPROFILE',
  'USERNAME',
  'USERDOMAIN',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'OS',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
]);

const FORBIDDEN_PREFIXES = ['sudo', 'su', 'runas', 'doas'];

export function buildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (SCRUB_ENV_KEEP.has(k.toUpperCase()) && typeof v === 'string') out[k] = v;
  }
  return out;
}

// cmd.exe built-ins have no executable on PATH.
const CMD_BUILTINS = new Set([
  'assoc', 'cd', 'chdir', 'cls', 'copy', 'date', 'del', 'dir', 'echo', 'erase',
  'md', 'mkdir', 'mklink', 'move', 'path', 'rd', 'ren', 'rename', 'rmdir',
  'set', 'time', 'title', 'type', 'ver', 'vol',
]);
// Characters cmd.exe interprets even inside quotes; rejecting them keeps the
// "no shell metacharacters" guarantee when a .cmd/.bat has to go through cmd.
const CMD_UNSAFE = /[&|<>^%!"\r\n]/;

type WinTarget =
  | { kind: 'exe' | 'batch' | 'ps1'; path: string }
  | { kind: 'builtin'; name: string }
  | { kind: 'missing' };

function envGet(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toUpperCase() === key);
  return k ? env[k] : undefined;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Resolve a command the way cmd.exe would: PATH × PATHEXT, then .ps1 shims. */
export function resolveWindowsCommand(cmd: string, env: NodeJS.ProcessEnv, cwd: string): WinTarget {
  const kindOf = (p: string): 'exe' | 'batch' | 'ps1' => {
    const ext = extname(p).toLowerCase();
    return ext === '.cmd' || ext === '.bat' ? 'batch' : ext === '.ps1' ? 'ps1' : 'exe';
  };
  const exts = (envGet(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => ['.com', '.exe', '.bat', '.cmd'].includes(e));
  const hasDir = /[\\/]/.test(cmd) || isAbsolute(cmd);
  const dirs = hasDir ? [''] : [cwd, ...(envGet(env, 'PATH') ?? '').split(delimiter).filter(Boolean)];
  const base = (d: string): string => (d ? join(d, cmd) : resolve(cwd, cmd));

  if (extname(cmd)) {
    for (const d of dirs) if (isFile(base(d))) return { kind: kindOf(base(d)), path: base(d) };
  }
  if (!hasDir && CMD_BUILTINS.has(cmd.toLowerCase())) return { kind: 'builtin', name: cmd.toLowerCase() };
  for (const d of dirs) {
    for (const ext of exts) {
      const p = base(d) + ext;
      if (isFile(p)) return { kind: kindOf(p), path: p };
    }
  }
  for (const d of dirs) {
    const p = base(d) + '.ps1';
    if (isFile(p)) return { kind: 'ps1', path: p };
  }
  return { kind: 'missing' };
}

function quoteCmdArg(a: string): string {
  return a.length === 0 || /[\s()]/.test(a) ? `"${a}"` : a;
}

/** Build the spawn call for argv on this platform (Windows needs cmd/powershell for shims). */
function planSpawn(
  argv: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): { cmd: string; args: string[]; verbatim: boolean } | { error: string } {
  if (process.platform !== 'win32') return { cmd: argv[0]!, args: argv.slice(1), verbatim: false };
  const target = resolveWindowsCommand(argv[0]!, env, cwd);
  switch (target.kind) {
    case 'missing':
      return { error: `command not found: ${argv[0]}` };
    case 'exe':
      return { cmd: target.path, args: argv.slice(1), verbatim: false };
    case 'ps1':
      return {
        cmd: 'powershell.exe',
        args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', target.path, ...argv.slice(1)],
        verbatim: false,
      };
    case 'batch':
    case 'builtin': {
      const bad = argv.find((a) => CMD_UNSAFE.test(a));
      if (bad !== undefined) return { error: `shell metacharacter not allowed: ${JSON.stringify(bad)}` };
      const head = target.kind === 'builtin' ? target.name : `"${target.path}"`;
      const line = [head, ...argv.slice(1).map(quoteCmdArg)].join(' ');
      return { cmd: envGet(env, 'COMSPEC') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
    }
  }
}

function fail(stderr: string, durationMs: number): ShellResult {
  return {
    ok: false,
    exitCode: null,
    stdout: '',
    stderr,
    truncated: false,
    durationMs,
  };
}

export async function runShell(
  command: string,
  cwd: string,
  opts?: { timeoutMs?: number },
): Promise<ShellResult> {
  const started = Date.now();
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return fail('empty command', 0);
  }

  const tokens = parseShell(trimmed);
  if (tokens.length === 0) {
    return fail('empty command after parse', Date.now() - started);
  }
  for (const t of tokens) {
    if (typeof t !== 'string') {
      return fail(
        `shell metacharacter not allowed: ${JSON.stringify(t)}`,
        Date.now() - started,
      );
    }
  }
  const argv = tokens as string[];
  const head = argv[0]!.toLowerCase();
  if (FORBIDDEN_PREFIXES.includes(head)) {
    return fail(`command "${argv[0]}" is not allowed`, Date.now() - started);
  }

  const env = buildEnv();
  const plan = planSpawn(argv, cwd, env);
  if ('error' in plan) return fail(plan.error, Date.now() - started);

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<ShellResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let resolved = false;

    const child = spawn(plan.cmd, plan.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: plan.verbatim,
    });

    // On Windows a .cmd shim runs under cmd.exe, so killing the direct child
    // would orphan the real process (npm → node); take down the whole tree.
    let killed = false;
    const killTree = (): void => {
      if (killed) return;
      killed = true;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
          'error',
          () => child.kill(),
        );
      } else {
        child.kill('SIGTERM');
      }
    };
    const timer = setTimeout(killTree, timeoutMs);

    const finish = (result: ShellResult): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    const onData =
      (kind: 'stdout' | 'stderr') =>
      (chunk: Buffer): void => {
        const total = stdout.length + stderr.length;
        const remaining = MAX_OUTPUT_BYTES - total;
        if (remaining <= 0) {
          truncated = true;
          killTree();
          return;
        }
        const slice =
          chunk.length > remaining
            ? chunk.subarray(0, remaining).toString('utf8')
            : chunk.toString('utf8');
        if (chunk.length > remaining) truncated = true;
        if (kind === 'stdout') stdout += slice;
        else stderr += slice;
        if (truncated) killTree();
      };

    child.stdout.on('data', onData('stdout'));
    child.stderr.on('data', onData('stderr'));
    child.on('error', (err) => {
      const msg =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? `command not found: ${argv[0]}`
          : err.message;
      finish({
        ok: false,
        exitCode: null,
        stdout,
        stderr: stderr || msg,
        truncated,
        durationMs: Date.now() - started,
      });
    });
    child.on('close', (code) => {
      finish({
        ok: code === 0 && !truncated,
        exitCode: code,
        stdout,
        stderr,
        truncated,
        durationMs: Date.now() - started,
      });
    });
  });
}
