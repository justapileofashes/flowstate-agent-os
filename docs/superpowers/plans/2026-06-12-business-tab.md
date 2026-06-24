# Business Tab (autopilot backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for the Business tab — company profile + rolling memory, daily sprint engine (strategy plans → marketing/ops execute → briefing), proposed-action approval queue that executes via agent tools, live feed broadcast.

**Architecture:** `BusinessStore` (JSON files in `userData/business/`), `BusinessSprintRunner` (pure logic, injected `llmOnce` for plan/wrap + `HeadlessRunner` for tool-using task/approval runs), `HeadlessRunner` (thin extraction of the coordinator's autonomous-loop mechanics in `src/main/agent/coordinator.ts:431-541`), IPC handler that wires real deps and broadcasts feed events. UI ships separately (Claude Design port plan).

**Tech Stack:** TypeScript strict, vitest, zod, existing AgentRuntime/ToolDispatcher.

**Spec:** `docs/superpowers/specs/2026-06-11-business-tab-design.md`
**Branch:** continues `session/capture-business-ui` (after the webinar-capture plan). Tests: `npx vitest run <file>` only.

---

### Task 1: BusinessStore

**Files:**
- Create: `src/main/services/business-store.ts`
- Test: `tests/main/services/business-store.test.ts`

Types (exact, exported): `BusinessProfile`, `BusinessSprint`, `SprintTask`, `ProposedAction`, `BusinessFeedEvent` — copy verbatim from spec §1 (`SprintTask = { id: string; role: 'marketing' | 'ops'; instruction: string; status: 'pending' | 'running' | 'done' | 'error'; output?: string; error?: string }`).

- [ ] **Step 1: Failing tests** — temp-dir store:
  - profile round-trip (`saveProfile`/`loadProfile`, null when absent or junk JSON);
  - `readMemory()` returns `'# Business memory\n'` seed when missing; `appendMemory('## Learnings — 2026-06-12\n- x')` appends; cap test: append until > 64 KB → file trimmed from top but still starts with `# Business memory` header and ends with the newest section;
  - state round-trip: `upsertSprint`, `upsertAction`, `pushFeed` persist to `state.json`; caps: 31st sprint evicts oldest, 501st feed event evicts oldest;
  - `new BusinessStore(sameDir)` re-reads everything.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Sync `node:fs` like `zoom-recorder.ts` job persistence (read at ctor, write-through on mutation). Constructor `new BusinessStore(dir: string)`; `mkdirSync(dir, {recursive:true})`. Methods: `loadProfile(): BusinessProfile | null`, `saveProfile(p)`, `readMemory(): string`, `appendMemory(section: string)` (write `# Business memory\n` header if file missing; after append, while `length > 64_000` drop the second chunk — split on `\n## ` keeping header + newest sections), `sprints(): BusinessSprint[]`, `upsertSprint(s)` (cap 30, newest kept), `actions(): ProposedAction[]`, `upsertAction(a)`, `feed(): BusinessFeedEvent[]`, `pushFeed(e)` (cap 500).
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit: `feat(business): business store (profile, capped memory, sprints/actions/feed state)`

### Task 2: Sprint runner (pure logic)

**Files:**
- Create: `src/main/services/business-sprint.ts`
- Test: `tests/main/services/business-sprint.test.ts`

Injected deps — NO electron imports in this file:

```ts
export interface LlmOnce {
  (req: { agentId: string; system?: string; prompt: string; json?: boolean }): Promise<string>;
}
export interface AgentTaskRunner {
  run(agentId: string, instruction: string, onEvent?: (e: { type: 'text' | 'tool'; text?: string; tool?: string }) => void): Promise<string>;
}
export interface BusinessSprintDeps {
  store: BusinessStore;
  llmOnce: LlmOnce;          // plan + wrap phases (strategy agent, no tools)
  tasks: AgentTaskRunner;    // execute phase + approval execution (tools)
  emit: (e: BusinessFeedEvent) => void; // store.pushFeed + IPC broadcast
  now?: () => number;
}
```

- [ ] **Step 1: Failing tests** (fake llmOnce/tasks; real BusinessStore in temp dir):
  - **full sprint:** llmOnce returns `{"goals":["g1","g2"],"tasks":[{"role":"marketing","instruction":"draft post"},{"role":"ops","instruction":"check funnel"}]}`; tasks.run returns output containing a fenced block — assert: sprint `done`, 2 tasks `done`, ProposedAction parsed (`kind:'post'`, title, body, status `proposed`), briefing set from second llmOnce call, memory file gained a `## Learnings` section, feed events emitted in order (`sprint-start`, `phase`, `task-start`×2, `task-done`×2, `action-proposed`, `briefing`, `sprint-end`);

    ````
    drafted it.
    ```proposed-action
    {"kind":"post","title":"Launch post","body":"We shipped X"}
    ```
    done.
    ````
  - **planner bad JSON:** llmOnce returns junk twice → sprint `error`, feed has `error` event; assert llmOnce called exactly 2× (one retry);
  - **planner bad then good:** junk once, valid second → sprint proceeds;
  - **task failure non-fatal:** one tasks.run throws → that task `error`, sprint still `done`;
  - **one at a time:** second `runSprint()` while first in-flight returns `{error}`;
  - **interrupted on restart:** seed store with a `running` sprint → `new BusinessSprintRunner` marks it `error: 'interrupted'`;
  - **schedule math:** `dueToday(profile, lastSprintStartedAt, now)` — enabled + time passed + no sprint today → true; already ran today → false; disabled → false;
  - **approval lifecycle:** `approve(actionId)` → tasks.run called with prompt containing the action body → action `done` with `result`; tasks.run throws → `failed`; `reject(actionId)` → `rejected`;
  - **parser unit:** `parseProposedActions(text, sprintId, role)` — multiple blocks, junk JSON block skipped, unknown `kind` coerced to `'other'`.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Exports: `BusinessSprintRunner`, `parseProposedActions`, `dueToday`, `buildPlannerPrompt`, `buildWrapPrompt`, `buildApprovalPrompt`, `TASK_GUARDRAIL`. Key pieces:

```ts
const FENCE_RE = /```proposed-action\s*\n([\s\S]*?)```/g;
export function parseProposedActions(text: string, sprintId: string, role: ProposedAction['role'], now: number): ProposedAction[] {
  const out: ProposedAction[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    try {
      const raw = JSON.parse(m[1] ?? '') as Record<string, unknown>;
      const kind = ['email', 'post', 'code'].includes(String(raw['kind'])) ? (String(raw['kind']) as ProposedAction['kind']) : 'other';
      const title = String(raw['title'] ?? '').trim();
      const body = String(raw['body'] ?? '').trim();
      if (!title || !body) continue;
      out.push({ id: randomUUID(), sprintId, role, kind, title, body, status: 'proposed', createdAt: now, updatedAt: now });
    } catch { /* junk block — skip */ }
  }
  return out;
}

export const TASK_GUARDRAIL = `
You are executing one sprint task for the business autopilot. NEVER send,
post, publish, deploy, or spend during this run. For every outward action you
want taken, emit it as a fenced block instead:
\`\`\`proposed-action
{"kind":"email|post|code|other","title":"...","body":"..."}
\`\`\`
Do research and produce artifacts; the user approves outward actions later.`;
```

- `runSprint()`: guard `this.active` → `{ error: 'sprint already running' }`. Phase plan: prompt = `buildPlannerPrompt(profile, memory, lastBriefing, openActions)` asking for the strict JSON `{goals, tasks(max 4, role marketing|ops)}`; `llmOnce({agentId: profile.roleAgentIds.strategy, json: true, prompt})`; parse; one retry with `'Reply with ONLY the JSON object.'` appended; still bad → sprint `error`. Phase execute: `Promise.all` over tasks — `tasks.run(roleAgentId, instruction + TASK_GUARDRAIL, onEvent→emit task-tool)`; parse actions from output; per-task try/catch. Phase wrap: `llmOnce` with `buildWrapPrompt(goals, taskOutputs)` → briefing; `store.appendMemory('## Learnings — <ISO date>\n' + briefing-derived bullet text)` (just append the briefing under the dated header — YAGNI); emit each transition. All mutations via `store.upsertSprint` + `emit`.
- `approve(id)`: action → `approved` → `executing` → `tasks.run(roleAgentIdFor(action.role), buildApprovalPrompt(action))` → `done` + result | `failed`. `reject(id)` → `rejected`. `buildApprovalPrompt`: "Execute exactly this approved artifact via your available tools. Do not rewrite it. If no suitable tool is connected, reply with the final ready-to-use artifact and state that manual execution is needed.\n\nTitle: …\nKind: …\nBody:\n…".
- `dueToday(profile, lastStartedAt, now)`: profile.schedule.enabled && local `HH:MM` of `now` >= schedule.time && (!lastStartedAt || not same local date as now).
- ctor: mark non-terminal sprints (`planning|running|wrapping`) `error: 'interrupted'`.
- `startScheduler(intervalMs = 30_000)` / `stopScheduler()` — `setInterval` checking `dueToday` (uses newest sprint's `startedAt`), fire-and-forget `runSprint`.
- [ ] **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit: `feat(business): sprint engine (plan/execute/wrap), action approval lifecycle, scheduler`

### Task 3: HeadlessRunner (real AgentTaskRunner)

**Files:**
- Create: `src/main/agent/headless-runner.ts`

No unit test (glue over AgentRuntime, same trust level as coordinator's internal loop); typecheck-verified, exercised live later.

- [ ] **Step 1: Implement** — extract the mechanics of `Coordinator.runHeadlessTaskAutonomous` (`src/main/agent/coordinator.ts:431-541`) minus nudges into a reusable class:

```ts
export interface HeadlessRunnerOpts {
  provider: LLMProvider;
  repo: ChatRepository;
  approvalGate: ApprovalGate;
  mcpManager?: McpManager;
  brain?: SecondBrain;
  audit?: AuditLogger;
  snapshots?: SnapshotService;
}

export class HeadlessRunner {
  constructor(private readonly opts: HeadlessRunnerOpts) {}
  async run(agentId: string, instruction: string, onEvent?: (e: { type: 'text' | 'tool'; text?: string; tool?: string }) => void): Promise<string>;
  async once(agentId: string, prompt: string, json?: boolean): Promise<string>; // provider.chatOnce w/ agent's model+systemPrompt
}
```

`run()`: look up agent via `repo.listAgents().find(...)` (throw clear error if missing); copy the coordinator pattern verbatim — safeAgent with `toolPerms: { shell_enabled: false, delete_enabled: false }, approvalPolicy: 'yolo'`, `loadConstitution`, `ToolDispatcher` with conditional spreads, `getToolSpecsForAgent`, `AgentRuntime` with `agent.systemPrompt + AUTONOMY_FRAMING + currentContextBlock()` — but define a local autonomy framing + completion token (don't import coordinator's private consts; copy the `<<TASK_COMPLETE>>` token + a trimmed framing paragraph). Loop `MAX_ITERATIONS = 6`, collect text deltas (forward via onEvent), forward tool-call names, break on completion token (strip it), auto-continue prompt otherwise. `once()`: `provider.chatOnce({ model: agent.model, ...(json ? { format: 'json' } : {}), messages: [{role:'system', content: agent.systemPrompt},{role:'user', content: prompt}] })` → `.text`.

- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.node.json` — clean.
- [ ] **Step 3:** Commit: `feat(agent): HeadlessRunner — reusable autonomous single-task loop`

### Task 4: IPC + wiring + role agents

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Create: `src/main/ipc/handlers/business.ts`
- Modify: `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/renderer/src/lib/ipc.ts`

- [ ] **Step 1:** Channels:

```ts
BUSINESS_GET_PROFILE: 'business:get-profile',
BUSINESS_SAVE_PROFILE: 'business:save-profile',
BUSINESS_RUN_SPRINT: 'business:run-sprint',
BUSINESS_SPRINTS: 'business:sprints',
BUSINESS_ACTIONS: 'business:actions',
BUSINESS_APPROVE: 'business:approve',
BUSINESS_REJECT: 'business:reject',
BUSINESS_FEED: 'business:feed',
BUSINESS_FEED_EVENT: 'business:feed-event', // broadcast
```

Schemas: `businessSaveProfileRequest: z.object({ name: z.string().min(1), product: z.string().min(1), audience: z.string().min(1), goals: z.array(z.string().min(1)).min(1), links: z.object({ site: z.string().optional(), repo: z.string().optional() }).optional(), schedule: z.object({ enabled: z.boolean(), time: z.string().regex(/^\d{2}:\d{2}$/) }) })`; `businessActionIdRequest: z.object({ actionId: z.string().min(1) })`; `businessFeedRequest: z.object({ limit: z.number().int().positive().max(500).optional() })`. DTOs mirroring store types: `BusinessProfileDto`, `BusinessSprintDto`, `ProposedActionDto`, `BusinessFeedEventDto`, plus response shapes from the combined design prompt (`{profile: BusinessProfileDto | null}`, `{ok, profile}`, `{sprintId?, error?}`, `{sprints}`, `{actions}`, `{ok}`, `{events}`).

- [ ] **Step 2:** Handler `registerBusinessHandlers({ settings, repo, provider, approvalGate, mcpManager, brain, audit, snapshots })` (extend `register.ts` deps passthrough — these all exist on the `registerIpcHandlers` deps object built in `src/main/index.ts:331-356`):
  - `const store = new BusinessStore(join(app.getPath('userData'), 'business'));`
  - `const headless = new HeadlessRunner({ provider, repo, approvalGate, ...(mcpManager ? {mcpManager} : {}), ...(brain ? {brain} : {}), ...(audit ? {audit} : {}), ...(snapshots ? {snapshots} : {}) });`
  - `const emit = (e: BusinessFeedEvent) => { store.pushFeed(e); for (const w of BrowserWindow.getAllWindows()) w.webContents.send(CHANNELS.BUSINESS_FEED_EVENT, e); };` (mirror the MCP status broadcast pattern in `src/main/ipc/handlers/mcp.ts`).
  - `const runner = new BusinessSprintRunner({ store, llmOnce: ({agentId, prompt, json}) => headless.once(agentId, prompt, json), tasks: headless, emit }); runner.startScheduler();`
  - `business:save-profile`: validate; if no existing `roleAgentIds`, create the three role agents through the same repo call the `CHAT_CREATE_AGENT` handler uses (find it in `src/main/ipc/handlers/` — grep `CHAT_CREATE_AGENT`; reuse its exact `repo.create…` invocation), with: names `Business · Strategy Chief` / `Business · Marketing` / `Business · Ops`, descriptions + `specialtyTags` (`['strategy','planning','business']` / `['marketing','copywriting','growth']` / `['operations','monitoring','process']`), system prompts (strategy: plans daily goals and writes briefings for the company; marketing: drafts content/campaigns/outreach, always proposes outward sends as proposed-action blocks; ops: monitors workflows/metrics, flags issues), model: `settings.get('orchestrator_model') ?? ''` — and when that's empty fall back to the first model from `provider.listModels()` (try/catch → `''`; agent stays editable). Audit via `audit?.log` if the zoom/routines handlers do (match their usage).
  - approve/reject delegate to `runner.approve/reject`; audit each decision.
- [ ] **Step 3:** Preload + renderer `ipc.business.*` exactly per the combined design prompt (`docs/claude-design-prompt-all-features.md`, Feature 2 list) including `subscribeFeed(cb)` using the same `ipcRenderer.on`/unsubscribe pattern as `mcp.subscribeStatus` in `src/preload/index.ts`.
- [ ] **Step 4:** Both typechecks clean; `npx vitest run tests/main/services/business-store.test.ts tests/main/services/business-sprint.test.ts` PASS.
- [ ] **Step 5:** Commit: `feat(business): business IPC surface, role-agent bootstrap, feed broadcast, scheduler wiring`

---

## Self-review notes
- Spec §1→T1, §2→T2(+T3 real runner), §3→T2 approve + T4 audit, §4→T4 step 2, §5→T4, §6 UI = separate plan, §7→T1/T2 tests.
- `AgentTaskRunner.run` signature consistent across T2 (interface) and T3 (HeadlessRunner implements it structurally).
- Role-agent creation depends on repo agent-create API — pinned by reference to the CHAT_CREATE_AGENT handler rather than guessed signature.
