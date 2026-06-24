# Phase 1a — Agent Audit Log + Explainability — Design

Date: 2026-06-06
Branch: session/connector-hardening

## Goal
A tamper-evident, queryable record of everything an agent does, so the user can answer
"what did this agent actually do, and why?" — and a "forget" command to erase it
(privacy-first, user-owned data). This is the trust foundation the rest of Phase 1 builds on.

## Scope (this slice)
- Record every **tool call** (name, arg summary, ok/fail, duration, output size).
- Record every **approval decision** (required, allowed-once/allowed-rest/denied, auto-deny).
- Record every **snapshot restore** (rollback events).
- Optional **rationale** string attached to a tool call (model's stated reason — wired now,
  populated opportunistically; empty is fine for MVP).
- Read UI: a per-agent / per-chat **timeline** in the chat header (mirrors SnapshotsButton).
- "**Forget**" action: clear log scoped to an agent (and a global clear-all).

Out of scope: bias detection, constitutions, auto-rollback (Phases 1b–1d).

## Data model
New migration `006_audit_log.sql`:

```sql
CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,          -- epoch ms
  agent_id    TEXT NOT NULL,
  chat_id     TEXT,
  stream_id   TEXT,
  event_type  TEXT NOT NULL,             -- 'tool_call' | 'approval' | 'rollback'
  tool_name   TEXT,
  decision    TEXT,                      -- approval result, when event_type='approval'
  ok          INTEGER,                   -- 1/0/NULL for tool_call outcome
  duration_ms INTEGER,
  arg_summary TEXT,                      -- short, redacted one-liner of args
  detail      TEXT,                      -- optional longer note / rationale
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_agent ON audit_log(agent_id, ts DESC);
CREATE INDEX idx_audit_chat  ON audit_log(chat_id, ts DESC);
```

## Components
- `repos/audit-repository.ts` — `AuditRepository`: `append(entry)`, `list(filter)`,
  `clear({agentId?})`, `count(filter)`. Pure SQLite, synchronous (better-sqlite3).
- `services/audit-logger.ts` — `AuditLogger`: thin façade over the repo with helper methods
  `toolCall(...)`, `approval(...)`, `rollback(...)` that build + persist an entry and never
  throw (logging must not break a run). Injected where events happen.
- Wiring:
  - `ToolDispatcher` gains optional `audit?: AuditLogger`; logs after each `call()` with
    name, ok, durationMs, arg summary. Arg summary is a redacted truncation (paths kept,
    secrets/long content stripped).
  - `ApprovalGate` gains optional `audit?: AuditLogger`; logs in `require()` (required) and
    `resolve()` (decision) and on auto-deny timeout.
  - `snapshots` restore handler logs a `rollback` event.
- IPC: `AUDIT_LIST`, `AUDIT_CLEAR` channels + zod schemas + `AuditEntryDto`.
- `handlers/audit.ts` registered in `register.ts`.
- preload `ipc.audit.{list,clear}`; `lib/ipc.ts` types.
- Renderer `chat/AuditButton.tsx` — dropdown timeline like `SnapshotsButton`, gated behind
  a new `headerPrefs.audit` toggle; "Forget this agent's history" button with confirm.

## Data flow
agent run → `ToolDispatcher.call` → (after result) `audit.toolCall(...)` → repo INSERT.
approval prompt → `ApprovalGate.require/resolve` → `audit.approval(...)` → repo INSERT.
UI opens → `ipc.audit.list({agentId})` → repo SELECT → timeline render.
Forget → `ipc.audit.clear({agentId})` → repo DELETE.

## Error handling
- Logger swallows all errors (best-effort; a failed insert must never abort an agent action).
- Repo methods validate inputs via the IPC zod schemas at the boundary.
- Arg summary redaction: strip `content`/`source`/`body` fields and anything >120 chars;
  keep `path`, `command` (truncated), `query`, tool name.

## Testing
- `tests/audit-repository.test.ts` (vitest, in-memory sqlite): append → list filter by
  agent/chat, ordering newest-first, clear scoped vs global, count.
- `tests/audit-redaction.test.ts`: arg-summary redaction strips secrets/long content,
  keeps paths/commands.

## Verification
`npm run typecheck` clean; `npm test` green; manual: run an agent, open Audit dropdown,
see tool calls + approvals, click Forget, list empties.
