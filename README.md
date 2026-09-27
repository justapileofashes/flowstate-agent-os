# Flowstate

Local AI agent dashboard powered by Ollama. Runs entirely on your machine — no API keys, no cloud.

Free and open source ([MIT](LICENSE)). Every feature is unlocked — there are no paid tiers, accounts, or payments.

## Requirements

- Node.js **22 LTS** (pinned in `.nvmrc`). Node 24 prebuilt binaries for `better-sqlite3` are not yet published; using Node 24 will fail without Visual Studio Build Tools.
- [Ollama](https://ollama.com) running locally on `http://localhost:11434`.
- A **tool-supporting** Ollama model. Recommended in priority order:
  - `qwen2.5-coder:14b` — best for coding agents, ~9 GB, fits 16 GB VRAM (default).
  - `qwen2.5:7b` — non-coder instruct, smaller (~4.7 GB), still reliable for tools.
  - `llama3.1:8b` / `mistral-nemo` / `command-r` — also work.
  - **Avoid for tools:** `deepseek-coder-v2`, small `qwen2.5-coder:7b` — these either reject the `tools` parameter or emit tool calls as raw JSON text instead of native `tool_calls`.

  Pull one with `ollama pull qwen2.5-coder:14b`. Flowstate auto-picks the first tool-supporting model it finds locally if your seeded default isn't pulled.

If you use [`fnm`](https://github.com/Schniz/fnm) or `nvm`, the project's `.nvmrc` will auto-select the right Node version when you `cd` into the directory (with `fnm env --use-on-cd` enabled in your shell profile).

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Package as .exe

```bash
npm run package
```

Outputs in `dist/`:
- `Flowstate-Setup-<version>.exe` — NSIS installer (creates Start Menu + Desktop shortcuts). Updates itself from GitHub Releases.
- `Flowstate.exe` — single-file portable executable. Can't update itself; download the new version instead.

Double-click either to launch. On first run, if any agent's model isn't installed locally, a model puller modal pops up with progress bars — click **Pull all** to fetch them. Skip is safe; you can pull from the modal later if it triggers again.

## Release

The installer build checks [GitHub Releases](https://github.com/justapileofashes/flowstate-agent-os/releases) on launch and every few hours, downloads a newer version in the background, and shows **"Flowstate X is ready — Restart"** (Settings → Updates shows the state and has **Check now**). It only sees *published* releases.

1. Bump `version` in `package.json` (updates only go to higher versions) and commit.
2. Build and upload to a draft release. The token needs permission to write releases on the repo (a fine-grained token with **Contents: read and write**):

   ```bash
   GH_TOKEN=<token> npm run package -- --publish always
   ```

   This uploads `Flowstate-Setup-<version>.exe`, its `.blockmap`, `latest.yml` and the portable `Flowstate.exe` to a draft release named after the version.
3. On GitHub, add release notes and **Publish** the draft. Installed copies pick it up on their next check.

Keep the repo public: the updater reads releases without a token.

## Test

```bash
npm test
npm run lint
npm run typecheck
```

## Known Issues

- **`better-sqlite3` ABI per runtime.** The native binary must match the runtime that loads it: Vitest runs under host Node, Electron under its bundled Node. `scripts/sqlite-bindings.mjs` (run on `postinstall` and before dev/build/test) installs the prebuilt binary for each ABI side by side under `node_modules/better-sqlite3/lib/binding/`, so no rebuild is needed when switching. `electron-builder.yml` sets `npmRebuild: false` for the same reason: its rebuild would recreate `build/Release` with the Electron ABI, which shadows the Node binary and breaks tests. If you ever see a `NODE_MODULE_VERSION` mismatch, delete `node_modules/better-sqlite3/build` and run `npm run rebuild:node`.
- **Visual Studio Build Tools.** If you're on Windows and `npm install` falls back to compiling `better-sqlite3` from source, you'll need Visual Studio 2022 Build Tools with the "Desktop development with C++" workload installed. Sticking with Node 22 (the pinned version) avoids this — Node 22 has prebuilt binaries.

## Status

- ✅ Plan A — Foundation (Electron shell, SQLite, IPC, Ollama health check)
- ✅ Plan B — Path sandbox + file tools (resolveSafe, FileTools, 52 tests)
- ✅ Plan C1 — Backend agent runtime (AgentRuntime, OllamaProvider, ToolDispatcher, 43 tests)
- ✅ Plan C2 — Persistence + IPC streaming (ChatRepository, AgentSession, chat IPC channels)
- ✅ Plan C3 — Chat UI (sidebar, streaming chat, tool-call cards, real-Ollama smoke verified)
- ✅ Plan D — Multi-agent + dashboard (agent CRUD, dashboard grid, live status)
- ✅ Plan E — Shell tool + approval gate (run_shell, ApprovalGate, three policies)
- ✅ Plan F — Orchestrator routing (global Ask Anything → JSON-mode router → new chat)
- ✅ Plan G — Polish (markdown render, file browser, settings UI, presets, open-in-Explorer/VS Code)
