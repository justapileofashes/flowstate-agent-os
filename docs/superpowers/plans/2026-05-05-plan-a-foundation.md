# Flowstate — Plan A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a runnable Electron + React + TypeScript desktop app with SQLite persistence, typed IPC, and a working Ollama health check shown on a Settings screen.

**Architecture:** Single Electron main process owns SQLite + Ollama HTTP client. Renderer is sandboxed React UI. All cross-process calls go through a typed IPC layer validated with zod. Settings live in a key/value SQLite table. No agents, no chat, no tool use yet — those land in later plans.

**Tech Stack:** Electron 33+, electron-vite, React 18, TypeScript 5, Tailwind CSS, shadcn/ui (set up but only minimal components), better-sqlite3, ollama (npm package), zod, vitest.

**Demo target at end of plan:** Run `npm run dev`. App opens. Settings screen shows "Ollama: Connected ✓" if `ollama serve` is running, "Not detected — install from ollama.com" otherwise. Closing/reopening preserves the configured workspaces directory.

---

## File Structure

```
flowstate/
├── package.json
├── electron.vite.config.ts
├── tsconfig.node.json          # main + preload
├── tsconfig.web.json           # renderer
├── tailwind.config.ts
├── postcss.config.cjs
├── vitest.config.ts
├── .gitignore
├── .editorconfig
├── README.md
├── src/
│   ├── shared/
│   │   ├── ipc-channels.ts     # channel name constants + zod schemas
│   │   └── types.ts            # shared types (Settings, OllamaStatus, etc.)
│   ├── main/
│   │   ├── index.ts            # main entry: app lifecycle, window creation
│   │   ├── ipc/
│   │   │   ├── register.ts     # registers all handlers using channel constants
│   │   │   └── handlers/
│   │   │       ├── settings.ts
│   │   │       └── ollama.ts
│   │   ├── db/
│   │   │   ├── database.ts     # opens SQLite, runs migrations
│   │   │   └── migrations/
│   │   │       └── 001_init.sql
│   │   ├── services/
│   │   │   ├── settings-service.ts
│   │   │   └── ollama-client.ts
│   │   └── paths.ts            # app data dir, db path helpers
│   ├── preload/
│   │   └── index.ts            # contextBridge exposes typed `window.flowstate` API
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx        # React mount
│           ├── App.tsx         # router shell
│           ├── styles.css      # tailwind directives
│           ├── lib/
│           │   └── ipc.ts      # thin wrapper around window.flowstate
│           ├── components/
│           │   └── ui/         # shadcn/ui generated components (button, input)
│           └── screens/
│               └── Settings.tsx
└── tests/
    ├── shared/
    │   └── ipc-channels.test.ts
    ├── main/
    │   ├── db/
    │   │   └── database.test.ts
    │   └── services/
    │       ├── settings-service.test.ts
    │       └── ollama-client.test.ts
```

**Boundaries:**
- `shared/` — types and zod schemas usable from main, preload, or renderer; no runtime dependencies on Electron or Node-only APIs
- `main/services/` — pure logic, no Electron or IPC awareness; testable with vitest in Node
- `main/ipc/handlers/` — thin glue that calls services and validates payloads
- `preload/` — single contextBridge surface; renderer never reaches around it
- `renderer/` — React only; never imports from `main/` or Node modules

---

## Conventions

- Package manager: **npm** (lockfile committed)
- Node: **v20.x LTS** (engines field enforced)
- Commit style: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `build:`)
- Each commit must build and pass tests
- All TypeScript strict mode on
- No `any` without justification comment

---

## Task 1: Initialize Repo and Tooling

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.editorconfig`
- Create: `README.md`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`

- [ ] **Step 1: Initialize git and npm**

Run from project root:

```bash
git init
git branch -M main
npm init -y
```

- [ ] **Step 2: Set package.json metadata**

Replace generated `package.json` with:

```json
{
  "name": "flowstate",
  "version": "0.0.1",
  "description": "Local AI agent dashboard powered by Ollama.",
  "main": "out/main/index.js",
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "license": "UNLICENSED",
  "private": true
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
out/
dist/
.vite/
.env
.env.local
*.log
.DS_Store
Thumbs.db
.vscode/*
!.vscode/extensions.json
.idea/
coverage/
*.sqlite
*.sqlite-journal
*.sqlite-wal
*.sqlite-shm
```

- [ ] **Step 4: Write `.editorconfig`**

```ini
root = true

[*]
end_of_line = lf
insert_final_newline = true
charset = utf-8
indent_style = space
indent_size = 2
trim_trailing_whitespace = true
```

- [ ] **Step 5: Write minimal `README.md`**

```markdown
# Flowstate

Local AI agent dashboard powered by Ollama. Runs entirely on your machine — no API keys, no cloud.

## Requirements

- Node.js 20+
- [Ollama](https://ollama.com) running locally on `http://localhost:11434`

## Develop

```bash
npm install
npm run dev
```

## Test

```bash
npm test
```
```

- [ ] **Step 6: Write `tsconfig.node.json`** (main + preload)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "out",
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@main/*": ["src/main/*"]
    }
  },
  "include": [
    "src/main/**/*",
    "src/preload/**/*",
    "src/shared/**/*",
    "tests/**/*"
  ]
}
```

- [ ] **Step 7: Write `tsconfig.web.json`** (renderer)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": [],
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["src/shared/*"],
      "@renderer/*": ["src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "chore: initialize repo, package.json, tsconfig"
```

---

## Task 2: Install Dependencies

**Files:** `package.json` (modified by npm install commands)

- [ ] **Step 1: Install runtime deps**

```bash
npm install electron@^33 better-sqlite3@^11 ollama@^0.5 zod@^3 react@^18 react-dom@^18 react-router-dom@^6
```

- [ ] **Step 2: Install dev deps**

```bash
npm install -D electron-vite@^2 vite@^5 typescript@^5 @types/node@^20 @types/react@^18 @types/react-dom@^18 @vitejs/plugin-react@^4 eslint@^9 prettier@^3 vitest@^2 tailwindcss@^3 postcss@^8 autoprefixer@^10 @types/better-sqlite3
```

- [ ] **Step 3: Rebuild native module for Electron**

`better-sqlite3` is native; needs Electron-targeted build. Add to `package.json` scripts:

```json
"postinstall": "electron-rebuild -f -w better-sqlite3"
```

Then install `@electron/rebuild`:

```bash
npm install -D @electron/rebuild
npm run postinstall
```

If `electron-rebuild` complains about not finding the binary, run:

```bash
npx electron-rebuild -f -w better-sqlite3
```

Expected: completes with no errors. If it fails, document the error in README under "Known issues" before continuing.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install runtime and dev dependencies"
```

---

## Task 3: Configure electron-vite, Tailwind, vitest

**Files:**
- Create: `electron.vite.config.ts`
- Create: `tailwind.config.ts`
- Create: `postcss.config.cjs`
- Create: `vitest.config.ts`
- Create: `src/renderer/src/styles.css`

- [ ] **Step 1: Write `electron.vite.config.ts`**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: 'out/renderer',
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    root: 'src/renderer',
  },
});
```

- [ ] **Step 2: Write `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 3: Write `postcss.config.cjs`**

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 4: Write `src/renderer/src/styles.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
}
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #0b0b10;
  color: #e6e6ea;
}
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
    },
  },
});
```

- [ ] **Step 6: Verify configs parse**

```bash
npx tsc -p tsconfig.node.json --noEmit
```

Expected: no errors (it has nothing to compile yet beyond type files). If the command exits 0, configs are syntactically valid.

- [ ] **Step 7: Commit**

```bash
git add electron.vite.config.ts tailwind.config.ts postcss.config.cjs vitest.config.ts src/renderer/src/styles.css
git commit -m "build: configure electron-vite, tailwind, vitest"
```

---

## Task 4: Shared Types and IPC Channel Definitions

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipc-channels.ts`
- Test: `tests/shared/ipc-channels.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/shared/ipc-channels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHANNELS, schemas } from '@shared/ipc-channels';

describe('ipc-channels', () => {
  it('declares settings channels with stable names', () => {
    expect(CHANNELS.SETTINGS_GET).toBe('settings:get');
    expect(CHANNELS.SETTINGS_SET).toBe('settings:set');
  });

  it('declares ollama channels with stable names', () => {
    expect(CHANNELS.OLLAMA_HEALTH).toBe('ollama:health');
  });

  it('settings:set request schema rejects empty key', () => {
    const result = schemas.settingsSetRequest.safeParse({ key: '', value: 'x' });
    expect(result.success).toBe(false);
  });

  it('settings:set request schema accepts valid payload', () => {
    const result = schemas.settingsSetRequest.safeParse({ key: 'workspaces_dir', value: '/tmp/ws' });
    expect(result.success).toBe(true);
  });

  it('ollama:health response schema accepts valid status', () => {
    const result = schemas.ollamaHealthResponse.safeParse({
      reachable: true,
      version: '0.4.0',
      host: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });

  it('ollama:health response schema accepts unreachable without version', () => {
    const result = schemas.ollamaHealthResponse.safeParse({
      reachable: false,
      host: 'http://localhost:11434',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- tests/shared/ipc-channels.test.ts
```

Expected: FAIL — "Cannot find module '@shared/ipc-channels'".

- [ ] **Step 3: Write `src/shared/types.ts`**

```ts
export interface SettingRow {
  key: string;
  value: string;
}

export interface OllamaHealth {
  reachable: boolean;
  version?: string;
  host: string;
  errorMessage?: string;
}
```

- [ ] **Step 4: Write `src/shared/ipc-channels.ts`**

```ts
import { z } from 'zod';

export const CHANNELS = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_LIST: 'settings:list',
  OLLAMA_HEALTH: 'ollama:health',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export const schemas = {
  settingsGetRequest: z.object({
    key: z.string().min(1),
  }),
  settingsGetResponse: z.object({
    value: z.string().nullable(),
  }),
  settingsSetRequest: z.object({
    key: z.string().min(1),
    value: z.string(),
  }),
  settingsSetResponse: z.object({
    ok: z.literal(true),
  }),
  settingsListRequest: z.object({}),
  settingsListResponse: z.object({
    items: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  ollamaHealthRequest: z.object({}),
  ollamaHealthResponse: z.object({
    reachable: z.boolean(),
    version: z.string().optional(),
    host: z.string(),
    errorMessage: z.string().optional(),
  }),
};

export type SettingsGetRequest = z.infer<typeof schemas.settingsGetRequest>;
export type SettingsGetResponse = z.infer<typeof schemas.settingsGetResponse>;
export type SettingsSetRequest = z.infer<typeof schemas.settingsSetRequest>;
export type SettingsSetResponse = z.infer<typeof schemas.settingsSetResponse>;
export type SettingsListResponse = z.infer<typeof schemas.settingsListResponse>;
export type OllamaHealthResponse = z.infer<typeof schemas.ollamaHealthResponse>;
```

- [ ] **Step 5: Run tests, verify they pass**

```bash
npm test -- tests/shared/ipc-channels.test.ts
```

Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/shared tests/shared
git commit -m "feat(shared): add IPC channel constants and zod schemas"
```

---

## Task 5: SQLite Database Module + Migrations

**Files:**
- Create: `src/main/paths.ts`
- Create: `src/main/db/migrations/001_init.sql`
- Create: `src/main/db/database.ts`
- Test: `tests/main/db/database.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/main/db/database.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-db-'));
  dbPath = join(dir, 'test.sqlite');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase', () => {
  it('creates the file if it does not exist', () => {
    const db = openDatabase(dbPath);
    expect(db).toBeDefined();
    db.close();
  });

  it('enables WAL journal mode', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('wal');
    db.close();
  });

  it('creates the settings table on first open', () => {
    const db = openDatabase(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('settings');
    expect(names).toContain('schema_version');
    db.close();
  });

  it('records the migration version', () => {
    const db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBe(1);
    db.close();
  });

  it('is idempotent across reopens', () => {
    let db = openDatabase(dbPath);
    db.close();
    db = openDatabase(dbPath);
    const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
    expect(row.v).toBe(1);
    db.close();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- tests/main/db/database.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/paths.ts`**

```ts
import { app } from 'electron';
import { join } from 'node:path';

export function appDataDir(): string {
  return app.getPath('userData');
}

export function databasePath(): string {
  return join(appDataDir(), 'flowstate.sqlite');
}

export function defaultWorkspacesDir(): string {
  return join(app.getPath('home'), 'Flowstate', 'workspaces');
}
```

- [ ] **Step 4: Write `src/main/db/migrations/001_init.sql`**

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

- [ ] **Step 5: Write `src/main/db/database.ts`**

SQL files are inlined at build time via Vite's `?raw` import — no runtime filesystem lookup, no asset-copy step.

```ts
import Database, { type Database as DB } from 'better-sqlite3';
import migration001 from './migrations/001_init.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: migration001 },
];

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentRow = db
    .prepare('SELECT MAX(version) AS v FROM schema_version')
    .get() as { v: number | null };
  const current = currentRow.v ?? 0;

  const insertVersion = db.prepare(
    'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
  );

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      insertVersion.run(m.version, Date.now());
    })();
  }

  return db;
}
```

Vite's `?raw` import is supported in vitest by default. For TypeScript to accept the import, we need an ambient module declaration — added in next step.

- [ ] **Step 6: Add ambient declaration for `?raw` imports**

Create `src/shared/raw-imports.d.ts`:

```ts
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
```

- [ ] **Step 7: Run tests, verify they pass**

```bash
npm test -- tests/main/db/database.test.ts
```

Expected: 5 passed.

- [ ] **Step 8: Commit**

```bash
git add src/main/paths.ts src/main/db src/shared/raw-imports.d.ts tests/main/db
git commit -m "feat(main): add SQLite database opener with inlined migrations"
```

---

## Task 6: Settings Service

**Files:**
- Create: `src/main/services/settings-service.ts`
- Test: `tests/main/services/settings-service.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/main/services/settings-service.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@main/db/database';
import { SettingsService } from '@main/services/settings-service';
import type { Database } from 'better-sqlite3';

let dir: string;
let db: Database;
let svc: SettingsService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-settings-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  svc = new SettingsService(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('returns null for unknown key', () => {
    expect(svc.get('nope')).toBeNull();
  });

  it('round-trips a value', () => {
    svc.set('workspaces_dir', '/tmp/ws');
    expect(svc.get('workspaces_dir')).toBe('/tmp/ws');
  });

  it('overwrites existing value', () => {
    svc.set('theme', 'dark');
    svc.set('theme', 'light');
    expect(svc.get('theme')).toBe('light');
  });

  it('lists all settings', () => {
    svc.set('a', '1');
    svc.set('b', '2');
    const items = svc.list().sort((x, y) => x.key.localeCompare(y.key));
    expect(items).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('throws on empty key', () => {
    expect(() => svc.set('', 'x')).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- tests/main/services/settings-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/services/settings-service.ts`**

```ts
import type { Database } from 'better-sqlite3';
import type { SettingRow } from '@shared/types';

export class SettingsService {
  private getStmt;
  private setStmt;
  private listStmt;

  constructor(private readonly db: Database) {
    this.getStmt = db.prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?',
    );
    this.setStmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.listStmt = db.prepare<[], { key: string; value: string }>(
      'SELECT key, value FROM settings ORDER BY key',
    );
  }

  get(key: string): string | null {
    const row = this.getStmt.get(key);
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    if (key.length === 0) {
      throw new Error('settings key must not be empty');
    }
    this.setStmt.run(key, value);
  }

  list(): SettingRow[] {
    return this.listStmt.all();
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- tests/main/services/settings-service.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/settings-service.ts tests/main/services/settings-service.test.ts
git commit -m "feat(main): add SettingsService for key/value persistence"
```

---

## Task 7: Ollama Client

**Files:**
- Create: `src/main/services/ollama-client.ts`
- Test: `tests/main/services/ollama-client.test.ts`

The `ollama` npm package speaks to `http://localhost:11434` by default. We add a thin wrapper so tests can inject a fake fetch.

- [ ] **Step 1: Write the failing test**

`tests/main/services/ollama-client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { OllamaClient } from '@main/services/ollama-client';

describe('OllamaClient.health', () => {
  it('returns reachable=true with version when /api/version succeeds', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 }),
    );
    const client = new OllamaClient('http://localhost:11434', fetchMock);
    const result = await client.health();
    expect(result.reachable).toBe(true);
    expect(result.version).toBe('0.4.0');
    expect(result.host).toBe('http://localhost:11434');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/version',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns reachable=false when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new OllamaClient('http://localhost:11434', fetchMock);
    const result = await client.health();
    expect(result.reachable).toBe(false);
    expect(result.errorMessage).toContain('ECONNREFUSED');
  });

  it('returns reachable=false when status >= 400', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = new OllamaClient('http://localhost:11434', fetchMock);
    const result = await client.health();
    expect(result.reachable).toBe(false);
    expect(result.errorMessage).toContain('500');
  });

  it('aborts after timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const client = new OllamaClient('http://localhost:11434', fetchMock, 50);
    const result = await client.health();
    expect(result.reachable).toBe(false);
    expect(result.errorMessage?.toLowerCase()).toContain('abort');
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npm test -- tests/main/services/ollama-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/main/services/ollama-client.ts`**

```ts
import type { OllamaHealth } from '@shared/types';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export class OllamaClient {
  constructor(
    private readonly host: string,
    private readonly fetchFn: FetchFn = fetch,
    private readonly timeoutMs: number = 2000,
  ) {}

  async health(): Promise<OllamaHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.host}/api/version`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!res.ok) {
        return {
          reachable: false,
          host: this.host,
          errorMessage: `HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as { version?: string };
      return {
        reachable: true,
        host: this.host,
        version: body.version,
      };
    } catch (err) {
      return {
        reachable: false,
        host: this.host,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npm test -- tests/main/services/ollama-client.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/ollama-client.ts tests/main/services/ollama-client.test.ts
git commit -m "feat(main): add OllamaClient with health check + timeout"
```

---

## Task 8: IPC Handler Registration

**Files:**
- Create: `src/main/ipc/handlers/settings.ts`
- Create: `src/main/ipc/handlers/ollama.ts`
- Create: `src/main/ipc/register.ts`

Validation pattern: every handler parses request with the matching zod schema, calls a service, responds. On schema failure, throw — `ipcMain.handle` will surface it to the renderer.

- [ ] **Step 1: Write `src/main/ipc/handlers/settings.ts`**

```ts
import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';

export function registerSettingsHandlers(svc: SettingsService): void {
  ipcMain.handle(CHANNELS.SETTINGS_GET, (_event, raw) => {
    const { key } = schemas.settingsGetRequest.parse(raw);
    return { value: svc.get(key) };
  });

  ipcMain.handle(CHANNELS.SETTINGS_SET, (_event, raw) => {
    const { key, value } = schemas.settingsSetRequest.parse(raw);
    svc.set(key, value);
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.SETTINGS_LIST, () => {
    return { items: svc.list() };
  });
}
```

- [ ] **Step 2: Write `src/main/ipc/handlers/ollama.ts`**

```ts
import { ipcMain } from 'electron';
import { CHANNELS } from '@shared/ipc-channels';
import type { OllamaClient } from '@main/services/ollama-client';

export function registerOllamaHandlers(client: OllamaClient): void {
  ipcMain.handle(CHANNELS.OLLAMA_HEALTH, () => client.health());
}
```

- [ ] **Step 3: Write `src/main/ipc/register.ts`**

```ts
import type { SettingsService } from '@main/services/settings-service';
import type { OllamaClient } from '@main/services/ollama-client';
import { registerSettingsHandlers } from './handlers/settings';
import { registerOllamaHandlers } from './handlers/ollama';

export function registerIpcHandlers(deps: {
  settings: SettingsService;
  ollama: OllamaClient;
}): void {
  registerSettingsHandlers(deps.settings);
  registerOllamaHandlers(deps.ollama);
}
```

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc
git commit -m "feat(main): register settings and ollama IPC handlers"
```

---

## Task 9: Main Entry — Window + Lifecycle

**Files:**
- Create: `src/main/index.ts`

- [ ] **Step 1: Write `src/main/index.ts`**

```ts
import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/database';
import { databasePath, defaultWorkspacesDir } from './paths';
import { SettingsService } from './services/settings-service';
import { OllamaClient } from './services/ollama-client';
import { registerIpcHandlers } from './ipc/register';

const here = fileURLToPath(new URL('.', import.meta.url));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0b0b10',
    show: false,
    webPreferences: {
      preload: join(here, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(here, '../renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  const db = openDatabase(databasePath());
  const settings = new SettingsService(db);

  if (settings.get('workspaces_dir') === null) {
    settings.set('workspaces_dir', defaultWorkspacesDir());
  }

  const ollamaHost = settings.get('ollama_host') ?? 'http://localhost:11434';
  const ollama = new OllamaClient(ollamaHost);

  registerIpcHandlers({ settings, ollama });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): app lifecycle, window creation, service wiring"
```

---

## Task 10: Preload Bridge

**Files:**
- Create: `src/preload/index.ts`

- [ ] **Step 1: Write `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '@shared/ipc-channels';
import type {
  SettingsGetResponse,
  SettingsSetResponse,
  SettingsListResponse,
  OllamaHealthResponse,
} from '@shared/ipc-channels';

const api = {
  settings: {
    get: (key: string): Promise<SettingsGetResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_GET, { key }),
    set: (key: string, value: string): Promise<SettingsSetResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_SET, { key, value }),
    list: (): Promise<SettingsListResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_LIST, {}),
  },
  ollama: {
    health: (): Promise<OllamaHealthResponse> =>
      ipcRenderer.invoke(CHANNELS.OLLAMA_HEALTH, {}),
  },
};

contextBridge.exposeInMainWorld('flowstate', api);

export type FlowstateApi = typeof api;
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose typed flowstate API via contextBridge"
```

---

## Task 11: Renderer — Mount + Settings Screen

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/main.tsx`
- Create: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/lib/ipc.ts`
- Create: `src/renderer/src/screens/Settings.tsx`

- [ ] **Step 1: Write `src/renderer/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Flowstate</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `src/renderer/src/lib/ipc.ts`**

Renderer cannot import from `src/preload/` at type level (its tsconfig excludes that path), so we redeclare the API surface here. The preload's actual `FlowstateApi` is the source of truth at runtime; this declaration is what the renderer compiles against. If they drift, runtime calls will fail loudly — covered later by an integration smoke test in Task 12.

```ts
import type {
  SettingsGetResponse,
  SettingsSetResponse,
  SettingsListResponse,
  OllamaHealthResponse,
} from '@shared/ipc-channels';

interface FlowstateApi {
  settings: {
    get: (key: string) => Promise<SettingsGetResponse>;
    set: (key: string, value: string) => Promise<SettingsSetResponse>;
    list: () => Promise<SettingsListResponse>;
  };
  ollama: {
    health: () => Promise<OllamaHealthResponse>;
  };
}

declare global {
  interface Window {
    flowstate: FlowstateApi;
  }
}

export const ipc: FlowstateApi = window.flowstate;
```

- [ ] **Step 3: Write `src/renderer/src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Write `src/renderer/src/App.tsx`**

```tsx
import { Settings } from './screens/Settings';

export function App(): JSX.Element {
  return (
    <div className="h-full p-8">
      <h1 className="text-2xl font-semibold mb-6">Flowstate</h1>
      <Settings />
    </div>
  );
}
```

- [ ] **Step 5: Write `src/renderer/src/screens/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';

interface State {
  ollama: { reachable: boolean; version?: string; host: string; errorMessage?: string } | null;
  workspacesDir: string;
  loading: boolean;
}

export function Settings(): JSX.Element {
  const [state, setState] = useState<State>({
    ollama: null,
    workspacesDir: '',
    loading: true,
  });

  async function refresh(): Promise<void> {
    setState((s) => ({ ...s, loading: true }));
    const [health, ws] = await Promise.all([
      ipc.ollama.health(),
      ipc.settings.get('workspaces_dir'),
    ]);
    setState({
      ollama: health,
      workspacesDir: ws.value ?? '',
      loading: false,
    });
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (state.loading) {
    return <p className="text-sm opacity-70">Loading…</p>;
  }

  const ollamaBadge = state.ollama?.reachable ? (
    <span className="inline-flex items-center gap-2 rounded-full bg-emerald-900/40 px-3 py-1 text-emerald-300">
      Connected
      {state.ollama.version ? <span className="opacity-70">v{state.ollama.version}</span> : null}
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 rounded-full bg-rose-900/40 px-3 py-1 text-rose-300">
      Not detected
    </span>
  );

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-medium mb-2">Ollama</h2>
        <div className="flex items-center gap-3">
          {ollamaBadge}
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-white/15 px-3 py-1 text-sm hover:bg-white/5"
          >
            Re-check
          </button>
        </div>
        <p className="mt-2 text-sm opacity-70">
          Host: <code>{state.ollama?.host}</code>
        </p>
        {!state.ollama?.reachable ? (
          <p className="mt-2 text-sm">
            Install Ollama from{' '}
            <a className="underline" href="https://ollama.com" target="_blank" rel="noreferrer">
              ollama.com
            </a>{' '}
            and run <code>ollama serve</code>.
          </p>
        ) : null}
        {state.ollama?.errorMessage ? (
          <p className="mt-2 text-sm text-rose-300">{state.ollama.errorMessage}</p>
        ) : null}
      </div>

      <div>
        <h2 className="text-lg font-medium mb-2">Workspaces directory</h2>
        <code className="text-sm opacity-80">{state.workspacesDir}</code>
        <p className="mt-1 text-sm opacity-60">
          Each agent's sandboxed folder will be created inside this directory.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): settings screen with live ollama health check"
```

---

## Task 12: First Run — Smoke Test

**Files:** none (manual verification)

- [ ] **Step 1: Start Ollama (if installed)**

In a separate terminal:

```bash
ollama serve
```

If not installed, skip — we'll test the unreachable path.

- [ ] **Step 2: Run dev**

```bash
npm run dev
```

Expected:
- electron-vite spins up
- Window opens, no console errors in DevTools
- Settings screen shows either "Connected v0.x.y" (if Ollama running) or "Not detected" with install link

- [ ] **Step 3: Verify SQLite file created**

Check:

- Windows: `%APPDATA%\flowstate\flowstate.sqlite` exists
- macOS: `~/Library/Application Support/flowstate/flowstate.sqlite`
- Linux: `~/.config/flowstate/flowstate.sqlite`

Open with any SQLite browser, confirm `settings` table contains `workspaces_dir` row.

- [ ] **Step 4: Verify reachability toggle**

- If Ollama was running: stop it (`Ctrl+C` in its terminal), click "Re-check" in Settings → badge flips to "Not detected".
- If not running: start `ollama serve`, click "Re-check" → flips to "Connected".

- [ ] **Step 5: No commit**

This step is verification only.

---

## Task 13: Production Build Sanity

Migrations are inlined at build time (Task 5), so no asset-copy step is needed. We just verify the build artifact runs.

**Files:** none modified

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: completes with no errors. `out/main/index.js`, `out/preload/index.js`, `out/renderer/index.html` all exist. Confirm the embedded SQL string appears in `out/main/index.js` (sanity check the `?raw` inline worked):

```bash
grep -c "CREATE TABLE IF NOT EXISTS settings" out/main/index.js
```

Expected output: `1` (or higher).

- [ ] **Step 2: Run packaged preview**

```bash
npm start
```

Expected: same Settings screen as dev, ollama check works, SQLite file gets created.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests from tasks 4–7 pass.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5: No commit**

This task is verification only.

---

## Task 14: Tag the Foundation Milestone

- [ ] **Step 1: Verify clean state**

```bash
git status
```

Expected: nothing to commit.

- [ ] **Step 2: Tag**

```bash
git tag plan-a-foundation
```

- [ ] **Step 3: Update README "Status"**

Append to `README.md`:

```markdown

## Status

- ✅ Plan A — Foundation (Electron shell, SQLite, IPC, Ollama health check)
- ⏳ Plan B — Path sandbox + file tools
- ⏳ Plan C — Single-agent runtime + chat UI
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: mark Plan A complete in README"
```

---

## Done Criteria

- `npm run dev` opens Flowstate window
- Settings screen reflects live Ollama state and toggles correctly with `Re-check`
- SQLite DB exists at platform user-data path with `settings` and `schema_version` tables
- `npm test` reports all green (≥20 tests across shared, db, settings, ollama)
- `npm run typecheck` clean
- `npm run build` produces a runnable `npm start`
- `git tag plan-a-foundation` exists
