// Minimal Model Context Protocol (MCP) client over stdio + newline-delimited
// JSON. One instance per configured server. Speaks the subset of MCP that
// Flowstate needs: initialize handshake, tools/list, tools/call. Resources
// and prompts are out of scope for v1.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema: object;
}

export interface McpServerConfig {
  /** Stable id (alphanumeric + _, used as the tool-name prefix). */
  id: string;
  /** Pretty display name. */
  name: string;
  /** Executable. */
  command: string;
  /** CLI args. */
  args: string[];
  /** Extra env vars. */
  env?: Record<string, string>;
  /** Working directory. */
  cwd?: string;
}

export type McpClientState = 'idle' | 'starting' | 'ready' | 'error' | 'exited';

/**
 * Resolve how to hand a command to `child_process.spawn` per platform.
 *
 * On Windows the connector commands (`npx`, `uvx`, …) are `.cmd`/`.bat` shims.
 * Node refuses to spawn those without `shell: true` (ENOENT, and EINVAL even if
 * you append `.cmd` — the CVE-2024-27980 guard). But under `shell: true` Node
 * does NOT quote args, so any path/token with whitespace or a cmd
 * metacharacter would be split or interpreted. So on win32 we shell out AND
 * quote args ourselves. POSIX spawns the binary directly, no quoting needed.
 */
export function resolveSpawn(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; shell: boolean } {
  if (platform !== 'win32') return { command, args, shell: false };
  const quote = (a: string): string =>
    /[\s"&|<>^()%!]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a;
  return { command: quote(command), args: args.map(quote), shell: true };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 30_000;
const PROTOCOL_VERSION = '2024-11-05';

export class McpClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rxBuffer = '';
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private _state: McpClientState = 'idle';
  private _tools: McpToolSpec[] = [];
  private _lastError: string | null = null;
  // Rolling tail of the child's stderr, so a failed handshake/early exit can
  // report the real cause (missing runner, bad token, package error) instead
  // of just "exited with code 1".
  private stderrTail = '';

  constructor(public readonly config: McpServerConfig) {
    super();
  }

  get state(): McpClientState {
    return this._state;
  }
  get tools(): McpToolSpec[] {
    return this._tools;
  }
  get lastError(): string | null {
    return this._lastError;
  }

  private setState(next: McpClientState): void {
    this._state = next;
    this.emit('state', next);
  }

  async start(): Promise<void> {
    if (this._state === 'ready' || this._state === 'starting') return;
    this._lastError = null;
    this.setState('starting');

    try {
      const sp = resolveSpawn(this.config.command, this.config.args);
      this.child = spawn(sp.command, sp.args, {
        stdio: 'pipe',
        env: { ...process.env, ...(this.config.env ?? {}) },
        ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
        windowsHide: true,
        shell: sp.shell,
      });
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err);
      this.setState('error');
      throw new Error(`MCP server "${this.config.id}" failed to spawn: ${this._lastError}`);
    }

    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
      // Best-effort log; do not throw on noisy servers
      // eslint-disable-next-line no-console
      console.warn(`[mcp:${this.config.id}] ${chunk.trim()}`);
    });
    this.child.on('error', (err) => {
      this._lastError = err.message;
      this.setState('error');
      this.failAllPending(err);
    });
    this.child.on('exit', (code) => {
      this.setState('exited');
      const tail = this.stderrTail
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-3)
        .join(' ')
        .slice(0, 300);
      const msg = `Server exited with code ${code ?? '?'}` + (tail ? `: ${tail}` : '');
      this.failAllPending(new Error(msg));
    });

    try {
      // 1. initialize handshake
      await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'flowstate', version: '0.0.1' },
      });
      // 2. announce we are initialized (notification — no response)
      this.notify('notifications/initialized', {});
      // 3. fetch tool list
      const toolsRes = (await this.request('tools/list', {})) as {
        tools?: McpToolSpec[];
      };
      this._tools = Array.isArray(toolsRes?.tools) ? toolsRes.tools : [];
      this.setState('ready');
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : String(err);
      this.setState('error');
      this.stop();
      throw err;
    }
  }

  stop(): void {
    this.failAllPending(new Error('Client stopped'));
    if (this.child && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        // best-effort
      }
    }
    this.child = null;
    if (this._state !== 'error') this.setState('exited');
  }

  async callTool(toolName: string, args: unknown): Promise<{ content: string; isError: boolean }> {
    if (this._state !== 'ready') {
      throw new Error(`MCP server "${this.config.id}" is not ready (state: ${this._state}).`);
    }
    const res = (await this.request('tools/call', {
      name: toolName,
      arguments: args ?? {},
    })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = Array.isArray(res?.content)
      ? res.content
          .map((c) => (typeof c?.text === 'string' ? c.text : JSON.stringify(c)))
          .join('\n')
      : JSON.stringify(res);
    return { content: text, isError: Boolean(res?.isError) };
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child) return Promise.reject(new Error('Client not started'));
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child!.stdin.write(payload + '\n');
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) return;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, params });
    try {
      this.child.stdin.write(payload + '\n');
    } catch {
      // ignored — notifications are best-effort
    }
  }

  private onData(chunk: string): void {
    this.rxBuffer += chunk;
    // Split on LF; keep the trailing partial line in the buffer
    let idx: number;
    while ((idx = this.rxBuffer.indexOf('\n')) !== -1) {
      const line = this.rxBuffer.slice(0, idx).trim();
      this.rxBuffer = this.rxBuffer.slice(idx + 1);
      if (line.length === 0) continue;
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string } } | null;
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`[mcp:${this.config.id}] invalid JSON: ${line.slice(0, 200)}`);
      return;
    }
    if (!msg || typeof msg.id !== 'number') return; // notification or malformed
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) {
      entry.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    } else {
      entry.resolve(msg.result);
    }
  }

  private failAllPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }
}
