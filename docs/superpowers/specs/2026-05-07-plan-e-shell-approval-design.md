# Flowstate — Plan E: Shell Tool + Approval Gate Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent:** `2026-05-05-ai-agent-dashboard-design.md`
**Depends on:** Plan A, B, C1, C2, C3, D

## 1. Concept

Plan E adds the highest-power tool (`run_shell`) and the safety mechanism that makes it usable: a per-command approval gate. Each agent gets `tool_perms` (which tools are exposed) and `approval_policy` (cautious / trusting / yolo) controlling when execution pauses to ask the user. Pause → user clicks Allow once / Allow rest of chat / Deny → resume.

After Plan E:
- An agent with shell enabled can `npm install`, `git status`, `python script.py` etc., constrained to its workspace.
- Per-agent toggle gates whether shell is exposed at all.
- Per-chat memory of "allow rest of chat" decisions.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Migration 004 | Adds `tool_perms TEXT NOT NULL DEFAULT '{"shell_enabled":false,"delete_enabled":true}'`, `approval_policy TEXT NOT NULL DEFAULT 'cautious'` to agents | Default new agents to safest config |
| Shell impl | Node `child_process.spawn` (no shell:true). Args parsed via `shell-quote` (npm dep) so model can pass a single command string | shell:true is risky; explicit arg parsing constrains injection. Adding `shell-quote` is a small, focused dep |
| New deps | `shell-quote@^1.8` | Single small dep, ~5kB, widely used, no transitive risk |
| cwd | Always `agent.workspacePath`. Cannot be overridden | Sandbox stays intact |
| Timeout | 60s default. Approval modal lets user override per-call (extend to 300s) | Reasonable balance |
| Output cap | 1 MB combined stdout+stderr. Truncate with marker | Same convention as `read_file` cap |
| stdin | Not supported. Interactive commands fail with clear error | Spec section 11 already documented |
| Approval policies | `cautious`: prompts for shell, write-overwrite, delete; `trusting`: prompts for shell + delete only; `yolo`: never prompts (UI shows scary confirmation when chosen) | Matches spec section 6 |
| Approval scope memory | Per-chat-session in-memory: `Map<chatId, Set<approvalKey>>`. Cleared when app restarts | Avoids "Allow forever" footgun. Each new app session re-prompts |
| Approval key | `${chatId}:${toolName}` — broad: one approval covers all calls of that tool in that chat. Per-arg approval = too noisy | YAGNI-balanced; user keeps coarse control |
| Approval UI | Modal slide-in from bottom. Shows tool, command/args (monospace), cwd, three buttons: Allow once / Allow rest of chat / Deny + reason input | Spec section 5 mockup |
| Yolo mode confirmation | When user selects yolo on agent edit, prompt with bold text: "All shell commands will run without approval. This includes destructive commands. Continue?" | One-time guard at config time |
| Schema migration 003 retroactive | Code Helper backfill: `tool_perms='{"shell_enabled":true,"delete_enabled":true}'`, `approval_policy='cautious'` (since user already trusts it for testing) | Convenience for existing users |
| Tool surface delivery | `getToolSpecsForAgent(agent)` returns `FILE_TOOL_SPECS` filtered by `agent.tool_perms`, plus `SHELL_TOOL_SPEC` if `shell_enabled` | Per-agent tool spec; AgentRuntime takes it from manager |
| Approval timeout | 5 minutes. Auto-deny if no response. UI says "Waiting for approval…" | User can leave app idle without app crashing |

## 3. Schema (Migration 004)

```sql
ALTER TABLE agents ADD COLUMN tool_perms TEXT NOT NULL DEFAULT '{"shell_enabled":false,"delete_enabled":true}';
ALTER TABLE agents ADD COLUMN approval_policy TEXT NOT NULL DEFAULT 'cautious';

UPDATE agents
SET
  tool_perms = '{"shell_enabled":true,"delete_enabled":true}',
  approval_policy = 'cautious'
WHERE id = 'agent-code-helper' AND tool_perms = '{"shell_enabled":false,"delete_enabled":true}';
```

`AgentDto` (renderer) gains:

```ts
interface AgentDto {
  // existing
  toolPerms: { shell_enabled: boolean; delete_enabled: boolean };
  approvalPolicy: 'cautious' | 'trusting' | 'yolo';
}
```

## 4. Architecture changes

```
┌─────────────────────────────────────────────────────────────┐
│ AgentRuntime (existing)                                     │
│  - tool-call event → dispatcher.call(...)                    │
└────┬────────────────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────────────────────┐
│ ToolDispatcher                                               │
│  call(id, name, args)                                        │
│  ├─ approvalGate.requireIfNeeded(name, args, agent)          │
│  │     ├─ checks per-chat memory                             │
│  │     ├─ checks agent policy                                │
│  │     ├─ if needs prompt: emit tool-approval-required event │
│  │     │   wait for chat:approval-response IPC               │
│  │     └─ resolve approve/deny + remember-this-chat          │
│  ├─ if denied → return ToolResult(ok=false, "denied")        │
│  └─ else → execute tool (incl. new shell exec)               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ShellTool (new)                                              │
│  run(command, opts):                                         │
│   - shell-quote.parse(command) → argv                        │
│   - reject if argv has shell metacharacters or empty         │
│   - spawn(argv[0], argv.slice(1), { cwd, timeout, ... })     │
│   - capture stdout/stderr, cap 1MB, return                   │
└─────────────────────────────────────────────────────────────┘
```

### New shared types

```ts
// AgentEvent gains:
| { type: 'tool-approval-required'; toolCallId: string; toolName: string; args: unknown; cwd: string }
| { type: 'tool-approval-resolved'; toolCallId: string; decision: 'allow-once' | 'allow-rest' | 'deny'; reason?: string }

// New IPC channel
CHAT_APPROVAL_RESPONSE: 'chat:approval-response'

// Request shape
{ streamId: string; toolCallId: string; decision: 'allow-once' | 'allow-rest' | 'deny'; reason?: string }
```

## 5. ApprovalGate (new module)

```
src/main/agent/approval-gate.ts

class ApprovalGate {
  constructor(send: (channel, payload) => void);

  // Returns 'allow' | 'deny'. Resolves when user responds via IPC,
  // or auto-denies after 5 min.
  async require(streamId, chatId, agent, toolCallId, toolName, args, cwd): Promise<'allow' | 'deny'>;

  // Called by handler from renderer
  resolve(streamId, toolCallId, decision, reason?): void;

  // Memory bookkeeping
  private rememberAllowRest(chatId, toolName);
  private hasAllowRest(chatId, toolName): boolean;
}
```

`shouldPrompt(toolName, agent, args)` — returns boolean per policy:

| Tool | cautious | trusting | yolo |
|---|---|---|---|
| `read_file` | no | no | no |
| `list_dir` | no | no | no |
| `search_files` | no | no | no |
| `write_file` (new path) | no | no | no |
| `write_file` (overwrite) | yes | no | no |
| `delete_file` | yes | yes | no |
| `run_shell` | yes | yes | no |

`(overwrite)` distinguished by checking `existsSync` synchronously inside ApprovalGate before deciding. Cheap.

## 6. Pause/resume protocol

1. Renderer sends user message → `chat:send-message` returns `streamId`.
2. Runtime emits `tool-call` IPC event for the model's intended call.
3. Dispatcher invokes `approvalGate.require(...)`. If gate decides "must prompt":
   - emits `tool-approval-required` IPC event on `chat:event:<streamId>` channel.
   - blocks awaiting a `Promise` that the approval response fulfills.
4. Renderer's `useChatStream` (or new `useApprovalQueue`) receives the event, opens modal.
5. User clicks **Allow once** / **Allow rest of chat** / **Deny [+ reason]**.
6. Renderer calls `ipc.chat.respondToApproval({ streamId, toolCallId, decision, reason })`.
7. Main handler routes to `manager.resolveApproval(streamId, toolCallId, decision, reason)` → `approvalGate.resolve(...)`.
8. Gate's pending Promise resolves; dispatcher continues:
   - `allow-once` → execute tool
   - `allow-rest` → execute tool, store memory
   - `deny` → return `ToolResult{ ok: false, content: 'User denied this tool call' + reason }`
9. Runtime emits `tool-result`, model gets the result back.

## 7. Shell tool implementation

```ts
// src/main/tools/shell-tool.ts
import { spawn } from 'node:child_process';
import { parse as parseShell } from 'shell-quote';

const MAX_OUTPUT_BYTES = 1_000_000;
const DEFAULT_TIMEOUT_MS = 60_000;

interface ShellResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

export async function runShell(
  command: string,
  cwd: string,
  opts?: { timeoutMs?: number },
): Promise<ShellResult>;
```

Implementation guards:
1. `parseShell(command)` returns array of strings + objects (quotes/operators). Reject if any element is an object (i.e., `|`, `>`, `&&`, etc.).
2. argv[0] required; reject empty / sudo / su / runas (case-insensitive prefix check).
3. spawn with explicit env (drops most parent env vars to avoid leaking secrets; keeps PATH, HOME, SystemRoot, TEMP).
4. Bind stdin to /dev/null equivalent — child gets EOF immediately if it tries to read.
5. Combined stdout+stderr cap at 1MB; if exceeded, kill child, return truncated=true.
6. Timeout via AbortController; on abort, kill SIGTERM then SIGKILL after 2s.

```ts
// New tool spec
{
  name: 'run_shell',
  description: 'Run a non-interactive shell command in the workspace directory. No pipes, redirects, or interactive prompts. Always requires user approval (per agent policy).',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Full command with args, e.g. "npm install react".' },
    },
    required: ['command'],
  },
}
```

ToolDispatcher dispatch case:

```ts
case 'run_shell': {
  const a = parsed.data as { command: string };
  const result = await runShell(a.command, this.workspaceRoot, { timeoutMs: 60000 });
  return ok(toolCallId, name, JSON.stringify({
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    truncated: result.truncated,
    durationMs: result.durationMs,
  }));
}
```

`ToolDispatcher` constructor now takes `workspaceRoot` (it already has `FileTools` which has the path; expose as getter, or pass explicitly). Plan: pass explicitly to keep ToolDispatcher self-contained.

## 8. Renderer UI

### 8.1 Approval modal

`<ApprovalModal>` slides up from bottom on top of message list. Props:

```ts
interface PendingApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
}
```

Layout:

```
┌─────────────────────────────────────────────────┐
│ ⚠ Approval needed                              │
│                                                  │
│ Tool: run_shell                                  │
│ Working dir: C:\Users\TUF\Flowstate\workspaces…  │
│                                                  │
│ Command:                                         │
│ ┌─────────────────────────────────────────────┐ │
│ │ npm install react react-dom                  │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ Optional reason if denying: [_____________]     │
│                                                  │
│ [Deny]  [Allow once]  [Allow rest of chat]      │
└─────────────────────────────────────────────────┘
```

For non-shell tools (write_file/delete_file): show args in JSON pretty.

### 8.2 useChatStream extension

Hook gains:
- `pendingApproval: PendingApproval | null` — derived from `tool-approval-required` events
- `respondApproval(decision, reason?)` — calls `ipc.chat.respondToApproval`

While `pendingApproval !== null`, the modal renders. Composer shows "Awaiting approval…" pill in status.

### 8.3 Agent form modal additions

Two new fields on `AgentFormModal`:
- **Tool permissions** — checkbox: "Enable shell" (default off), "Enable delete" (default on)
- **Approval policy** — radio: cautious / trusting / yolo. Yolo selection triggers a confirm dialog.

## 9. Test Strategy

- **Migration 004:** schema upgrade + Code Helper backfill.
- **ApprovalGate:** `shouldPrompt` matrix per policy; `require` returns 'allow' on `allow-once` and `allow-rest`; second call with same tool+chat short-circuits if `allow-rest`; auto-deny after 5 min (test with shorter timeout via DI).
- **ShellTool:** happy path (`echo hello`), arg-only (no pipes/redirects/operators), reject sudo, timeout kills, output truncation, non-existent binary returns ok=false.
- **ToolDispatcher integration:** wires `approvalGate` into call flow; denied call returns ok=false; approved call executes.
- **AgentSessionManager:** `resolveApproval(streamId, ...)` routes to gate.
- **IPC schemas:** chat:approval-response request shape.
- **No renderer unit tests** (manual smoke for modal).

## 10. Manual smoke test

1. Restart app — migration 004 applies. Code Helper has shell enabled.
2. Open Code Helper chat. Send "Show me node version" or similar.
3. Expect tool-call card → approval modal slides up showing `run_shell("node --version")`, cwd. Click **Allow once**. Modal closes. Result lands in card. Final assistant text quotes the version.
4. Send "List directory contents" → list_dir runs without approval (read-only).
5. Send "Create file foo.txt with hello, then run cat foo.txt" → write_file runs (new file, no approval), then approval modal for `cat foo.txt`. **Allow rest of chat**. Modal closes. Subsequent shell commands in the same chat skip the modal.
6. Reload app. Same chat. Send shell command — modal returns (memory cleared on restart).
7. Edit Code Helper → set policy "yolo". Confirm scary dialog. Send shell command → no modal.
8. Create new agent with shell DISABLED. Try to ask it to run shell → model gets a no-tool response, since the spec isn't sent.
9. Test denial: shell command, click **Deny "I don't trust this"**. Tool result shows denial reason; model recovers gracefully.
10. Test timeout: ask agent to run `node -e "while(true){}"`. After 60s, command killed; tool result includes truncated/timeout flag.

## 11. Out of Scope (Plans F / G)

- Orchestrator routing — Plan F.
- Container isolation for shell (e.g., Docker) — future.
- Workspace `.gitignore` auto-creation — Plan G.
- Approval persistence across app restarts — explicitly out (per spec).
- Per-command timeout override in approval modal — defer (current is fixed 60s; modal can ship with extend-to-300s knob in Plan G).
- Shell streaming output to UI — defer; v1 returns final stdout/stderr only after completion.

## 12. Resolved Decisions

- Single dep added: `shell-quote`. No others.
- Approval modal is per-stream; only one at a time per agent (model emits sequential tool calls).
- `allow-rest` is per-chat + per-tool-name; agent restart clears.
- `yolo` is fully unattended; a one-time scary dialog at agent edit is the only friction.
- Default new agents are `cautious` + shell disabled.
