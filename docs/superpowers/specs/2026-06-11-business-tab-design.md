# Business tab — autonomous business autopilot (Polsia-style)

**Date:** 2026-06-11
**Status:** Approved by user (propose-then-approve loop; strategy + marketing + ops roles; daily sprint + run-now; dedicated business store; approve = agent executes via tools; UI handed to Claude Design)

## What this is

A "run your business" surface: persistent company profile + three role agents
(Strategy / Marketing / Ops) that run a **daily sprint** on whatever models the
user has connected to Flowstate (local Ollama, cloud keys — role agents are
normal Flowstate agents with auto-assigned models). Each sprint: strategy
plans goals + tasks → role agents execute in parallel with their tools →
strategy writes a daily briefing + appends learnings to a rolling business
memory. Outward actions (send email, post, push code, spend) are **never
executed during sprints** — they land in an approval queue; approving one
re-runs the role agent with instructions to execute exactly that artifact via
its connected tools (MCP), falling back to "here's the final artifact, do it
manually" when no tool matches.

Built atop existing primitives: `AgentRuntime` + `ToolDispatcher` headless
iteration loop (same pattern as `coordinator.ts`), MCP manager, AuditLogger,
the routines 30s-ticker scheduling pattern, and broadcast-style IPC
(`McpStatusBroadcast` pattern) for a live activity feed.

**Cut from v1 (YAGNI):** cross-company learning, public feed, engineering +
comms roles, direct ad-spend/payment integrations, multi-company support,
24/7 cloud operation (desktop app — runs while open).

## Components

### 1. Store — `src/main/services/business-store.ts`

`userData/business/` (injectable dir for tests):

- `profile.json` — `BusinessProfile { name, product, audience, goals: string[],
  links: { site?, repo? }, roleAgentIds: { strategy, marketing, ops },
  schedule: { enabled: boolean, time: string /* "HH:MM" */ }, createdAt }`
- `memory.md` — rolling business memory. Read before each sprint; strategy
  appends a dated learnings section after. Capped at 64 KB — when over,
  oldest content trimmed from the top (keep a `# Business memory` header).
- `state.json` — `{ sprints: BusinessSprint[], actions: ProposedAction[],
  feed: BusinessFeedEvent[] }`. Sprints capped at last 30; feed at last 500
  events.

Types:

```ts
interface BusinessSprint {
  id: string;
  status: 'planning' | 'running' | 'wrapping' | 'done' | 'error';
  goals: string[];
  tasks: SprintTask[];   // { id, role: 'marketing'|'ops', instruction, status: 'pending'|'running'|'done'|'error', output?, error? }
  briefing?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

interface ProposedAction {
  id: string;
  sprintId: string;
  role: 'strategy' | 'marketing' | 'ops';
  kind: 'email' | 'post' | 'code' | 'other';
  title: string;
  body: string;
  status: 'proposed' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';
  result?: string;       // execution output or manual-fallback note
  createdAt: number;
  updatedAt: number;
}

interface BusinessFeedEvent {
  id: string;
  ts: number;
  sprintId?: string;
  role?: string;
  kind: 'sprint-start' | 'phase' | 'task-start' | 'task-tool' | 'task-done'
      | 'action-proposed' | 'action-executed' | 'action-failed'
      | 'briefing' | 'sprint-end' | 'error';
  text: string;          // human-readable one-liner for the feed
}
```

### 2. Sprint engine — `src/main/services/business-sprint.ts`

`BusinessSprintRunner` with injected deps `{ store, repo (ChatRepository for
agent rows), runAgent (headless single-task runner — see below), now? }`.

Three phases per sprint:

1. **Plan** — strategy agent, strict-JSON prompt (coordinator-planner style):
   input = profile + memory.md + last sprint briefing/results + open proposed
   actions; output = `{ "goals": string[], "tasks": [{ "role":
   "marketing"|"ops", "instruction": string }] }`. Max 4 tasks. Bad JSON →
   one retry with "reply with only the JSON object"; still bad → sprint
   `error`.
2. **Execute** — tasks run in parallel via the headless autonomous loop
   (AgentRuntime + ToolDispatcher, MAX_ITERATIONS guard, completion token —
   same mechanics as `coordinator.ts`). Task system prompt addendum: NEVER
   send/post/publish/deploy/spend during this run; instead emit each outward
   action as a fenced block:

   ````
   ```proposed-action
   {"kind":"email","title":"...","body":"..."}
   ```
   ````

   Runner parses these blocks out of task output into `ProposedAction`s
   (`proposed`). Task failure is non-fatal (task marked `error`, sprint
   continues).
3. **Wrap** — strategy agent reads all task outputs → briefing (markdown) +
   `## Learnings — <date>` section appended to memory.md. Sprint `done`.

Every transition emits a `BusinessFeedEvent` (persisted + broadcast to
renderer). One sprint at a time (`runSprint` returns error if one is active).
On construction, sprints stuck in non-terminal status are marked `error`
("interrupted").

**Scheduler:** 30s ticker (routines pattern). Fires when `schedule.enabled`
and local time passes `schedule.time` and no sprint has started today.
`runSprint()` also callable on demand (Run now).

### 3. Approval execution

`approve(actionId)` → status `approved` → `executing` → role agent runs one
headless task: "Execute exactly this approved artifact via your available
tools. Do not rewrite it. If no suitable tool is connected, reply with the
final ready-to-use artifact and state that manual execution is needed." →
`done` with `result` (or `failed` with error). `reject(actionId)` →
`rejected`. All approve/execute/reject decisions go to AuditLogger.

### 4. Role agents

First `saveProfile` (when `roleAgentIds` absent) auto-creates three agents via
ChatRepository — "Business · Strategy Chief", "Business · Marketing",
"Business · Ops" — each with a role system prompt + specialty tags, model
auto-assigned (existing auto-assign logic). They appear in the normal agent
list and stay user-editable; profile stores their ids. If an id no longer
resolves at sprint time → sprint `error` with a clear message.

### 5. IPC

Channels `business:get-profile | save-profile | run-sprint | sprints |
actions | approve | reject | feed` + broadcast `business:feed-event`.
Zod schemas + DTOs in `shared/ipc-channels.ts`; handler
`src/main/ipc/handlers/business.ts` registered in `register.ts`; preload +
renderer `ipc.business.*` incl. `subscribeFeed(cb) → unsubscribe`.

### 6. UI — handed to Claude Design

No screen built here. Contract documented in
`docs/claude-design-prompt-all-features.md` (combined prompt covering the
Flowclaw screen, Meetings card, Capture card, and the Business tab): setup
wizard (profile form) → dashboard with goals card, live activity feed,
approval queue (approve/reject), latest briefing, sprint history, memory
peek, Run-now + schedule toggle. (This combined prompt supersedes the
"append Capture card to flowclaw-ui-design-prompt.md" step in the
2026-06-11 webinar-capture spec.)

### 7. Tests

- `tests/main/services/business-store.test.ts` — profile round-trip, memory
  append + 64 KB cap trim, state caps (30 sprints / 500 feed events).
- `tests/main/services/business-sprint.test.ts` — fake `runAgent`: full
  sprint (plan JSON → parallel tasks → proposed-action blocks parsed →
  briefing + memory appended → done); planner bad JSON retry then error;
  task failure non-fatal; one-sprint-at-a-time; interrupted-on-restart;
  schedule fire math; approve → execute → done; execute failure → failed;
  reject; feed events emitted in order.
- Typecheck both tsconfigs.
