# Flowstate — Skills & Plugins compatibility (Claude Code format)

**Date:** 2026-06-21
**Status:** Approved design — ready for implementation planning
**Scope:** Native runtime that lets Flowstate agents load and run Claude
Code-format skills and plugins (skills, MCP servers, commands, agents, hooks),
installed from local folders and git marketplaces.

---

## 1. Goal

Make Flowstate **compatible with the Claude Code skill/plugin ecosystem**. A
user's existing skills and plugins (e.g. superpowers, caveman) should work in
Flowstate unchanged — parsed from the same on-disk structures Claude Code uses,
with no conversion step.

Non-goal: inventing a Flowstate-specific plugin format. We consume the Claude
Code format directly.

## 2. Compatibility target (Claude Code structures)

Parsed verbatim from disk:

- **Plugin** — a directory containing `.claude-plugin/plugin.json`
  (`name`, `version`, `description`, optional `author`). Component dirs:
  - `skills/<skill-name>/SKILL.md` (+ bundled support files)
  - `commands/*.md`
  - `agents/*.md`
  - `.mcp.json` (MCP server definitions)
  - `hooks/hooks.json`
- **Marketplace** — a git repo with `.claude-plugin/marketplace.json` listing
  plugins (`name`, `source`, `description`).
- **Standalone skill** — a folder with `SKILL.md` whose frontmatter has
  `name` + `description` (no enclosing plugin).

SKILL.md frontmatter fields used: `name`, `description` (required);
`allowed-tools` / other fields tolerated but ignored in phase 1.

## 3. Storage layout

Root: `app.getPath('userData')/plugins/`

```
plugins/
  marketplaces/<marketplace-id>/      # cloned git repos
  installed/<plugin-id>/              # installed plugin dirs (copied on install)
  registry.json                      # source of truth (see below)
```

`registry.json` shape:

```jsonc
{
  "marketplaces": [
    { "id": "...", "name": "...", "source": "git-url|local-path", "addedAt": 0 }
  ],
  "plugins": [
    {
      "id": "...",            // marketplace-name + plugin-name, or local slug
      "name": "...",
      "version": "...",
      "origin": "marketplace:<id> | local | claude-home",
      "path": "installed/<id> | absolute path for claude-home discovery",
      "enabled": true,
      "hooksConsent": false,  // hooks NEVER run without this true
      "components": { "skills": 3, "commands": 1, "agents": 0, "mcp": 1, "hooks": 2 }
    }
  ],
  "agentSkills": { "<agentId>": ["skill-name", ...] }  // omitted agent = all enabled skills
}
```

**Discovery sources** (read-only, merged into the installed list):
`~/.claude/plugins` and `~/.claude/skills`. Surfaced with `origin: "claude-home"`;
can be enabled/disabled but not uninstalled (we don't own those files).

## 4. Backend services (`src/main/services/`)

Two new units, each independently testable.

### 4.1 `plugin-manager.ts`
Owns the plugin lifecycle. Responsibilities:
- Marketplaces: `addMarketplace(source)` (git clone or register local path),
  `refreshMarketplace(id)` (git pull), `removeMarketplace(id)`,
  `listMarketplaces()`, `browse(query?)` → available plugins parsed from each
  marketplace's `marketplace.json`.
- Plugins: `install(ref)` (copy from marketplace/local into `installed/`),
  `installLocal(path|zip)`, `uninstall(id)`, `setEnabled(id, bool)`,
  `setHooksConsent(id, bool)`, `list()`.
- Manifest parsing: read `plugin.json`, enumerate component dirs, count
  components. Validate ids with the same safe-id rule MCP uses
  (`/^[a-z0-9][a-z0-9_-]{0,30}$/i`).
- Persists `registry.json`. Emits a `status` event → renderer broadcast.
- Aggregates components for consumers: `skills()`, `mcpConfigs()`,
  `commands()`, `agents()`, `hooks()` — each filtered to **enabled** plugins.

Git operations shell out to `git` via the existing shell helper, network only
on user-initiated add/refresh. Failures surface in status, never crash.

### 4.2 `skill-registry.ts`
Thin layer over `plugin-manager.skills()` + standalone skills:
- `descriptions(agentId?)` → for each skill an agent may use:
  `{ name, description }`. Filtered by `registry.agentSkills[agentId]` when set.
- `load(name)` → full `SKILL.md` body (frontmatter stripped), with bundled
  relative file paths resolved to absolute so the agent can read them.
- `list()` → all enabled skills with their owning plugin.

## 5. Component wiring (the five maps)

1. **Skills → system prompt + `skill` tool.**
   - `agent-session-manager.ts` (system-prompt assembly, currently line ~79)
     gains an `## Available skills` block listing `name — description` and the
     instruction to invoke via the `skill` tool. Built from
     `skillRegistry.descriptions(agent.id)`. Empty → block omitted.
   - New tool **`skill`** (`tool-specs.ts`): param `{ name: string }`. Added in
     `getToolSpecsForAgent` only when the agent has ≥1 skill available.
   - `tool-dispatcher.ts`: `skill` case → `skillRegistry.load(name)`, return
     body as tool content (model then follows it). Unknown name → failure with
     the list of valid names.

2. **MCP → existing `McpManager`.**
   - Plugin `.mcp.json` servers parsed into `McpServerConfig[]`, id-namespaced
     as `plugin-<pluginId>-<serverName>`, merged with `settings.mcp_servers`
     when the server set is computed. env secrets resolved via secret-store.
   - Disabling/uninstalling a plugin removes its servers on next `setServers`.

3. **Commands → `slash-commands.ts`.**
   - Plugin `commands/*.md` parsed (frontmatter + body) into the slash-command
     list as prompt templates, namespaced to avoid collisions with built-ins.

4. **Agents → agent import.**
   - Plugin `agents/*.md` frontmatter (`name`, `description`, `tools`, `model`)
     → `AgentRow`, imported through the existing agent-pack import path. Tagged
     with provenance so they can be cleaned up when the plugin is removed.

5. **Hooks → Flowstate lifecycle (consent-gated).**
   - `hooks/hooks.json` event → command mappings. Event mapping:
     - `PreToolUse` / `PostToolUse` → dispatcher around tool calls
       (cooperates with the approval-gate).
     - `UserPromptSubmit`, `Stop`, `SessionStart` → agent-session lifecycle.
   - **Security:** hooks DO NOT run unless `hooksConsent === true` for that
     plugin (explicit per-plugin toggle in the UI). When enabled, hook commands
     run through the existing shell sandbox with a timeout, and every run is
     audit-logged. Honors the Claude Code hook contract: non-zero exit / JSON
     output can block the action or inject `additionalContext`.

## 6. IPC surface — `ipc.plugins.*`

Channels in `ipc-channels.ts`, typed DTOs, zod request/response schemas
(follow the Connectors/MCP pattern).

- `listMarketplaces()` / `addMarketplace(source)` / `refreshMarketplace(id)` /
  `removeMarketplace(id)`
- `browse(query?)` → available plugins across marketplaces
- `install(ref)` / `installLocal(path)` / `uninstall(id)` /
  `setEnabled(id, enabled)` / `setHooksConsent(id, consent)`
- `list()` → installed + discovered plugins with state + component counts
- `listSkills()` / `setAgentSkills(agentId, names[])`

Status broadcast channel `plugins:status` mirrors the MCP status pattern.

## 7. Renderer — `Plugins.tsx`

New left-nav row **Plugins** (Free tier). New `View` kind `plugins`. Screen
follows `Connectors.tsx` idioms (monochrome, `.card`, `.field`, `.pill`,
write-only secrets, 16×16 stroke icons). Sections:

1. **Marketplaces** — list, add (git URL or local path), refresh, remove.
2. **Browse & install** — searchable list of available plugins from
   marketplaces; install button with progress; component badges.
3. **Installed** — each plugin: enable/disable toggle, **hooks-consent toggle**
   (clearly labeled as "runs shell commands"), component breakdown, uninstall.
   `claude-home` plugins show a "discovered" badge and no uninstall.
4. **Skills** — flat list of enabled skills; per-agent allowlist editor
   (`setAgentSkills`).

A Claude Design handoff doc (`docs/claude-design-prompt-plugins.md`) is written
when the backend + `ipc.ts` typing land, per the project's UI workflow.

## 8. Tier & constraints

- **Tier:** Free (parity with Connectors) — drives adoption.
- **Local-first:** preserved. Git runs only on user-initiated marketplace
  add/refresh. No telemetry, no auto-fetch.
- **Hooks:** off by default, per-plugin consent, sandboxed, audited.
- **Secrets:** plugin MCP env secrets via existing write-only secret-store.
- **Design:** dark monochrome only, reuse existing class vocabulary, no new hues.

## 9. Phasing (build order — each phase independently shippable)

1. **Skill runtime** — `skill-registry`, system-prompt injection, `skill` tool,
   local skill folders, `~/.claude` discovery. (Smallest valuable slice.)
2. **Plugin install** — `plugin-manager`, local + git marketplace install,
   plugin-bundled skills, MCP merge into `McpManager`.
3. **Commands + agents** — slash-command merge, agent import with provenance.
4. **Hooks** — consent gate, event mapping, sandboxed execution, audit.

## 10. Testing strategy

- `plugin-manager`: manifest parsing (plugin.json, marketplace.json, malformed),
  install/uninstall/enable state transitions, component aggregation filtered by
  enabled — against fixture plugin dirs (no network; git mocked or local-path).
- `skill-registry`: `descriptions()` filtering by agent allowlist; `load()`
  frontmatter stripping + relative-path resolution; unknown skill.
- Wiring: `skill` tool dispatch (load + unknown-name failure); MCP config
  namespacing + removal on disable; system-prompt block built/omitted.
- Hooks: consent gate (no run when consent false), exit-code/JSON contract
  parsing, timeout.

## 11. Open items / explicit decisions

- Plugin tier = **Free** (decided).
- `~/.claude` auto-discovery = **included** (decided).
- Hooks shipped but **deferred to phase 4** behind consent (decided).
- `.mcp.json` and marketplace `source` formats: support the common Claude Code
  shapes (git url, local path, `${CLAUDE_PLUGIN_ROOT}` substitution). Exotic
  source types deferred — surfaced as "unsupported source" rather than failing.
