# Business agent — "AI that runs the business"

A CEO agent plans every morning, nine role agents do the work through
guarded skills, and anything that touches the outside world waits in the
owner's approval queue. Design + deviations from the source spec:
[`docs/superpowers/specs/2026-09-24-business-agent-design.md`](../../../docs/superpowers/specs/2026-09-24-business-agent-design.md).

## Layout

| Path | What |
|---|---|
| `service.ts` | Composition root + every RPC method (audited when mutating) |
| `config/` | Limits, credit math constants, settings keys |
| `db/` | Repos over the `biz_*` tables (`db/migrations/008_business_agent.sql`) |
| `crypto/` | Envelope-encrypted vault (OS keychain KEK, AES-256-GCM DEK) + BYOK credentials |
| `agent/loop.ts` | The ReAct loop and its five server-side stops |
| `agent/orchestrator.ts` | CEO cycles: perceive → plan → execute → summarize; role routines; CEO chat |
| `agent/roles.ts`, `prompts.ts`, `plan.ts` | Role definitions, prompt composition, typed plan validation |
| `skills/` | Skills (tool + rubric + preconditions + risk + cost); registry; MCP adapter |
| `guardrails/` | `approval.ts` (the gate + queue + idempotent execution), budgets, scrub, constitution |
| `providers/gateway.ts` | Alias routing, retries, circuit breaker, failover, cost, text tool protocol |
| `memory/` | Semantic memory (embeddings), kaizen (lessons + drift), brand checks |
| `scheduler/` | Lease-based jobs: morning, evening, per-role cron, monthly grant, objection sweep |
| `observability/` | Alerts and run replay |
| `notifications.ts`, `export.ts`, `legacy-import.ts` | Owner alerts, data export, import of the old autopilot |

Shared contract: `src/shared/business/` (types, config schema, approval
matrix, RPC schemas). UI: `src/renderer/src/screens/business/`.

## Running it

It runs inside Flowstate — open **Business** in the sidebar. Any configured
model works; each company maps the tiers (`planner`, `writer`, `coding`,
`cheap`, `embed`) to models in *Settings → Team & models* and falls back to
the app's orchestrator model and fallback chain.

- Tests: `npx vitest run tests/main/business` (unit, integration with a
  scripted LLM, the 20-scenario eval suite and a 50-company load test).
- Credits: 1 credit = $0.01 of cloud spend, or 4,000 tokens on a local
  model; skills add their declared cost; failed skills are refunded.

## Safety model (what is enforced where)

- **Approval matrix** (`src/shared/business/policy.ts`): decided from the
  skill's declared category/risk + server counters, never from model text.
  Deploy, pricing, refunds and validation always need the owner.
- **Idempotency**: every side effect is keyed by
  `sha256(skill + company + canonical args + run)`; `biz_skill_executions`
  replays recorded results; approvals move by compare-and-set, so a double
  approve sends once. Providers that support it also get the key.
- **Budgets**: run cap, cycle cap (credits + USD), monthly cap with an
  80% alert and a 100% pause; empty balance pauses cycles.
- **Secrets**: stored only as vault ciphertext, never returned by the API;
  traces, feed, audit, usage and the idempotency ledger are scrubbed.
- **Channels are opt-in** per company; skills for a disabled channel or a
  missing credential are invisible to agents.
- **Browsing** blocks private/loopback/link-local addresses on every
  redirect hop and honours per-company allow/block lists.

## Operator runbook

**Emergency stop.** *Business → Settings → Data & safety → Emergency stop*
(or set the `business_agent_enabled` setting to `0`). Running cycles abort
at their next step; the scheduler and manual triggers refuse to start.

**Pause one company.** Settings → Data & safety → Pause. Scheduled jobs
skip it; a manual cycle is still allowed.

**Rotate the encryption key.** Settings → Data & safety → Rotate. A fresh
data key re-encrypts every stored credential and queued action; old keys are
retired. To rotate a *provider* key, create a new key at the provider,
*Replace* it under Channels & keys, then revoke the old one at the provider
(Flowstate can't revoke provider-side tokens).

**Backups / restore.** Everything lives in `flowstate.sqlite` in the app's
user-data folder — copy the file (with its `-wal`/`-shm` siblings) while the
app is closed; restore by copying it back. The app's Settings backup covers
agents and settings only, not business data. Credentials are wrapped by the OS keychain of the machine
that stored them: on a new machine they can't be decrypted — re-enter keys.
Per-company JSON/CSV exports (Settings → Data & safety) contain everything
except secrets.

**Keychain unavailable** (some Linux setups): credentials cannot be saved
(by design — no plaintext secrets); queued-action arguments fall back to
tagged plaintext so the queue keeps working.

**Reading a failed cycle.** Timeline → the cycle → a run → *Story*. Stop
reasons: `max_iterations` (step limit — raise it per role), `budget_exhausted`
(raise the role or cycle cap), `no_progress` (three steps with no new result —
usually a missing integration or a vague task), `timeout` (45 min per cycle,
15 per run), `error` (usually no model reachable — check Team & models →
health; a `paused` pill means that provider's circuit is open for 60 s).
"planner returned invalid JSON" means the planner model can't follow the
format — map `planner` to a stronger model.

**Missed schedule.** If Flowstate was closed at the scheduled time, the
run is caught up only within the company's catch-up window (default 15 min;
Team & models → Daily rhythm); otherwise it's skipped and noted in the feed.

**Alerts** (Overview): cost spike (> 3× the recent average), approval
backlog (≥ 10 waiting or one older than 48 h), repeated no-progress runs,
model error rate > 5%, budget 80%/100%.
