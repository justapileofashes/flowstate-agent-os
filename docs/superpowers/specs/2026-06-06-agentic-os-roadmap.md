# FlowState → Agentic OS — Phased Roadmap

Date: 2026-06-06
Status: living document

Captures the full feature backlog requested (three idea dumps: the 8-category
agentic-OS list, the dev/offline-focus list, and the "Cognitive Canvas OS" goal-graph
vision). ~50 features. None are lost here; most are multi-week. This doc orders them
into shippable slices, each of which gets its own spec → plan → implementation cycle.

Guiding constraints (what FlowState actually is today):
- Local Electron + React app, Ollama-first, optional cloud providers.
- Single-user, single-machine. No cloud backend, no app store, no device fleet.
- Therefore: "hardware-level isolation", "agent marketplace billing", "mobile handoff",
  "voice/vision/gesture" are **out of near-term scope** — they need infra we don't have.
  Honest substitutes are listed where they exist (e.g. OS-process sandbox instead of
  hardware isolation).

## What already exists (reuse, don't rebuild)

| Capability | Existing module |
|---|---|
| Multi-agent routing / planning | `agent/orchestrator.ts`, `agent/coordinator.ts`, `agent/provider-router.ts` |
| Approval gates (human-in-the-loop) | `agent/approval-gate.ts` |
| Path sandbox / scoped FS | `tools/path-sandbox.ts`, `tools/file-tools.ts` |
| Secret encryption | `services/secret-store.ts` |
| Workspace rollback | `services/snapshot-service.ts` |
| Persistent memory (PARA vault) | `services/second-brain.ts` |
| Tool/MCP protocol | `services/mcp-client.ts`, `services/mcp-manager.ts`, `tools/` |
| Hardware introspection | `services/hardware-info.ts` |
| Code execution | `tools/shell-tool.ts`, `run_code` JS sandbox in `tool-dispatcher.ts` |
| Web search | `web_search` tool |

## Phases

### Phase 1 — Governance, Trust & Control (local, high-trust value)
*Appears in all three idea dumps: "audit trails", "human-in-the-loop", "transparent
workspace", "rationale into nodes", "reasoning chains".*

- **1a. Audit Log + Explainability layer** ← FIRST SLICE (see dedicated spec).
  Every tool call, approval decision, and snapshot restore recorded to SQLite with
  timestamp, agent, args summary, outcome, duration, and rationale. Timeline UI.
  "Forget" command = clear log for an agent/chat (privacy-first user-owned data).
- 1b. Configurable agent constitutions/rules (per-agent allow/deny rule sets evaluated
  in the approval gate; extends `approval-gate.shouldPrompt`).
- 1c. Automatic rollback on guardrail breach (auto-snapshot before risky ops, auto-restore
  when a constitution rule is violated mid-run).
- 1d. Bias/PII redaction pass over agent output (local regex + optional model check).

### Phase 2 — Observability Dashboard
*"Observable dashboard", "real-time agent view", "taskbar notifications", "resource usage".*
- 2a. Live agent activity stream (reuse audit log + chat events) as a dashboard screen.
- 2b. Resource meters (CPU/GPU/RAM/token) from `hardware-info` + usage handlers.
- 2c. Taskbar/tray notifications for approval-required + run-complete.

### Phase 3 — Memory & Knowledge Graph
*"Persistent semantic memory", "knowledge graph", "per-project versioned configs",
"unified cognitive memory layer", "rationale queryable/replayable".*
- 3a. Promote `second-brain` to a queryable semantic store (embeddings via Ollama).
- 3b. Per-project knowledge nodes + decision/rationale log (feeds the Goal Graph later).
- 3c. Versioned agent configs (git-style history of agent definitions).

### Phase 4 — Orchestration & Autonomy
*"Smart orchestrator/kernel", "goal-oriented autonomy", "swarm agents", "visual workflow
builder", "proactive task anticipation".*
- 4a. Visual flowchart workflow builder (agents handing off — React Flow canvas).
- 4b. Scheduler + proactive triggers (watch repo/calendar → propose tasks).
- 4c. Conflict resolution between concurrent agents writing the same workspace.

### Phase 5 — Integration & Extensibility
*"Universal tooling/MCP", "SDK & marketplace", "programmable kernel", "API+code execution".*
- 5a. Finish connector HTTP transport (existing backlog item #3).
- 5b. Local agent SDK (Python/TS) with prebuilt tool stubs + testing sandbox.
- 5c. Shareable agent/skill/template packs (local import/export; "marketplace" = file share,
  not a billed store).

### Phase 6 — Dev Productivity
*"Terminal/IDE integration", "AI-native debugging", "intent→PR", "reproducible workflows".*
- 6a. Intent-based dev: NL spec → branch + diff + test run (reuses shell + file tools).
- 6b. Semantic debug / root-cause assist over run logs.
- 6c. Reproducible run export (diff + test results + reasoning log bundle).

### Phase 7 — Cognitive Canvas OS (the big vision)
*Goal graph as home screen, programming-by-example skills, time-scrubber, personality lenses,
graph templates.* Depends on Phases 3 (memory) + 4 (orchestration). Build the **MVP slice**
only after those land:
- 7-MVP. Single-project goal graph (nodes=goals/tasks, edges=deps, drag/drop, deadlines/tags),
  one DevOps/productivity agent that watches the repo and proposes nodes with rationales,
  and a basic time scrubber over historical graph states.

### Explicitly deferred / out of near-term scope
Hardware-level isolation, mobile + cross-device handoff, voice/vision/gesture multimodal,
inter-agent reputation & negotiation markets, billed marketplace, cloud multi-environment
orchestration, "fast-forward forecasting". Revisit when/if infra exists.

## Order of execution
1 → 2 → 3 → 4 → 5/6 (parallelizable) → 7. Each slice ships independently and is usable on
its own. Start: **Phase 1a, Audit Log** (separate spec, same date).
