// Runs plugin lifecycle hooks (Claude Code `hooks/hooks.json`). SECURITY: only
// hooks the PluginManager already filtered to enabled + hooks-consented plugins
// reach here — this runner does NOT re-check consent, it trusts its source. Each
// command runs in a shell with a hard timeout, in the agent's workspace, and is
// audit-logged. A non-zero exit on a PreToolUse hook blocks the tool call
// (Claude Code's deny contract); other events ignore the exit code.

import { execFile } from 'node:child_process';
import type { HookEntry } from '@main/services/plugin-types';
import type { AuditLogger } from '@main/services/audit-logger';

export interface HookContext {
  toolName?: string;
  cwd: string;
  agentId?: string;
  chatId?: string | null;
  streamId?: string | null;
}

export interface HookOutcome {
  blocked: boolean;
  reason?: string;
}

const HOOK_TIMEOUT_MS = 10_000;

function matcherMatches(matcher: string | undefined, toolName: string | undefined): boolean {
  if (!matcher || matcher === '*') return true;
  if (!toolName) return false;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return matcher === toolName || toolName.includes(matcher);
  }
}

function runCommand(command: string, ctx: HookContext): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd.exe' : '/bin/sh';
    const args = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
    execFile(
      shell,
      args,
      {
        cwd: ctx.cwd,
        timeout: HOOK_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        env: {
          ...process.env,
          FLOWSTATE_HOOK_TOOL: ctx.toolName ?? '',
          FLOWSTATE_HOOK_CWD: ctx.cwd,
        },
      },
      (err, stdout) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? (err as { code: number }).code
          : err
            ? 1
            : 0;
        resolve({ code, stdout: String(stdout ?? '') });
      },
    );
  });
}

export class HookRunner {
  constructor(
    private readonly getHooks: () => HookEntry[],
    private readonly audit?: AuditLogger,
  ) {}

  /** Fire all hooks bound to `event` whose matcher accepts the tool. Returns a
   *  block decision (only meaningful for PreToolUse). */
  async fire(event: string, ctx: HookContext): Promise<HookOutcome> {
    const hooks = this.getHooks().filter(
      (h) => h.event === event && matcherMatches(h.matcher, ctx.toolName),
    );
    if (hooks.length === 0) return { blocked: false };

    for (const h of hooks) {
      const { code, stdout } = await runCommand(h.command, ctx);
      if (this.audit && ctx.agentId) {
        this.audit.toolCall(
          { agentId: ctx.agentId, chatId: ctx.chatId ?? null, streamId: ctx.streamId ?? null },
          { toolName: `hook:${event}:${h.pluginId}`, args: { command: h.command }, ok: code === 0, durationMs: 0 },
        );
      }
      // PreToolUse: non-zero exit blocks the pending tool call.
      if (event === 'PreToolUse' && code !== 0) {
        return { blocked: true, reason: stdout.trim() || `Blocked by ${h.pluginId} hook (exit ${code}).` };
      }
    }
    return { blocked: false };
  }
}
