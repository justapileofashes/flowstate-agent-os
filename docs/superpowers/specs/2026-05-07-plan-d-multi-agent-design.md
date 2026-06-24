# Flowstate — Plan D: Multi-Agent + Dashboard Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent:** `2026-05-05-ai-agent-dashboard-design.md`
**Depends on:** Plan A, B, C1, C2, C3

## 1. Concept

Plan D turns the single-agent app into a true multi-agent dashboard. User can create, edit, and delete agents. Each agent owns a sandboxed workspace folder, system prompt, model selection, and (eventually) tool permissions. The new **Dashboard** screen replaces the auto-pick of "first agent" with a grid of agent cards showing live status. Multiple agents can chat in parallel — the existing `AgentSession` registry already supports this; we just expose the second tab in the UI.

After Plan D, the spec section 5 "Dashboard (home)" mockup is real except for the global "Ask anything" input (that's Plan F's orchestrator).

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Schema upgrade | Migration 003 adds `description`, `specialty_tags`, `avatar_color` columns to `agents` (nullable for backward compat) | Plan D needs them; tool_perms + approval_policy deferred to Plan E (gate work) |
| Workspace per agent | Auto-create `<workspaces_dir>/<agent-id-slug>/` on agent create. Agent-id-slug = sanitized name + short uuid. Stored absolute in DB | Predictable, no user-picker complication for v1 |
| Existing Code Helper | Migration 003 backfills `description`, `specialty_tags=["frontend","backend"]`, `avatar_color="#d97757"` | Don't break the existing seed |
| Agent CRUD UI | **Modal forms** opened from dashboard ("+ New agent") and per-card menu ("Edit", "Delete") | Lighter than dedicated screen; modals reuse Tailwind/shadcn conventions; matches Anthropic Claude.ai pattern |
| Delete behavior | Soft confirm in modal, then `DELETE FROM agents WHERE id=?` cascades to chats/messages. Workspace folder NOT deleted (user may have valuable files) | Safety: never auto-delete user files |
| Dashboard layout | Card grid (3 columns at desktop width, 2 at narrow), each card = name, avatar, description, model, status pill, last-active timestamp, "Open chat" CTA | Standard product pattern |
| Default view on app open | Dashboard if 2+ agents exist; otherwise Chat with the only agent (preserves C3 single-agent ergonomics) | UX courtesy |
| Sidebar | Stays — but now shows the actual agents + a "Dashboard" link at top | Sidebar = quick switch, dashboard = overview |
| Live status | Each card listens to chat:event channels for active streamIds owned by that agent | Real-time "Streaming…" badges |
| Agent edit | Same modal as create, prefilled. Updates apply on save. If model changed, no migration of prior chats — they continue using whatever was current at send time | YAGNI |
| Workspace path display | Read-only in edit modal. v1 doesn't allow rebinding to a different folder | YAGNI; rebind risks orphaning chats with stale references |
| Form validation | zod schemas in `src/shared/agent-form-schema.ts` shared by renderer (form) + main (IPC handler) | Single source of truth |
| New deps | None | Tailwind + Framer Motion + zod sufficient |

## 3. Schema (Migration 003)

```sql
ALTER TABLE agents ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN specialty_tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agents ADD COLUMN avatar_color TEXT NOT NULL DEFAULT '#d97757';

UPDATE agents
SET
  description = 'A focused coding assistant with file tools.',
  specialty_tags = '["coding","files"]'
WHERE id = 'agent-code-helper' AND description = '';
```

Backfill is conditional so it only runs once (subsequent migration replays are guarded by `schema_version`, but extra defense).

## 4. New IPC Channels

```ts
CHANNELS = {
  // existing...
  CHAT_CREATE_AGENT: 'chat:create-agent',
  CHAT_UPDATE_AGENT: 'chat:update-agent',
  CHAT_DELETE_AGENT: 'chat:delete-agent',
};
```

Schemas:

| Channel | Request | Response |
|---|---|---|
| `chat:create-agent` | `{ name, description, specialtyTags, systemPrompt, model, avatarColor }` | `{ agent: AgentDto }` |
| `chat:update-agent` | `{ id, name, description, specialtyTags, systemPrompt, model, avatarColor }` | `{ agent: AgentDto }` |
| `chat:delete-agent` | `{ id }` | `{ ok: boolean }` |

`workspacePath` is NOT user-editable in v1. Server computes on create. Update handler ignores any `workspacePath` in payload.

## 5. ChatRepository extensions

```ts
class ChatRepository {
  // existing methods...
  createAgent(input: CreateAgentInput): AgentRow;
  updateAgent(id: string, input: UpdateAgentInput): AgentRow;
  deleteAgent(id: string): void;
}

interface CreateAgentInput {
  name: string;
  description: string;
  specialtyTags: string[];
  systemPrompt: string;
  model: string;
  avatarColor: string;
  workspacePath: string;  // computed by caller (main/index.ts)
}

type UpdateAgentInput = Omit<CreateAgentInput, 'workspacePath'>;
```

`AgentDto` (in `src/shared/chat-types.ts`) gains:

```ts
interface AgentDto {
  // existing fields
  description: string;
  specialtyTags: string[];
  avatarColor: string;
}
```

## 6. Agent ID generation

Server-side helper:

```ts
function generateAgentId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'agent';
  return `${slug}-${randomUUID().slice(0, 8)}`;
}
```

E.g. `Code Helper` → `code-helper-a8f3c012`.

## 7. UI Layout

### 7.1 Sidebar updates

```
┌─────────────────┐
│ Flowstate       │
├─────────────────┤
│ ◇ Dashboard     │  ← NEW link, replaces fixed default
│                 │
│ AGENTS          │
│  C  Code Helper │
│  R  Researcher  │
│  W  Writer      │
│ + Add agent     │  ← NEW button — opens create modal
├─────────────────┤
│ Settings        │
│ v0.0.1          │
└─────────────────┘
```

The "+ Add agent" button opens the create modal directly without going through dashboard. Same modal used by dashboard's "+ New" CTA.

### 7.2 Dashboard screen

```
┌──────────────────────────────────────────────────────┐
│ Agents                                  [+ New agent]│
│ 3 agents · 2 active chats                            │
│                                                      │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │
│ │ C            │ │ R            │ │ W            │  │
│ │ Code Helper  │ │ Researcher   │ │ Writer       │  │
│ │ A focused…   │ │ Synth notes  │ │ Polish prose │  │
│ │ qwen2.5-cod… │ │ qwen2.5:7b   │ │ llama3.1:8b  │  │
│ │ Idle         │ │ Streaming…   │ │ Idle         │  │
│ │ 2h ago       │ │ now          │ │ 1d ago       │  │
│ │ ────────────  │ │              │ │              │  │
│ │ [Open chat]  │ │ [Open chat]  │ │ [Open chat]  │  │
│ │       ⋯ menu │ │       ⋯ menu │ │       ⋯ menu │  │
│ └──────────────┘ └──────────────┘ └──────────────┘  │
└──────────────────────────────────────────────────────┘
```

Card menu (⋯): "Edit agent", "Delete agent".

### 7.3 Create / Edit modal

Single component `AgentFormModal` reused for both. Fields:

- Name (required, min 1, max 60)
- Description (max 200)
- Specialty tags (free-form input → comma-separated → array)
- System prompt (textarea, max 4000)
- Model — select from `ipc.ollama.models()` (we add a `chat:list-models` IPC for the renderer; main reads via `provider.listModels()`)
- Avatar color (six-swatch picker: orange, blue, green, purple, red, gray)

Footer: Cancel + Save (or Create). Save validates via zod, calls IPC, closes on success.

### 7.4 Delete confirmation

Tiny modal: "Delete `<name>`? This removes all its chats and messages. The workspace folder at `<path>` is preserved." → Confirm + Cancel buttons.

## 8. Live status on dashboard

`useAgentLiveStatus(agentId)` hook subscribes to a new IPC channel `chat:active-streams` (broadcast) emitted whenever sessions start/end. Each card uses the hook to render its pill (Idle / Streaming…).

`AgentSessionManager.start()` and the `onComplete` callback emit `chat:active-streams` events with the current map of `{streamId → agentId}`. Renderer-side, `useAgentLiveStatus` filters by agentId.

## 9. Default-view logic in App.tsx

```ts
// On app open:
// - 0 agents → impossible (migration 002 always seeds Code Helper)
// - 1 agent → open Chat with that agent (current behavior)
// - 2+ agents → open Dashboard
```

After Plan D ships, user creating a 2nd agent will see Dashboard on next launch.

## 10. Test Strategy

**Migration 003 test:** schema upgrade adds the 3 columns; Code Helper backfilled exactly once; reopening DB doesn't re-run.

**ChatRepository extensions:** createAgent generates unique ids, sets defaults, persists tags/color JSON; updateAgent partial update; deleteAgent cascades to chats/messages; getAgent returns new fields.

**IPC channel schemas:** zod accepts/rejects correct payloads.

**Live status:** `AgentSessionManager.start/abort/complete` correctly emits events; controller-side test verifies the event contents.

**No new renderer unit tests** — manual smoke test in plan covers create → edit → delete → dashboard render.

## 11. Manual smoke test (final task in Plan D plan)

1. Restart app on existing DB. Migration 003 applies.
2. Code Helper still works.
3. Click "+ Add agent" in sidebar. Create "Researcher" with model `qwen2.5:7b`, prompt "You research and synthesize notes."
4. Returned to dashboard (or stay on form's success path → close modal, navigate to dashboard if not there).
5. Two cards visible.
6. Open Researcher, send a message. Verify it streams in its own session.
7. Switch sidebar to Code Helper, send a different message. **Both** sessions stream concurrently — dashboard cards show two "Streaming…" pills if user navigates back.
8. Edit Researcher: change description. Save. Card updates.
9. Delete Researcher. Confirm modal. Card disappears. Sidebar updated. Workspace folder still on disk.
10. Reload app. State persists.

## 12. Out of Scope (Plans E / F / G)

- Tool permissions per agent + approval policy preset (cautious/trusting/yolo) — Plan E.
- Shell tool + approval modal — Plan E.
- Orchestrator routing ("Ask anything" global input) — Plan F.
- Workspace folder rebind, "Open in VS Code", file browser — Plan G.
- Agent import/export, presets library — Plan G.
- Per-agent chat counts on cards (cheap addition; defer for now) — Plan G.

## 13. Resolved Decisions

- Workspace path: server-computed on create, displayed read-only on edit, never rebound in v1.
- Dashboard becomes default view when 2+ agents exist.
- Modal-based CRUD reuses one form component.
- Live status via broadcast IPC, not per-card subscription.
- No tool_perms / approval_policy fields yet — Plan E adds them.
- Color picker = 6 fixed swatches (Anthropic-leaning palette).
