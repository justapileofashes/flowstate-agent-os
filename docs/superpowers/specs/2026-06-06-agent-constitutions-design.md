# Phase 1b — Agent Constitutions — Design

Date: 2026-06-06
Branch: session/connector-hardening
Builds on: Phase 1a audit log.

## Goal
Configurable per-agent rules ("a constitution") that the approval gate enforces BEFORE
its built-in policy: hard-`deny` dangerous actions, force an `ask` even under a trusting/yolo
policy, or pre-`allow` known-safe actions. Every constitution decision is audited.

## Why this shape
- The approval gate is already the single chokepoint for risky tool calls (Phase 1a proved it).
- Rules load from a workspace file `.flowstate/constitution.json` — same pattern as the existing
  CLAUDE.md / .flowstaterules reading in agent-session-manager. No DB migration, no agent-CRUD/
  form changes this slice.
- The evaluator is a **pure function** → fully unit-testable locally (sidesteps the unbuilt
  better-sqlite3 binding that blocks db tests).

## Rule model
`.flowstate/constitution.json` = JSON array, first matching rule wins:

```json
[
  { "effect": "deny", "tool": "run_shell", "pattern": "rm\\s+-rf", "description": "no recursive force delete" },
  { "effect": "ask",  "tool": "write_file", "pattern": "\\.env$", "description": "confirm secret-file writes" },
  { "effect": "allow", "tool": "read_file", "description": "reads are always fine" }
]
```

- `effect`: `'deny' | 'ask' | 'allow'` (required).
- `tool`: tool name, or `'*'`/absent = any tool.
- `pattern`: regex tested against a match string built from the tool name + raw arg
  string/number values (NOT redacted — rules need to see `rm -rf`). Absent = matches any args.
- `description`: optional, surfaced in the audit detail + (later) UI.

## Components
- `agent/constitution.ts` (pure + loader):
  - types `ConstitutionRule`, `ConstitutionEffect`.
  - `evaluateConstitution(rules, { toolName, args }): ConstitutionEffect | null` — first match
    wins; bad regex in a rule is skipped (never throws).
  - `loadConstitution(workspacePath): Promise<ConstitutionRule[]>` — reads + zod-validates the
    file; returns `[]` on missing/invalid (never throws).
- `approval-gate.ts`: `ApprovalRequireOpts` gains `constitution?: ConstitutionRule[]`.
  In `require()`, evaluate first:
  - `deny`  → audit `constitution-deny`, return `'deny'` WITHOUT prompting.
  - `allow` → return `'allow'` (skip prompt + policy).
  - `ask`   → force a prompt even under yolo, bypassing the allow-rest memo; audited via the
    normal resolve path.
  - `null`  → fall through to existing `shouldPrompt` + memo logic unchanged.
- `tool-dispatcher.ts`: `ToolDispatcherDeps` gains `constitution?`; passes it into
  `gate.require(...)`. A constitution `deny` surfaces as a clear failure result.
- `agent-session-manager.ts` + `coordinator.ts`: load the constitution once at run start
  (alongside project-rules reading) and inject into the dispatcher.

## Data flow
run start → `loadConstitution(workspace)` → rules → dispatcher dep → `gate.require` →
`evaluateConstitution` → deny/ask/allow/none → (audit) → existing flow.

## Error handling
- Missing/invalid file or rule → ignored (best-effort; never blocks a run).
- Invalid regex in a rule → that rule is skipped, others still evaluated.
- Loader and evaluator never throw.

## Testing (all local, no sqlite)
- `tests/main/agent/constitution.test.ts`:
  - first-match-wins ordering; tool + `*` matching; pattern match/no-match.
  - deny/ask/allow returned correctly; `null` when nothing matches.
  - invalid regex rule skipped, not fatal.
  - `loadConstitution` returns `[]` for missing/garbage files; parses a valid file.

## Verification
`npm run typecheck` clean (node + web); constitution tests green. Manual: drop a
`.flowstate/constitution.json` with a `deny rm -rf` rule into a workspace, ask the agent to
run it, confirm it's blocked and shows in the Audit log as `constitution-deny`.

## Out of scope (later)
- UI editor for rules (Phase 1b-follow / customize drawer).
- Per-agent rules in the DB + agent form (deferred until the file-based flow proves out).
- Phase 1c auto-rollback when a rule is violated mid-run.
