# Business Agent — "AI that runs the business" (host-adapted design)

**Status:** implemented on `feat/autonomous-trading` (uncommitted), 2026-09-24.
**Replaces:** the 3-role Business autopilot (`business-store.ts`, `business-sprint.ts`).
**Source spec:** the owner's "IMPLEMENTATION PLAN — Autonomous AI That Runs the Business" (phases 0–10).

## 1. What changed vs. the old autopilot

| Old | New |
|---|---|
| One profile, JSON files | Many companies, SQLite (migration 008), versioned config = single source of truth |
| 3 roles (strategy/marketing/ops) as chat agents | 9 internal roles (CEO, researcher, planner, coder, copywriter, SDR, support, ads, finance) |
| Free-form "proposed-action" fenced blocks, executed by re-prompting an agent | Typed skills with rubrics, preconditions, risk, category, cost; the server-side approval matrix gates every call; execution is idempotent |
| No budget | Credits ledger + USD caps per run / cycle / month, 80% alert, 100% pause |
| Memory = capped markdown | Config memory, episodic run_steps (redacted), semantic knowledge (embeddings), kaizen learned rules + immutable constitution + drift checker |
| 30s "due today" check | Lease-based scheduler: morning plan, evening summary, per-role cron, objection-window sweep, monthly grant, catch-up window |
| Feed only | Full trace (run_steps), run replay, alerts, audit log |

## 2. Deviations from the source spec (host conventions win)

| Spec | Here | Why |
|---|---|---|
| PostgreSQL + Drizzle + pgvector | SQLite (better-sqlite3) raw-SQL migration `008_business_agent.sql`; embeddings stored as Float32 BLOBs, cosine in JS | App is local-first; no ORM in repo |
| Orgs / users / memberships / RLS | Single local user. Every query is scoped by `company_id`; credentials are company-scoped or explicitly shared | Desktop app has no tenants |
| AWS/GCP KMS envelope encryption | Envelope encryption with the OS keychain (Electron `safeStorage`) as the KEK; per-install DEK, AES-256-GCM, rotation supported | Same guarantee without a cloud KMS |
| Redis/BullMQ cron | In-process ticker + lease rows in `biz_cron_state` | No Redis in a desktop app |
| LangGraph | Hand-rolled plan-and-execute + ReAct loop (`agent/loop.ts`, `agent/orchestrator.ts`); run_steps act as checkpoints; `pending_actions` act as `interrupt()` | Avoid a heavyweight dependency; app already owns its agent runtime |
| LiteLLM / Requesty gateway | `providers/gateway.ts` over the existing `ProviderRouter`: aliases → model ids per company, retry + backoff, per-provider circuit breaker, failover chain, cost accounting | Existing router already speaks 8 providers |
| Stagehand / Browserbase | `web.browse`: SSRF-safe fetch + HTML→text + optional cheap-model structured extraction; Firecrawl when a key is present. Click/act automation via any MCP browser server through the MCP adapter | No hosted browser |
| E2B / Docker code sandbox | Coder uses the existing `node:vm` JS sandbox (no network) for checks; code lands as a GitHub PR on the user's repo; deploys only via a deploy-hook skill that is always approval-gated | No container runtime assumed |
| REST routes under `/api/business-agent` | One typed RPC IPC channel (`business:rpc`) with a zod schema per method (`src/shared/business/api.ts`) + one event channel | Renderer talks to main over IPC; one channel avoids ~50 boilerplate channels |
| Stripe platform billing + webhooks | Credits ledger with monthly allowance grants and manual top-ups; no platform billing (nobody to bill in a local app). Stripe is used read-only (and for approval-gated refunds) on the *company's* account via BYOK key | Local app |
| OTEL + Langfuse | `run_steps` is the trace (phase, kind, tokens, cost, duration); `observability/replay.ts` + `observability/alerts.ts` | No collector; can be added later |
| OAuth connect flows | Paste-a-token BYOK (PATs, private-app tokens, API keys) stored in the vault; never echoed back | No redirect server in a desktop app |
| Digest email + Slack DM | Desktop notification + in-app feed; optional Slack incoming webhook and optional digest email to the owner through the configured email provider | Same outcome |
| Missed-cron 15-min skew window | Implemented as specified (default 15 min) and configurable per company up to 24 h | A laptop is often closed at 07:00 — owners may want a wider window |

## 3. Architecture

```
Renderer (screens/business/*)  ──business:rpc──▶  ipc/handlers/business.ts
                                ◀─business:event─        │
                                                  BusinessAgentService (business/service.ts)
                         ┌──────────────┬───────────────┼────────────────┬──────────────┐
                     Scheduler     CycleRunner (CEO)   ApprovalService   Vault      BizDb (repos)
                     (leases)      perceive→plan→       (gate matrix,    (AES-GCM,   SQLite tables
                                   dispatch→summarize   idempotent exec)  keychain)   biz_*
                                        │
                                   runLoop (ReAct: reason→act→observe, 5 hard stops)
                                        │
                              SkillRegistry ──▶ guardrail check ──▶ skill.execute (idempotency key)
                                        │
                                   ModelGateway ──▶ ProviderRouter (Ollama / Anthropic / OpenAI / …)
```

Pure policy (approval matrix, config schema, DTOs, RPC schemas) lives in `src/shared/business/` so the UI can show *why* an action needs approval.

## 4. Key policies (defaults)

- **Autonomy tier** `safe` (default): every outward action needs approval. `assisted`: low-risk bounded actions (publishing after N clean publishes, ad changes within ±10%, CRM writes, config edits after a 1 h objection window) may auto-run. `autonomous`: additionally outbound email within the daily cap. Deploy, pricing, refunds and validation are **always** approval — not configurable.
- **Validation gate** on by default: while `pending`, the planner may not dispatch coder/ads/SDR work; the researcher submits a validation report that only the owner can accept.
- **Outbound channels are opt-in** per company (email, social, ads, CRM, code all off by default).
- **Credits:** 1 credit = $0.01 of cloud spend, or 4,000 tokens on a local model; skills add their declared credit cost; failed skill executions are refunded automatically.
- **Stops (server-side):** max iterations (per role, default 8, CEO 12), credit + USD caps per run and cycle, no-progress (3 iterations with no new tool result), wall clock (45 min per cycle), and a separate cheap-model goal check.
