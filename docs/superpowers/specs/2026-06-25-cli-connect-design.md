# Connect coding CLIs to Flowstate — design

## Goal
On first launch, Flowstate scans the machine for installed AI **coding CLIs**
(Claude Code, Codex, Gemini CLI, Aider, Cursor CLI, Goose, opencode, …) and asks
which to "connect." Connected CLIs are persisted, advertised to shell-enabled
agents (so they can delegate), and listed on a dedicated **Coding CLIs** screen
where each can be launched straight into Flowstate's built-in terminal. Users
re-scan + change connections any time from that screen.

## Why
Flowstate runs its own agents; coding CLIs are *other* agentic coders the user
already has. "Connecting" surfaces them — agents learn they exist, and the user
gets one-click access to run any of them inside Flowstate without leaving the app.
A coding CLI is interactive, so the primary affordance is launch-in-terminal
(not just the non-interactive `run_shell` awareness).

## Components

### 1. `src/main/services/cli-catalog.ts` (pure)
- `KNOWN_CLIS: CliDef[]` — curated coding-CLI registry: `{ id, name, command,
  category: 'agentic'|'assistant'|'other', description, docsUrl?, versionArgs? }`.
- `parseVersion`, `buildCliReport` (merge probes onto catalog, order preserved),
  `buildCliContext` (compact "## Connected coding CLIs" system-prompt block).

### 2. `src/main/services/cli-detector.ts` (impure)
- `probeCli(def)` — locate via `where`(win)/`command -v`(posix) + best-effort
  `--version` (reuses `resolveSpawn`). `detectInstalledClis(defs, probe)` runs all
  probes in parallel; `probe` injectable for tests.

### 3. IPC (`src/main/ipc/handlers/clis.ts`)
- `CLIS_DETECT` → `{ clis: DetectedCliDto[] }` (60s in-memory cache).
- `CLIS_GET` → `{ connected: string[]; onboardingSeen: boolean; homeDir: string }`.
- `CLIS_CONNECT` `{ ids }` → persists `connected_clis` + `clis_onboarding_seen`.
- Exports `getConnectedClis()` (cache filtered by connected ids) for agent wiring.

### 4. Renderer
- `chat/ClisOnboardingModal.tsx` — first-run prompt (gated on `clis_onboarding_seen`,
  mounted in App.tsx beside OnboardingTour). Scans, lists installed coding CLIs with
  checkboxes, Connect/Skip. Exposes reusable `ClisPicker`.
- `screens/CodingClis.tsx` — dedicated sidebar screen (view kind `coding-clis`):
  re-scan, per-CLI status/version, Connect toggle, docs/install link, and
  **Launch ▶** which renders `TerminalPanel` with `initialCommand` = the CLI's
  command in a chosen cwd (default `homeDir`, editable).
- `chat/TerminalPanel.tsx` — gains optional `initialCommand` prop (runs once the
  piped shell session starts).
- preload + renderer `ipc.ts`: `ipc.clis.detect() / get() / connect(ids)`.

### 5. Agent awareness
- `AgentSessionManager` opt `getConnectedClis`; appends `buildCliContext` to the
  effective system prompt **only for shell-enabled agents**. Wired in index.ts.

## Storage
Settings KV: `connected_clis` (JSON id array), `clis_onboarding_seen` (`'true'`).

## Testing
- `cli-catalog`: parseVersion / buildCliReport / buildCliContext (9).
- `cli-detector`: detectInstalledClis with a fake probe (2).
- Verified real detection of `claude` on this machine; app smoke-boots.

## Out of scope (YAGNI)
- Per-CLI credential capture (coding CLIs use their own existing auth).
- Watching PATH after launch (manual re-scan).
- Full PTY (terminal is piped — fine for launching/driving these CLIs line-by-line;
  no full-screen curses UI).
