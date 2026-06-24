# flowclaw — design

**Date:** 2026-06-09
**Status:** design (pre-implementation)
**Supersedes:** the earlier "durable-engine-only" framing of flowclaw. The durable
engine survives as the *local orchestration layer* (see §8), but flowclaw's core
purpose is now a desktop client + UI over two external agent gateways.

## 1. Corrected mental model

`flowclaw` is a **desktop control-plane and UI over self-hosted AI-agent gateways** —
primarily **OpenClaw** (WebSocket gateway) and **Hermes Agent** (REST), alongside
Flowstate's existing in-app agent runner. OpenClaw and Hermes already provide agent
runtime, tools/skills, persistent memory, and scheduling, so flowclaw **drives them,
it does not reimplement them**. flowclaw adds: easy connection + credential handling,
a unified dashboard, model selection (including local models), and scheduled tasks
that can target any connected backend.

Both OpenClaw and Hermes are **model-agnostic** and support **local models** (e.g.
via Ollama / an OpenAI-compatible local endpoint). Flowstate already runs Ollama
locally (`ollama-provider.ts`, `ollama-client.ts`, `model-catalog.ts`), so a local
model is just another selectable model on any backend.

## 2. Goals / non-goals

**Goals**
- Connect Flowstate to a running **OpenClaw** gateway (local or remote host).
- Connect Flowstate to a running **Hermes** agent (local or remote host).
- Let the user pick the **model** per backend/task, including **local models**.
- Store gateway credentials securely (encrypted), with an add/test connection UI.
- Let a scheduled task target `local | openclaw | hermes`.
- Stream run output/events into the existing run/chat view.

**Non-goals (v1)**
- Reimplementing agent memory/scheduling that the gateways already own.
- Multi-tenant / hostile isolation (OpenClaw assumes one trusted operator).
- Provisioning/installing the gateways for the user (they run them themselves).

## 3. Backends + verified protocol facts

### 3a. OpenClaw (WebSocket gateway)
- Web/WS endpoint default `http://127.0.0.1:18789`; config keys `gateway.port`,
  `gateway.bind`. WS handshake timeout `gateway.handshakeTimeoutMs` (default 15000).
- Auth: **bearer token**, header-only — `Authorization: Bearer <token>` or
  `x-openclaw-token`. Query-string tokens are rejected. Token generated via
  `openclaw doctor --generate-gateway-token`; client side `gateway.remote.token`.
- RPC-style surface (`config.get/patch/apply`, `openclaw gateway call`).
- `sessionKey` / session IDs are **routing selectors, not auth**.
- **To pin at implementation:** exact WS message envelope for "submit a prompt /
  start an agent turn" and the streamed event/result schema (from the API
  reference / `gateway call` protocol).

### 3b. Hermes Agent (REST)
- **OpenAI-compatible** `POST /v1/chat/completions` (+ `/v1/responses`).
- `/api/jobs` REST for cron-style scheduled jobs.
- `X-Hermes-Session-Id` request header for persistent session continuity.
- API-key auth; SQLite-backed response persistence; streaming supported.
- **To pin at implementation:** base URL/port default, exact auth header name,
  `/api/jobs` create/list/delete field schema, streaming format (SSE vs chunked).

### 3c. Local in-app runner (existing)
- Flowstate's `agent/` stack + Ollama. Stays for fully-local/offline tasks and as
  the fallback backend.

## 4. Local-model support

A "model" in flowclaw is `{ backend, modelId }`. Local models are surfaced two ways:
1. **Through a gateway**: OpenClaw/Hermes are configured (by the user, on their
   side) to use a local model (Ollama / local OpenAI-compatible). flowclaw simply
   passes/selects the `modelId` the gateway exposes. We read available models from
   the gateway where its API allows, else accept a free-text model id.
2. **In-app**: the existing Ollama integration (`model-catalog.ts`) already lists
   locally installed models for the `local` backend.

Model picker = union of (in-app Ollama models) + (models reported/configured per
connected gateway). No new model runtime is built.

## 5. Architecture + reuse map

flowclaw is mostly **wiring over existing infrastructure**:

| Concern | Reuse (existing) | New |
|---|---|---|
| Hermes connect (OpenAI-shaped) | `agent/openai-provider.ts`, `provider-router.ts` | `hermes-provider.ts` (base URL + key + session header) |
| OpenClaw connect | `services/secret-store.ts`, `services/mcp-manager.ts` connector pattern, IPC streaming | `services/openclaw-client.ts` (WS) |
| Credential storage | `secret-store.ts` (encrypted) | per-connector entries |
| Connection config | `settings-service.ts` | connector config rows |
| Add/test/manage UI | connectors screen + `Routines.tsx` patterns | `Connections`/flowclaw panel |
| Scheduling | `ipc/handlers/routines.ts` (cron math, ticker) | `target` field + dispatch switch |
| Run output streaming | chat stream (`useChatStream.ts`, chat handler) | event adapters per backend |
| Model selection | `model-catalog.ts` | merged picker |

## 6. Connector designs

### 6a. `OpenClawClient` (new, `services/openclaw-client.ts`)
- Inputs (per connection): `baseUrl` (default `ws://127.0.0.1:18789`), `token`
  (from secret-store), `handshakeTimeoutMs`.
- Connect: open WS, send `Authorization: Bearer <token>` header on the upgrade
  request (header-only — never query string).
- API: `testConnection()`, `submit(prompt, { sessionKey, model })` →
  async event stream `{ type, payload }` mapped to flowclaw run events;
  `close()`. Bounded reconnect with backoff; abort on timeout.
- Errors surface as connection state in the UI; never crash the main process.

### 6b. `HermesProvider` (new, `agent/hermes-provider.ts`)
- Thin variant of `openai-provider.ts`: configurable `baseUrl`, `apiKey`,
  optional `X-Hermes-Session-Id` for continuity. Reuses the existing streaming
  chat-completions code path.
- Scheduled Hermes tasks may optionally register with Hermes `/api/jobs` instead
  of being driven per-fire by flowclaw (decided in the scheduling phase).

### 6c. Connection record (config + secret)
- Config (settings): `id, kind('openclaw'|'hermes'), label, baseUrl, default_model,
  enabled, created_at`.
- Secret (secret-store): the bearer token / api key — **never** in plain settings,
  never sent to the renderer, never logged (reuse audit redaction).

## 7. Connection UI
- A "Connections" panel: add a connection (kind, host/port, paste token), **Test**
  button (calls `testConnection()`), status indicator, model dropdown (merged
  picker), enable/disable, remove. Mirrors the existing MCP/connector UX.

## 8. Scheduling integration
- Extend the existing routine model with `target: 'local' | 'openclaw' | 'hermes'`
  and `connectionId` + `model`. The routine ticker dispatches to the matching
  backend adapter. (The earlier durable-engine improvements — run history, lease,
  concurrency cap, crash recovery — remain a valuable later slice for the **local**
  target and for tracking remote runs, but are **out of scope for v1 connect**.)

## 9. Security
- Tokens/keys only in `secret-store` (encrypted); renderer gets connection metadata,
  never secrets. Header-only auth for OpenClaw (matches its requirement).
- Remote hosts allowed but default to localhost; warn on non-loopback hosts.
- Treat each gateway as one-trusted-operator (matches OpenClaw's model).

## 10. Phased build plan
1. **Hermes provider** — connect, list/select model (incl. local), chat + stream. (smallest; OpenAI-compatible)
2. **OpenClaw client** — WS connect w/ bearer token, submit + stream events.
3. **Connections UI** — add/test/store creds + model picker, reusing connector/secret-store patterns.
4. **Routine targeting** — `target`/`connectionId`/`model` on routines + dispatch switch.

Each phase: own spec-conformant slice, tests, verification.

## 11. Testing
- Provider/connector **decision + adapter logic** written DB-free + network-free with
  injected fakes (better-sqlite3 tests fail locally on Node 24 — known blocker).
- Hermes: test against the OpenAI-compatible contract with a fake server/stub.
- OpenClaw: test the WS envelope mapping with a fake socket.
- **Integration tests require a live OpenClaw/Hermes instance** (user-provided
  host/port/token) — until then, build against docs + unit fakes, user smoke-tests.

## 12. Open items
- Confirm whether OpenClaw/Hermes are running locally now (host/port/token) for
  integration testing.
- Pin the two protocol schemas noted in §3 from the API reference at implementation.
- Decide (scheduling phase) whether Hermes scheduled tasks use Hermes `/api/jobs`
  or are driven per-fire by flowclaw.
