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
- `Flowstate-Setup-<version>.exe` — NSIS installer (creates Start Menu + Desktop shortcuts)
- `Flowstate-Portable-<version>.exe` — single-file portable executable

Double-click either to launch. On first run, if any agent's model isn't installed locally, a model puller modal pops up with progress bars — click **Pull all** to fetch them. Skip is safe; you can pull from the modal later if it triggers again.

## Test

```bash
npm test
```

## Known Issues

- **`better-sqlite3` ABI per runtime.** The native binary must match the runtime that loads it. Vitest runs under host Node, Electron uses its bundled Node — different ABIs. Same `build/Release/better_sqlite3.node` cannot satisfy both at once. The `package.json` scripts handle this via per-command rebuilds:
  - `pretest` runs `npm rebuild better-sqlite3` (rebuilds for host Node ABI).
  - `predev` / `prebuild` / `prestart` run `electron-rebuild -f -w better-sqlite3` (rebuilds for Electron's bundled Node ABI).
  - Each switch takes a few seconds. If you forget and run `electron .` directly, the app will crash on DB open with a `NODE_MODULE_VERSION` mismatch — run `npm run rebuild:electron` and try again.
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
