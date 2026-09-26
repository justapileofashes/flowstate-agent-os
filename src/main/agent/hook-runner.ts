// Runs plugin lifecycle hooks (Claude Code `hooks/hooks.json`). SECURITY: only
// hooks the PluginManager already filtered to enabled + hooks-consented plugins
// reach here — this runner does NOT re-check consent, it trusts its source. Each
// command runs in a shell with a hard timeout, in the agent's workspace, and is
// audit-logged.
//
// Claude Code's hook contract: the event arrives as JSON on stdin; exit code 2
// blocks (stderr is the reason); a JSON reply on stdout can also block
// ({"decision":"block"} or a PreToolUse permissionDecision of "deny"). Any
// other non-zero exit is a hook error, logged but not a veto.

import { spawn } from 'node:child_process';
import type { HookEntry } from '@main/services/plugin-types';
import type { AuditLogger } from '@main/services/audit-logger';

export interface HookContext {
  toolName?: string;
  /** The tool call's arguments (Claude Code's `tool_input`). */
  toolInput?: unknown;
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
const MAX_OUTPUT = 256 * 1024;

function matcherMatches(matcher: string | undefined, toolName: string | undefined): boolean {
  if (!matcher || matcher === '*') return true;
  if (!toolName) return false;
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    return matcher === toolName || toolName.includes(matcher);
  }
}

function runCommand(
  command: string,
  input: string,
  ctx: HookContext,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/d', '/s', '/c', command] : ['-c', command], {
      cwd: ctx.cwd,
      windowsHide: true,
      windowsVerbatimArguments: isWin,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: ctx.cwd,
        FLOWSTATE_HOOK_TOOL: ctx.toolName ?? '',
        FLOWSTATE_HOOK_CWD: ctx.cwd,
      },
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(124);
    }, HOOK_TIMEOUT_MS);
    child.stdout.on('data', (b: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += b.toString();
    });
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += b.toString();
    });
    child.on('error', () => finish(1));
    child.on('close', (code) => finish(code ?? 1));
    child.stdin.on('error', () => {
      // hook didn't read stdin — fine
    });
    child.stdin.end(input);
  });
}

/** A JSON verdict on stdout, if the hook printed one. */
function jsonVerdict(stdout: string): HookOutcome | null {
  const text = stdout.trim();
  if (!text.startsWith('{')) return null;
  try {
    const o = JSON.parse(text) as {
      decision?: unknown;
      reason?: unknown;
      hookSpecificOutput?: { permissionDecision?: unknown; permissionDecisionReason?: unknown };
    };
    const reason =
      typeof o.reason === 'string'
        ? o.reason
        : typeof o.hookSpecificOutput?.permissionDecisionReason === 'string'
          ? o.hookSpecificOutput.permissionDecisionReason
          : undefined;
    if (o.decision === 'block' || o.hookSpecificOutput?.permissionDecision === 'deny') {
      return { blocked: true, ...(reason ? { reason } : {}) };
    }
  } catch {
    // not JSON
  }
  return null;
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

    const input = JSON.stringify({
      session_id: ctx.chatId ?? ctx.streamId ?? '',
      hook_event_name: event,
      cwd: ctx.cwd,
      ...(ctx.toolName ? { tool_name: ctx.toolName } : {}),
      ...(ctx.toolInput !== undefined ? { tool_input: ctx.toolInput } : {}),
    });

    for (const h of hooks) {
      const { code, stdout, stderr } = await runCommand(h.command, input, ctx);
      if (this.audit && ctx.agentId) {
        this.audit.toolCall(
          { agentId: ctx.agentId, chatId: ctx.chatId ?? null, streamId: ctx.streamId ?? null },
          { toolName: `hook:${event}:${h.pluginId}`, args: { command: h.command }, ok: code === 0, durationMs: 0 },
        );
      }
      if (event !== 'PreToolUse') continue;
      if (code === 2) {
        return { blocked: true, reason: stderr.trim() || stdout.trim() || `Blocked by ${h.pluginId} hook.` };
      }
      const verdict = code === 0 ? jsonVerdict(stdout) : null;
      if (verdict?.blocked) {
        return { blocked: true, reason: verdict.reason ?? `Blocked by ${h.pluginId} hook.` };
      }
    }
    return { blocked: false };
  }
}
