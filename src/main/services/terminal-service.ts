// Interactive terminal sessions for the in-app Terminal panel.
//
// Sessions run in a real pseudo-terminal (node-pty → ConPTY on Windows) so
// full-screen TUIs like Claude Code, Codex, Gemini CLI and opencode work: they
// see a TTY, get resize events and can read raw keystrokes. If the native
// module can't be loaded, sessions fall back to a plain piped shell (commands
// and output still work, TUIs don't).
//
// Output streams straight through to the renderer via the injected callbacks;
// the renderer keys panels by session id.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { IPty } from '@lydell/node-pty';

export type PtyModule = typeof import('@lydell/node-pty');

export interface TerminalCallbacks {
  onData: (id: string, chunk: string) => void;
  onExit: (id: string, code: number | null) => void;
}

type Session =
  | { kind: 'pty'; pty: IPty }
  | { kind: 'pipe'; child: ChildProcessWithoutNullStreams };

export class TerminalService {
  private readonly sessions = new Map<string, Session>();
  private ptyModule: PtyModule | null | undefined;

  constructor(
    private readonly cb: TerminalCallbacks,
    /** Loads node-pty; returning null (or throwing) selects the pipe fallback. */
    private readonly loadPty: () => PtyModule | null = () => null,
  ) {}

  /** True when sessions get a real TTY. */
  get hasPty(): boolean {
    if (this.ptyModule === undefined) {
      try {
        this.ptyModule = this.loadPty();
      } catch (err) {
        console.warn('[terminal] node-pty unavailable, using piped shells:', err);
        this.ptyModule = null;
      }
    }
    return this.ptyModule !== null;
  }

  /** Start a shell rooted at cwd. No-op if the id is already running. */
  start(id: string, cwd: string, size: { cols?: number; rows?: number } = {}): { pty: boolean } {
    if (this.sessions.has(id)) return { pty: this.sessions.get(id)!.kind === 'pty' };

    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const args = isWin ? ['-NoLogo', '-NoProfile'] : [];

    if (this.hasPty) {
      try {
        const pty = this.ptyModule!.spawn(cmd, args, {
          name: 'xterm-256color',
          cols: clamp(size.cols, 20, 500, 100),
          rows: clamp(size.rows, 5, 200, 30),
          cwd,
          env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
        });
        pty.onData((d) => this.cb.onData(id, d));
        pty.onExit(({ exitCode }) => {
          if (this.sessions.get(id)?.kind === 'pty') this.sessions.delete(id);
          this.cb.onExit(id, exitCode);
        });
        this.sessions.set(id, { kind: 'pty', pty });
        return { pty: true };
      } catch (err) {
        this.cb.onData(id, `\r\n[pty failed to start: ${(err as Error).message}; using a piped shell]\r\n`);
      }
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: process.env, // a user terminal gets the full environment
        windowsHide: true,
      });
    } catch (err) {
      this.cb.onData(id, `\n[terminal failed to start] ${(err as Error).message}\n`);
      this.cb.onExit(id, null);
      return { pty: false };
    }

    child.stdout.on('data', (c: Buffer) => this.cb.onData(id, c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => this.cb.onData(id, c.toString('utf8')));
    child.on('error', (err) => this.cb.onData(id, `\n[terminal error] ${err.message}\n`));
    child.on('exit', (code) => {
      this.sessions.delete(id);
      this.cb.onExit(id, code);
    });

    this.sessions.set(id, { kind: 'pipe', child });
    return { pty: false };
  }

  /** Write raw bytes to a session's stdin (caller appends newlines / ^C etc.). */
  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    try {
      if (s.kind === 'pty') s.pty.write(data);
      else s.child.stdin.write(data);
    } catch {
      // session likely exiting — ignore
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (s?.kind !== 'pty') return;
    try {
      s.pty.resize(clamp(cols, 20, 500, 100), clamp(rows, 5, 200, 30));
    } catch {
      // resizing an exiting pty throws — ignore
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    try {
      if (s.kind === 'pty') s.pty.kill();
      else s.child.kill();
    } catch {
      // already gone
    }
  }

  killAll(): void {
    for (const id of Array.from(this.sessions.keys())) this.kill(id);
  }
}

function clamp(n: number | undefined, min: number, max: number, fallback: number): number {
  if (n === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
