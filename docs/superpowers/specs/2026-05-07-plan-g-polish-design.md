# Flowstate — Plan G: Polish Design Spec

**Date:** 2026-05-07
**Status:** Draft, pending user review
**Parent:** `2026-05-05-ai-agent-dashboard-design.md`
**Depends on:** Plan A, B, C1, C2, C3, D, E, F

## 1. Concept

Final plan. Five highest-value polish items chosen from spec section 6 + deferred items:

1. **Markdown + syntax highlighting** in chat — `react-markdown` + `rehype-highlight` (with highlight.js).
2. **Right-rail file browser** per agent — collapsible, lists workspace, click to preview, "Open in Explorer / VS Code" buttons.
3. **Settings screen UI** for `orchestrator_model` + `ollama_host` — pluggable form on existing Settings screen.
4. **System-prompt preset library** — dropdown in AgentFormModal: Coder / Researcher / Writer / Ops, populates system prompt.
5. **"Open in Explorer" + "Open in VS Code"** buttons on Chat header (opens agent's workspace folder).

Lower-value items (in-app model puller, token usage, export chat, theme toggle, animations, renderer tests) deferred to future.

## 2. Locked Decisions

| Topic | Choice | Rationale |
|---|---|---|
| Markdown lib | `react-markdown@^9` + `remark-gfm@^4` + `rehype-highlight@^7` + `highlight.js@^11` | Standard, small footprint |
| Code-block style | `highlight.js/styles/atom-one-dark.css` (matches Anthropic dark palette) | Looks consistent |
| File browser scope | Read + preview only. No edit/delete from UI in v1 (agent already does that) | YAGNI; safety |
| File preview limit | 100 KB inline; bigger files show size + "Open in editor" only | Render perf |
| Open external | Use Electron `shell.openPath(workspacePath)` for Explorer; `shell.openExternal('vscode://file/' + path)` for VS Code via custom URL handler | Standard Electron APIs |
| Settings UI fields | Ollama host (text input), Orchestrator model (select from `chat.listModels`) | Most-asked-for |
| System prompt presets | Hardcoded in `src/shared/system-prompt-presets.ts` — array of `{name, description, prompt}` | Simple data |
| New deps | 4 npm packages (md + 3 hl) | Acceptable |
| Tests | Markdown render = manual smoke. File browser = unit tests on path-list IPC + presets sanity | Same pattern |

## 3. New deps

```bash
npm install react-markdown@^9 remark-gfm@^4 rehype-highlight@^7 highlight.js@^11
```

## 4. Architecture

```
src/main/ipc/handlers/
└── files.ts                            # NEW — workspace browse + preview + open-external IPC

src/shared/
├── system-prompt-presets.ts            # NEW
└── ipc-channels.ts                     # MODIFY — files:list, files:read, shell:open-path, shell:open-vscode

src/main/index.ts                       # MODIFY — register file handlers

src/preload/index.ts                    # MODIFY — files.* + shell.* methods
src/renderer/src/lib/ipc.ts             # MODIFY — same

src/renderer/src/chat/
├── FileBrowser.tsx                     # NEW — right-rail tree + preview
├── MarkdownText.tsx                    # NEW — wraps react-markdown
├── Message.tsx                         # MODIFY — use MarkdownText for assistant content
└── (existing files unchanged)

src/renderer/src/screens/
├── Chat.tsx                            # MODIFY — wire FileBrowser right rail + "Open in Explorer/VS Code" buttons
└── Settings.tsx                        # MODIFY — add Ollama host + Orchestrator model fields

src/renderer/src/chat/AgentFormModal.tsx # MODIFY — preset dropdown above System prompt field

src/renderer/src/styles.css             # MODIFY — import highlight.js theme + add a few component styles

tests/main/ipc/files.test.ts            # NEW (light)
tests/shared/system-prompt-presets.test.ts # NEW
```

## 5. IPC additions

```ts
CHANNELS = {
  // existing...
  FILES_LIST: 'files:list',          // { workspacePath, subPath? } → { entries: [{name, kind}] }
  FILES_READ: 'files:read',          // { workspacePath, relPath } → { content, truncated, sizeBytes }
  SHELL_OPEN_PATH: 'shell:open-path', // { absolutePath } → { ok }
  SHELL_OPEN_VSCODE: 'shell:open-vscode', // { absolutePath } → { ok }
};
```

Schemas: standard zod. `FILES_READ` caps content at 100 KB; sets truncated=true if file larger.

Handlers reuse `FileTools` for sandboxed reads. Open-path uses Electron `shell.openPath`. Open-vscode tries `vscode://file/<path>` via `shell.openExternal`. If the URL handler isn't registered (VS Code not installed), the OS shows its own error — acceptable.

## 6. Renderer changes

### 6.1 MarkdownText

```tsx
// Wrapper around react-markdown with remark-gfm + rehype-highlight
<MarkdownText>{text}</MarkdownText>
```

Configures react-markdown to:
- Allow standard markdown + GFM (tables, strikethrough, task lists)
- Highlight code blocks via rehype-highlight (highlight.js auto-detect)
- Open links in external browser (`<a target="_blank" rel="noreferrer">`)
- Sanitize: react-markdown disallows raw HTML by default — keep that.

### 6.2 Message component

For `assistant` role, render `<MarkdownText>` instead of `<div>`. For `user`, keep plain text (preserves whitespace). Tool-call cards unchanged.

### 6.3 FileBrowser right-rail

```
┌─────────────────────┐
│ Files               │
│  ▾ src/             │
│    ▸ components/    │
│    file.ts          │
│  README.md          │
│  package.json       │
└─────────────────────┘
```

Component props: `workspacePath`. Initial load: `ipc.files.list(workspacePath, '.')`. Tree expands on click. File click opens preview modal showing content. Refresh button at top.

Right rail toggle button on Chat header (shows 🗂 icon + "Files"). Default closed; opening pushes message list narrower. State per chat session (in-memory).

### 6.4 Open in Explorer / VS Code

Two small buttons on Chat header:
```
[Open in Explorer] [Open in VS Code]
```

Both call respective IPC. No async UI; OS handles open.

### 6.5 Settings screen additions

Append two cards:

**Ollama host:** input + "Save" button. Calls `ipc.settings.set('ollama_host', ...)`. Note that change requires restart.

**Orchestrator model:** select fed by `ipc.chat.listModels()`. Default = current `orchestrator_model` setting. Save sets the setting. Note: takes effect on next routing call.

### 6.6 System prompt presets in AgentFormModal

Above System prompt textarea: select dropdown labeled "Preset (optional)" with options:

- (none) — keeps current value
- Coder
- Researcher  
- Writer
- Ops

Selecting a preset replaces the textarea content with that preset's prompt. User can then edit.

Presets live in `src/shared/system-prompt-presets.ts`:

```ts
export interface SystemPromptPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export const SYSTEM_PROMPT_PRESETS: SystemPromptPreset[] = [
  {
    id: 'coder',
    name: 'Coder',
    description: 'Focused coding assistant.',
    prompt: 'You are a focused coding assistant working in a sandboxed workspace folder. Read files before writing them. Prefer small, reviewable changes. When you complete a task, summarize what changed.',
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Reads, synthesizes, organizes notes.',
    prompt: 'You are a research assistant. You read documents in the workspace, synthesize them, and write clear summaries. Quote sources by file path. Avoid speculation.',
  },
  {
    id: 'writer',
    name: 'Writer',
    description: 'Drafts and edits prose.',
    prompt: 'You are a writing assistant. You draft and edit prose in the workspace folder. Match the tone the user requests. Keep paragraphs tight and self-contained.',
  },
  {
    id: 'ops',
    name: 'Ops',
    description: 'Runs commands, automates tasks.',
    prompt: 'You are an operations assistant. You use the shell tool to run commands and automate tasks. Confirm before destructive actions. Report exit codes and stderr clearly.',
  },
];
```

## 7. Test Strategy

- **`system-prompt-presets.test.ts`** — schema sanity (4 presets, ids unique, prompt length > 50).
- **`files.test.ts`** — IPC list/read happy path against tmpdir; sandbox reject (already covered indirectly by FileTools but worth one integration test).
- **No renderer unit tests** — manual smoke.

## 8. Manual smoke

1. Start app. Open a chat. Send: "Write me a markdown table comparing Node and Bun." Expect rendered table.
2. Send: "Show a code block with a typescript function." Expect syntax-highlighted code.
3. Header: click "Files" button → right rail opens. Tree shows workspace contents.
4. Click a file → preview modal shows content.
5. Click "Open in Explorer" → File Explorer opens at workspace.
6. If VS Code installed: click "Open in VS Code" → opens.
7. Settings → change Ollama host → save → restart → connection check still works.
8. Settings → change orchestrator model → save → routing uses new model.
9. AgentFormModal → pick "Researcher" preset → system prompt populates.

## 9. Out of Scope (future)

- In-app model puller w/ progress bar.
- Token usage / context window bar.
- Export chat as markdown.
- Theme toggle (light mode).
- Framer Motion animations beyond what already exists.
- Renderer unit tests.
- Empty-state onboarding wizard.
- Streaming shell output to UI.
- Workspace folder rebind UI.
- Approval modal timeout slider.

## 10. Resolved Decisions

- Markdown: react-markdown + remark-gfm + rehype-highlight + highlight.js. Atom One Dark theme.
- File browser: read-only.
- Open-vscode: `vscode://file/<path>` URL.
- Settings: editable Ollama host + Orchestrator model.
- Presets: 4 hardcoded.
- No new schema/migration. All Plan G changes are renderer + IPC + 2 small backend handlers.
