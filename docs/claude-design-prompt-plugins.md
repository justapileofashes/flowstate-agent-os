# Flowstate — Claude Design prompt: Plugins & skills screen

Read `claude-design-prompt-app-overview.md` first. This screen follows the same
monochrome luxury system and the idioms of `Connectors.tsx` / `Settings.tsx`.

## What this screen is

`Plugins.tsx` (nav row **Plugins**, Free tier, `View` kind `plugins`). It manages
**Claude Code-format** skills and plugins that run locally. A working,
production version already exists at `src/renderer/src/screens/Plugins.tsx` —
this prompt is for visual refinement only. Do not change the IPC calls.

## Backend is done — call these (typed in `src/renderer/src/lib/ipc.ts`)

`ipc.plugins.*`:
- `list()` → installed + discovered plugins (`PluginDto[]`: name, version,
  origin `marketplace|local|claude-home`, enabled, hooksConsent, readOnly,
  `components{skills,commands,agents,mcp,hooks}`)
- `marketplaces()` / `addMarketplace(source)` / `refreshMarketplace(id)` /
  `removeMarketplace(id)` — source is a git URL or absolute folder path
- `browse(query?)` → available plugins across marketplaces (`installed` flag)
- `install(marketplaceId, name)` / `installLocal(path)` / `uninstall(id)`
- `setEnabled(id, enabled)` / `setHooksConsent(id, consent)`
- `listSkills()` → `{name, description, pluginId|null}` for the enabled set
- `getAgentSkills(agentId)` / `setAgentSkills(agentId, names)` — per-agent allowlist
- `importAgents(id)` → import a plugin's bundled agents into the roster
- `subscribeStatus(cb)` → live plugin-set changes

## Sections (current layout — keep or improve)

1. **Marketplaces** — add (git URL / local path), list, refresh, remove.
2. **Browse & install** — searchable list with per-plugin Install / installed pill.
3. **Installed** — per plugin: enable toggle, component badges, **hooks-consent
   toggle (must read "runs shell commands" in `--bad` tone)**, "Import N agents"
   when agents > 0, Uninstall (hidden for `readOnly` claude-home discoveries,
   which show a "discovered" badge).
4. **Available skills** — name + description + owning plugin / "standalone".

## Hard rules

- Monochrome only; hooks-consent is the one place `--bad` (clay) is used, to
  signal risk — still no real red.
- Secrets never surface here (plugin MCP env stays in plugin files).
- Local-first: marketplaces are git clones fetched only on user action.
- A per-agent skill allowlist editor (`setAgentSkills`) can live here or on the
  agent editor — designer's call.
