# Connect CLIs to Flowstate — design

## Goal
On first launch, Flowstate scans the machine for installed command-line tools
(git, gh, docker, node, python, aws, ollama, claude, …) and asks the user which
ones to "connect." Connected CLIs are persisted and surfaced to agents so they
know these tools are available to call via `run_shell`. Users can re-scan and
change the selection later from Settings.

## Why
Agents already have a `run_shell` tool, so any CLI on PATH is *technically*
runnable — but the model has no idea what's installed. Detecting + advertising
the real toolset turns "could shell out" into "knows to use `gh` for GitHub,
`docker` for containers," and gives a friendly first-run moment.

## Components

### 1. `src/main/services/cli-catalog.ts` (pure)
- `KNOWN_CLIS: CliDef[]` — curated registry: `{ id, name, command, category,
  description, versionArgs? }` for common dev/AI/cloud CLIs.
- `parseVersion(raw: string): string | null` — extract first `x.y[.z]` from
  `--version` output.
- `buildCliReport(results: CliProbeResult[]): DetectedCli[]` — merge probe
  results with the catalog into `{ id, name, command, category, description,
  installed, version, path }`, catalog order preserved.
- Categories: `vcs | runtime | package | container | cloud | ai | data | media | other`.

### 2. `src/main/services/cli-detector.ts` (impure orchestration)
- `probeCli(def): Promise<CliProbeResult>` — locate via `where` (win32) /
  `command -v` (posix); if found, best-effort `command --version` for a version
  string. Uses `resolveSpawn` (from mcp-client) for Windows shell quoting.
- `detectInstalledClis(defs = KNOWN_CLIS, probe = probeCli): Promise<DetectedCli[]>`
  — probes all defs in parallel, returns `buildCliReport(results)`. `probe` is
  injectable for tests.

### 3. IPC (`src/main/ipc/handlers/clis.ts`)
- `CLIS_DETECT` → `{ clis: DetectedCli[] }` (live scan, cached ~1 min in memory).
- `CLIS_GET` → `{ connected: string[]; onboardingSeen: boolean }`.
- `CLIS_CONNECT` `{ ids: string[] }` → persists `connected_clis` (JSON id array)
  + sets `clis_onboarding_seen='true'`; returns `{ ok: true }`.
- Channels + zod schemas in `ipc-channels.ts`; DTOs `DetectedCliDto`.

### 4. Renderer
- `src/renderer/src/chat/ClisOnboardingModal.tsx` — mounted in `App.tsx` next to
  `OnboardingTour`. On mount, if `onboardingSeen` is false, runs `detect`, shows
  installed CLIs grouped by category with checkboxes (all checked by default),
  "Connect selected" + "Skip". Either choice marks onboarding seen.
- Settings: a "Connected CLIs" card to re-scan + toggle connections later.
- preload + renderer `ipc.ts` typing: `ipc.clis.detect() / .get() / .connect(ids)`.

### 5. Agent awareness
- `cli-catalog.ts` `buildCliContext(connected: DetectedCli[]): string` — compact
  block: "## Connected CLIs\nInstalled tools you may use via run_shell: …".
- `AgentSessionManager` gains `getConnectedClis?: () => DetectedCli[]`; appends
  the block to the effective system prompt **only for shell-enabled agents**.
  Wired in `register.ts`/`index.ts` from settings + a cached detect.

## Storage
Settings KV (consistent with the rest of the app): `connected_clis` (JSON array
of catalog ids), `clis_onboarding_seen` (`'true'`).

## Testing (TDD on pure units)
- `cli-catalog`: `parseVersion` (varied `--version` formats), `buildCliReport`
  (installed/missing merge, order), `buildCliContext` (empty → '', formatting).
- `cli-detector`: `detectInstalledClis` with a fake probe (no real spawning).

## Out of scope (YAGNI)
- Per-CLI auth/credential capture (agents use the user's existing CLI auth).
- Watching PATH for changes after launch (manual re-scan only).
- Arbitrary user-added CLIs not in the catalog (catalog covers the common set;
  the manage card can ship custom entries later if asked).
