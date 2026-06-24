# Phase 1c — Automatic Safety Checkpoints (rollback points) — Design

Date: 2026-06-06
Branch: session/connector-hardening
Builds on: 1a audit log, 1b constitutions, existing SnapshotService.

## Goal
Guarantee the user can always undo an agent's destructive change by automatically taking a
workspace snapshot immediately BEFORE a destructive tool call (delete_file, overwriting
write_file, run_shell). The existing Snapshots UI already restores; this makes the *capture*
automatic so there's always a recent restore point.

## Design decision — why not auto-RESTORE
"Automatic rollback on breach" is tempting but unsafe to do silently: reverting the workspace
can itself destroy good work, and a constitution `deny` already blocks the bad action before it
happens (nothing to undo). So 1c automates the *checkpoint* (always recoverable) and leaves
restoration explicit/user-initiated. This is the honest, safe shape for a local tool.

## Components
- `agent/checkpoint-policy.ts` (pure):
  - `shouldCheckpoint(toolName, { isOverwrite }): boolean` — true for `delete_file`,
    `run_shell`, and `write_file` only when overwriting an existing file.
  - `dueForCheckpoint(lastTs, now, minGapMs): boolean` — throttle so a burst of destructive
    calls doesn't snapshot on every one (default gap 15s).
  - `checkpointLabel(toolName): string` — e.g. `auto: before delete_file`.
- `tool-dispatcher.ts`: optional `snapshots?: SnapshotService` dep + a per-dispatcher
  `lastCheckpointTs`. In `callInner`, after approval is granted and before executing a
  destructive branch, call `maybeCheckpoint(...)`: if `shouldCheckpoint` && `dueForCheckpoint`,
  `await snapshots.create(...)`, audit a `checkpoint` event, update the timestamp. Wrapped so a
  snapshot failure never blocks the tool call.
- `services/audit-logger.ts`: new `checkpoint(ctx, { detail })` helper; `AuditEventType` gains
  `'checkpoint'` (DB column is free TEXT — no migration).
- `agent-session-manager.ts` + `coordinator.ts`: pass `snapshots` into the dispatcher.
- `index.ts`: hand the existing `snapshots` service to the manager + coordinator.
- Renderer `AuditButton.tsx`: render the `checkpoint` event type.

## Data flow
destructive tool call → approval allow → `maybeCheckpoint` → (throttle ok) →
`SnapshotService.create` → audit `checkpoint` → execute tool.

## Error handling
- Snapshot failure is caught and ignored (best-effort; never blocks the agent).
- Throttle prevents runaway snapshotting; SnapshotService already caps at 25/agent and prunes.

## Testing (local, no sqlite)
- `tests/main/agent/checkpoint-policy.test.ts`: shouldCheckpoint truth table (delete/shell/
  overwrite vs read/list/non-overwrite write), dueForCheckpoint gap logic (first call, within
  gap, past gap), label format.

## Verification
Typecheck clean (node + web); policy tests green. Manual: with a populated workspace, have the
agent delete/overwrite a file, confirm an `auto: before …` snapshot appears in the Snapshots
dropdown and a `checkpoint` entry in the Audit log.
