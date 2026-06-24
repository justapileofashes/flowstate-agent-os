import { spawn } from 'node:child_process';
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

const SCRUB_ENV_KEEP = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'TEMP',
  'TMP',
  'PATHEXT',
  'COMSPEC',
  'WINDIR',
]);

const FORBIDDEN_PREFIXES = ['sudo', 'su', 'runas', 'doas'];

function buildEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (SCRUB_ENV_KEEP.has(k) && typeof v === 'string') out[k] = v;
  }
  return out;
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

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return new Promise<ShellResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let resolved = false;

    const finish = (result: ShellResult): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(argv[0]!, argv.slice(1), {
      cwd,
      env: buildEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: controller.signal,
      windowsHide: true,
    });

    const onData =
      (kind: 'stdout' | 'stderr') =>
      (chunk: Buffer): void => {
        const total = stdout.length + stderr.length;
        const remaining = MAX_OUTPUT_BYTES - total;
        if (remaining <= 0) {
          truncated = true;
          if (!child.killed) child.kill('SIGTERM');
          return;
        }
        const slice =
          chunk.length > remaining
            ? chunk.subarray(0, remaining).toString('utf8')
            : chunk.toString('utf8');
        if (chunk.length > remaining) truncated = true;
        if (kind === 'stdout') stdout += slice;
        else stderr += slice;
        if (truncated && !child.killed) child.kill('SIGTERM');
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
