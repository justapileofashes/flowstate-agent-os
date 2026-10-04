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

/** Claude Code's name and `tool_input` shape for one of our tools, so CC plugin
 *  hooks (matchers like "Bash" or "Edit|Write", scripts reading
 *  `tool_input.file_path`) work unchanged. Unknown tools pass through — MCP
 *  tools already share CC's `mcp__<server>__<tool>` naming. */
export function claudeCodeTool(name: string, input: unknown): { name: string; input: unknown } {
  let args = input;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // not JSON — hand the raw string through
    }
  }
  const obj = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  // Keep our `path` and add CC's `file_path`, so either kind of hook script reads it.
  const withFilePath = (): unknown =>
    obj && typeof obj['path'] === 'string' ? { ...obj, file_path: obj['path'] } : args;
  switch (name) {
    case 'run_shell':
      return { name: 'Bash', input: args };
    case 'read_file':
      return { name: 'Read', input: withFilePath() };
    case 'write_file':
      return { name: 'Write', input: withFilePath() };
    case 'edit_file':
      return { name: 'Edit', input: withFilePath() };
    case 'list_dir':
      return { name: 'LS', input: args };
    case 'search_files':
      return { name: obj?.['kind'] === 'content' ? 'Grep' : 'Glob', input: args };
    case 'web_search':
      return { name: 'WebSearch', input: args };
    case 'fetch_url':
      return { name: 'WebFetch', input: args };
    default:
      return { name, input: args };
  }
}

/** Claude Code matcher semantics: a plain name (or `a|b` list) matches exactly,
 *  anything else is a regex. `names` holds our tool name and its CC alias. */
export function matcherMatches(matcher: string | undefined, names: string[]): boolean {
  if (!matcher || matcher === '*') return true;
  if (names.length === 0) return false;
  if (/^[\w|]+$/.test(matcher)) {
    const wanted = matcher.split('|').filter(Boolean);
    return names.some((n) => wanted.includes(n));
  }
  try {
    const re = new RegExp(matcher);
    return names.some((n) => re.test(n));
  } catch {
    return names.includes(matcher);
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
    const cc = ctx.toolName ? claudeCodeTool(ctx.toolName, ctx.toolInput) : null;
    const names = ctx.toolName && cc ? [...new Set([ctx.toolName, cc.name])] : [];
    const hooks = this.getHooks().filter((h) => h.event === event && matcherMatches(h.matcher, names));
    if (hooks.length === 0) return { blocked: false };

    // Hooks come from Claude Code plugins, so they see CC's tool name and input.
    const input = JSON.stringify({
      session_id: ctx.chatId ?? ctx.streamId ?? '',
      hook_event_name: event,
      cwd: ctx.cwd,
      ...(cc ? { tool_name: cc.name } : {}),
      ...(ctx.toolInput !== undefined ? { tool_input: cc ? cc.input : ctx.toolInput } : {}),
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
