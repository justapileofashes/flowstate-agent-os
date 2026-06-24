// Interactive terminal sessions for the in-app Terminal panel. Each session is
// a long-lived OS shell with piped stdio (NOT a PTY — no native node-pty dep, so
// it stays in lockstep with the app's existing build). Good enough for running
// commands, cd-ing around, and reading output; no full-screen curses apps.
//
// Output streams straight through to the renderer via the injected callbacks;
// the renderer keys panels by session id.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface TerminalCallbacks {
  onData: (id: string, chunk: string) => void;
  onExit: (id: string, code: number | null) => void;
}

export class TerminalService {
  private readonly sessions = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly cb: TerminalCallbacks) {}

  /** Start a shell rooted at cwd. No-op if the id is already running. */
  start(id: string, cwd: string): void {
    if (this.sessions.has(id)) return;

    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
    const args = isWin ? ['-NoLogo', '-NoProfile'] : [];

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
      return;
    }

    child.stdout.on('data', (c: Buffer) => this.cb.onData(id, c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => this.cb.onData(id, c.toString('utf8')));
    child.on('error', (err) => this.cb.onData(id, `\n[terminal error] ${err.message}\n`));
    child.on('exit', (code) => {
      this.sessions.delete(id);
      this.cb.onExit(id, code);
    });

    this.sessions.set(id, child);
  }

  /** Write raw bytes to a session's stdin (caller appends newlines / ^C etc.). */
  write(id: string, data: string): void {
    const child = this.sessions.get(id);
    if (!child) return;
    try {
      child.stdin.write(data);
    } catch {
      // session likely exiting — ignore
    }
  }

  kill(id: string): void {
    const child = this.sessions.get(id);
    if (!child) return;
    this.sessions.delete(id);
    try {
      child.kill();
    } catch {
      // already gone
    }
  }

  killAll(): void {
    for (const id of Array.from(this.sessions.keys())) this.kill(id);
  }
}
