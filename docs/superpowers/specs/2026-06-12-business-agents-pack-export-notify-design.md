# Business Agent Pack + Agent Export/Import + Desktop Notifications

Date: 2026-06-12
Status: approved (autonomous session — selected per roadmap order + acting-on-recommendation)

Three independent slices, each shippable alone. Picked because the seed-agent
catalog is developer-heavy while the product targets business owners too, and
because they are the two smallest unshipped roadmap items (Phase 5c slice,
Phase 2c) that deliver immediate value without new infrastructure.

## 1. Business agent pack (new seed agents)

Append ~12 business-owner seed agents to `src/main/seed-agents.ts`. Same
mechanism as existing seeds: inserted on first run, matched by stable id,
never overwrites user rows.

Agents (all `shell_enabled: false` unless noted; business owners should not
get surprise shell access):

| id | name | focus |
|---|---|---|
| agent-sales-outreach | Sales Outreach | cold/warm email sequences, follow-ups, objection handling |
| agent-email-marketer | Email Marketer | newsletters, drip campaigns, subject-line variants |
| agent-social-media | Social Media Manager | platform-native posts, content calendars, hashtags |
| agent-customer-support | Support Responder | empathetic replies, refund/escalation templates, FAQ drafts |
| agent-market-researcher | Market Researcher | TAM/SAM, competitor scans, survey design (web_search heavy) |
| agent-bookkeeper | Bookkeeping Assistant | categorize expenses from CSV, P&L summaries, burn rate |
| agent-contract-reviewer | Contract Reviewer | flag risky clauses, plain-English summaries, NOT legal advice |
| agent-hiring-helper | Hiring Helper | job descriptions, interview rubrics, candidate screening |
| agent-pitch-builder | Pitch Deck Builder | deck outlines, narrative arcs, investor one-pagers |
| agent-pricing-strategist | Pricing Strategist | tiering, packaging, willingness-to-pay analysis |
| agent-biz-plan-writer | Business Plan Writer | lean canvas, business plans, executive summaries |
| agent-meeting-summarizer | Meeting Summarizer | transcripts → decisions/actions/owners (pairs with Capture) |

Test: `tests/main/seed-agents.test.ts` — invariants over the whole list:
unique ids, unique workspace slugs, prompt ≤ 4000 chars (matches IPC schema
cap), name ≤ 60, description ≤ 200, valid avatar hex, valid approval policy.

## 2. Agent export/import packs (roadmap 5c slice)

Share agents as `.flowstate-agents.json` files. Local file share — no store.

- `src/main/services/agent-pack.ts` (pure, testable):
  - `serializeAgents(rows)` → pack object `{ kind: 'flowstate-agent-pack',
    version: 1, exportedAt, agents: [...] }`. Strips machine-specific fields
    (id, workspacePath, timestamps).
  - `parseAgentPack(json)` → validated agents or throw (zod).
  - `planImports(pack, existingNames, existingSlugs)` → per-agent
    `{ id: 'agent-imp-<rand>', workspaceSlug, dedupedName }`; slug from
    name, suffixed `-2`, `-3`… on collision.
- IPC: `AGENTS_EXPORT_PACK` / `AGENTS_IMPORT_PACK` (+ zod schemas).
  Export: ids[] → save dialog → write JSON. Import: open dialog → parse →
  create agents + mkdir workspaces → return created DTOs.
- Renderer: Export / Import buttons on Dashboard agents header. Export
  current agents (all), import merges.
- Security: imported `toolPerms` honored as-is but `approvalPolicy` is forced
  to `cautious` when the pack grants shell — imported prompts are untrusted.

Test: `tests/main/services/agent-pack.test.ts` — round-trip, version reject,
malformed reject, slug collision suffixing, shell→cautious downgrade.

## 3. Desktop notifications (roadmap 2c)

Notify when window is NOT focused: (a) tool approval required, (b) agent run
finished (turn-done). Electron `Notification` in main process.

- `src/main/services/notify.ts` (pure): `decideNotification(payload)` →
  `{ title, body } | null`. Recognizes `tool-approval-required` and
  `turn-done` event payloads; ignores text deltas etc. Bodies redacted via
  existing `redactSensitive` (args may contain secrets).
- Wiring in `src/main/index.ts`: wrap the existing `send` fn — after
  forwarding, if setting `notifications_enabled` ≠ 'false' and the focused
  window check fails, show Notification. Click focuses the window.
- Setting key: `notifications_enabled` ('true' default). Toggle in Settings
  screen later if wanted — KV already user-editable.

Test: `tests/main/services/notify.test.ts` — decision table + redaction.

## Out of scope

Marketplace UI, pack signing, per-agent notification preferences, tray icon.
