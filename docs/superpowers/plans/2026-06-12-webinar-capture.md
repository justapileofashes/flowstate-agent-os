# Webinar Capture (free-plan recorder) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record any webinar/meeting without a paid plan by capturing system audio via Electron loopback, transcribing locally (pluggable STT), and summarizing through a flowclaw gateway connection.

**Architecture:** Renderer captures system audio with `getDisplayMedia` (loopback enabled in main via `setDisplayMediaRequestHandler`), streams webm chunks over IPC; main appends to disk and on stop runs transcribe → summarize → chat pipeline (mirror of ZoomRecorder). Transcription is a pluggable `Transcriber` interface (OpenAI-compatible HTTP server or CLI command).

**Tech Stack:** Electron 33, TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), vitest, zod IPC schemas.

**Spec:** `docs/superpowers/specs/2026-06-11-webinar-capture-design.md`

**Branch:** all three 2026-06-12 plans execute on one branch `session/capture-business-ui`, created from `main` before Task 1 of this plan. Run tests with `npx vitest run <file>` (NEVER `npm test` — pretest rebuilds better-sqlite3 and fails on this machine). Typecheck: `npx tsc --noEmit -p tsconfig.node.json` and `npx tsc --noEmit -p tsconfig.web.json`.

---

### Task 0: Branch

- [ ] **Step 1:** `git checkout -b session/capture-business-ui` (from main, working tree clean).

### Task 1: Transcriber service

**Files:**
- Create: `src/main/services/transcriber.ts`
- Test: `tests/main/services/transcriber.test.ts`

**Patterns to mirror:** `src/main/services/zoom-creds.ts` (SecretStore usage — encrypt one field, write-only, null on junk), `src/main/services/flowclaw-store.ts` (`SettingsKV` interface import), `tests/main/services/zoom-service.test.ts` (real `node:http` fake server over TCP, injected fetch not needed — use real global fetch against `http://127.0.0.1:<port>`).

- [ ] **Step 1: Write failing tests** — `tests/main/services/transcriber.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OpenAICompatTranscriber,
  CliTranscriber,
  TranscriberStore,
  buildTranscriber,
} from '@main/services/transcriber';

// Reversible fake secret backend — same idiom as zoom-creds.test.ts.
// Copy the fake SettingsKV + SecretBackend helpers from tests/main/services/zoom-creds.test.ts.

describe('OpenAICompatTranscriber', () => {
  it('POSTs multipart with file bytes + model and returns text', async () => {
    let gotAuth = '';
    let gotBody = Buffer.alloc(0);
    const srv = createServer((req, res) => {
      gotAuth = String(req.headers['authorization'] ?? '');
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        gotBody = Buffer.concat(chunks);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ text: 'hello transcript' }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    const audio = join(dir, 'audio.webm');
    writeFileSync(audio, Buffer.from('FAKEWEBMBYTES'));

    const t = new OpenAICompatTranscriber({
      url: `http://127.0.0.1:${port}`,
      model: 'whisper-1',
      apiKey: 'sk-test',
    });
    const text = await t.transcribe(audio);
    expect(text).toBe('hello transcript');
    expect(gotAuth).toBe('Bearer sk-test');
    const body = gotBody.toString('latin1');
    expect(body).toContain('FAKEWEBMBYTES');
    expect(body).toContain('whisper-1');
    srv.close();
  });

  it('test() is ok on any HTTP response, fails only on network error', async () => {
    const srv = createServer((_req, res) => { res.statusCode = 404; res.end('no'); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const t = new OpenAICompatTranscriber({ url: `http://127.0.0.1:${port}`, model: 'm' });
    expect((await t.test()).ok).toBe(true);
    srv.close();
    const dead = new OpenAICompatTranscriber({ url: 'http://127.0.0.1:1', model: 'm' });
    const res = await dead.test();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('CliTranscriber', () => {
  it('runs the command template and captures stdout', async () => {
    const t = new CliTranscriber({ command: `node -e "console.log('hi from cli')" {file}` });
    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    const audio = join(dir, 'a.webm');
    writeFileSync(audio, 'x');
    expect((await t.transcribe(audio)).trim()).toBe('hi from cli');
  });

  it('test() reports exit-code success/failure', async () => {
    const ok = new CliTranscriber({ command: `node -e "process.exit(0)" {file}` });
    expect((await ok.test()).ok).toBe(true);
    const bad = new CliTranscriber({ command: `node -e "process.exit(3)" {file}` });
    expect((await bad.test()).ok).toBe(false);
  });
});

describe('TranscriberStore + buildTranscriber', () => {
  it('round-trips config with apiKey encrypted at rest', () => {
    // fakeKV + reversible fakeBackend from zoom-creds.test.ts
    // store.save({mode:'openai', url:'http://x', model:'m', apiKey:'secret'})
    // expect raw KV value to contain 'enc:v1:' and NOT contain 'secret'
    // expect(store.load()?.apiKey).toBe('secret')
  });

  it('buildTranscriber returns null when unconfigured', () => {
    // empty KV → buildTranscriber(store) === null
  });

  it('buildTranscriber returns the right implementation per mode', () => {
    // mode openai → instanceof OpenAICompatTranscriber
    // mode cli (command set) → instanceof CliTranscriber
  });
});
```

(Flesh out the three commented bodies with the fake KV/backend helpers copied from `tests/main/services/zoom-creds.test.ts` — same `fakeKV()` map-backed SettingsKV and reversible `fakeBackend` asserting the `enc:v1:` prefix at rest.)

- [ ] **Step 2:** `npx vitest run tests/main/services/transcriber.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement** `src/main/services/transcriber.ts`:

```ts
// Pluggable speech-to-text for webinar captures. Two backends: any
// OpenAI-compatible /v1/audio/transcriptions server (speaches,
// faster-whisper-server, OpenAI itself) or a user CLI command template.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { SettingsKV } from './flowclaw-store';
import type { SecretStore } from './secret-store';

export interface Transcriber {
  transcribe(filePath: string): Promise<string>;
  test(): Promise<{ ok: boolean; error?: string }>;
}

export interface TranscriberConfig {
  mode: 'openai' | 'cli';
  url?: string;
  apiKey?: string;
  model?: string;
  command?: string;
}

type FetchLike = typeof fetch;

export class OpenAICompatTranscriber implements Transcriber {
  constructor(
    private readonly cfg: { url: string; model: string; apiKey?: string },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async transcribe(filePath: string): Promise<string> {
    const form = new FormData();
    const bytes = readFileSync(filePath);
    form.append('file', new Blob([bytes]), basename(filePath));
    form.append('model', this.cfg.model);
    const res = await this.fetchImpl(`${this.cfg.url.replace(/\/$/, '')}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(`transcription failed: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return String(body['text'] ?? '');
  }

  async test(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.fetchImpl(`${this.cfg.url.replace(/\/$/, '')}/v1/models`);
      return { ok: true }; // any HTTP response = reachable (some servers 404 /v1/models)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class CliTranscriber implements Transcriber {
  constructor(private readonly cfg: { command: string }) {}

  private run(file: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const cmd = this.cfg.command.split('{file}').join(`"${file}"`);
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, { shell: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }

  async transcribe(filePath: string): Promise<string> {
    const { code, stdout, stderr } = await this.run(filePath);
    if (code !== 0) throw new Error(`transcriber exited ${code}: ${stderr.slice(0, 300)}`);
    return stdout;
  }

  async test(): Promise<{ ok: boolean; error?: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'flowstate-tr-'));
    const empty = join(dir, 'empty.webm');
    writeFileSync(empty, '');
    try {
      const { code, stderr } = await this.run(empty);
      return code === 0 ? { ok: true } : { ok: false, error: `exit ${code}: ${stderr.slice(0, 300)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const TRANSCRIBER_KEY = 'capture_transcriber';

export class TranscriberStore {
  constructor(
    private readonly settings: SettingsKV,
    private readonly secrets: SecretStore,
  ) {}
  // save(): encrypt apiKey via this.secrets (exact call mirrors ZoomCredsStore.save
  // in src/main/services/zoom-creds.ts), JSON.stringify into settings under
  // TRANSCRIBER_KEY. load(): null on missing/junk JSON; decrypt apiKey if present.
  save(cfg: TranscriberConfig): void { /* mirror ZoomCredsStore.save */ }
  load(): TranscriberConfig | null { /* mirror ZoomCredsStore.load */ return null; }
}

export function buildTranscriber(store: TranscriberStore, fetchImpl?: FetchLike): Transcriber | null {
  const cfg = store.load();
  if (!cfg) return null;
  if (cfg.mode === 'openai' && cfg.url && cfg.model) {
    return new OpenAICompatTranscriber(
      { url: cfg.url, model: cfg.model, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) },
      fetchImpl ?? fetch,
    );
  }
  if (cfg.mode === 'cli' && cfg.command) return new CliTranscriber({ command: cfg.command });
  return null;
}
```

(Fill the two `mirror ZoomCredsStore` bodies from `src/main/services/zoom-creds.ts` — identical encrypt/decrypt + junk-tolerant load, with `apiKey` the encrypted field.)

- [ ] **Step 4:** `npx vitest run tests/main/services/transcriber.test.ts` — expect PASS (all).
- [ ] **Step 5:** `git add -A src/main/services/transcriber.ts tests/main/services/transcriber.test.ts && git commit -m "feat(capture): pluggable transcriber (OpenAI-compatible + CLI) with encrypted config store"`

### Task 2: CaptureRecorder

**Files:**
- Create: `src/main/services/capture-recorder.ts`
- Test: `tests/main/services/capture-recorder.test.ts`

Imports `RunDispatcher` + `ChatSink` from `src/main/services/zoom-recorder.ts` (already exported there).

- [ ] **Step 1: Write failing tests** covering, with a temp dir + fake dispatcher/chats/transcriber:
  - `start()` creates job `recording` + empty audio file at `captures/<id>/audio.webm`.
  - `appendChunk()` appends bytes to the file and bumps `bytes`/`updatedAt`.
  - `stop()` happy path: transcriber called with the audio path → dispatcher `runToText(connectionId, prompt, {model})` (assert model override passed) → chat created titled `Capture · <title>` with user=prompt containing the transcript and assistant=summary + audio path → status `done`, `chatId` set.
  - transcriber throws → still `done`; assistant message contains the audio path and a "transcription failed" note; dispatcher NOT called with a transcript prompt (it gets the no-transcript fallback or is skipped — per spec: chat still created with audio path + note; gateway summarize SKIPPED when no transcript, since there is nothing to summarize).
  - transcriber null (unconfigured) → same non-fatal path with "transcriber not configured" note.
  - dispatcher throws → status `error` with message.
  - jobs persist across instances (`new CaptureRecorder` re-reads `capture-jobs.json`).
  - restart with a job stuck `recording` → marked `error` "interrupted".

Test skeleton (expand each bullet into an `it()`):

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureRecorder } from '@main/services/capture-recorder';
import type { Transcriber } from '@main/services/transcriber';

function deps(dir: string, over: Partial<{ transcriber: Transcriber | null; runText: string; runThrows: boolean }> = {}) {
  const chats: Array<{ chatId: string; role: string; content: string }> = [];
  let chatN = 0;
  return {
    chats,
    recorder: new CaptureRecorder({
      jobsPath: join(dir, 'capture-jobs.json'),
      capturesDir: join(dir, 'captures'),
      getTranscriber: () => (over.transcriber === undefined ? fakeTranscriber('TRANSCRIPT TEXT') : over.transcriber),
      dispatcher: {
        runToText: async (_id: string, _prompt: string, _o?: { model?: string }) => {
          if (over.runThrows) throw new Error('gateway down');
          return over.runText ?? 'SUMMARY';
        },
      },
      chatSink: {
        createChat: (_agentId: string, _title?: string) => ({ id: `chat-${++chatN}` }),
        appendMessage: (chatId: string, m: { role: 'user' | 'assistant'; content: string }) => {
          chats.push({ chatId, role: m.role, content: m.content });
        },
      },
    }),
  };
}
function fakeTranscriber(text: string): Transcriber {
  return { transcribe: async () => text, test: async () => ({ ok: true }) };
}
```

- [ ] **Step 2:** `npx vitest run tests/main/services/capture-recorder.test.ts` — FAIL.
- [ ] **Step 3: Implement** `src/main/services/capture-recorder.ts`:

```ts
// System-audio capture jobs: renderer streams webm chunks in, we append to
// disk; on stop → transcribe (pluggable, failure non-fatal) → summarize via
// flowclaw gateway → persist a notes chat. Mirror of zoom-recorder.ts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Transcriber } from './transcriber';
import type { RunDispatcher, ChatSink } from './zoom-recorder';

export type CaptureJobStatus = 'recording' | 'transcribing' | 'summarizing' | 'done' | 'error';

export interface CaptureJob {
  id: string;
  title: string;
  agentId: string;
  connectionId: string;
  model?: string;
  status: CaptureJobStatus;
  audioPath: string;
  bytes: number;
  chatId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CaptureRecorderDeps {
  jobsPath: string;
  capturesDir: string;
  getTranscriber: () => Transcriber | null;
  dispatcher: RunDispatcher;
  chatSink: ChatSink;
  now?: () => number;
}

export interface CaptureStartInput {
  title: string;
  agentId: string;
  connectionId: string;
  model?: string;
}
```

Class: load jobs at construction (junk-tolerant), mark stuck `recording` → `error: 'interrupted'`; `start(input)` (mkdir `capturesDir/<id>`, `writeFileSync(audioPath, '')`, push job, persist, return job); `appendChunk(id, buf: Uint8Array)` (`appendFileSync(audioPath, buf)`, bytes += buf.byteLength); `stop(id): Promise<CaptureJob>` running the pipeline with a `private set(job, patch)` that persists + bumps updatedAt; `jobs()` accessor. Pipeline (in `stop`):

```ts
// transcribing
let transcript: string | null = null;
let note = '';
const t = this.deps.getTranscriber();
if (!t) note = 'Transcriber not configured — transcript unavailable.';
else {
  this.set(job, { status: 'transcribing' });
  try { transcript = await t.transcribe(job.audioPath); }
  catch (err) { note = `Transcription failed: ${err instanceof Error ? err.message : String(err)}`; }
}
try {
  let finalText: string;
  let prompt = '';
  if (transcript && transcript.trim()) {
    this.set(job, { status: 'summarizing' });
    prompt = buildCapturePrompt(job, transcript);
    const summary = await this.deps.dispatcher.runToText(job.connectionId, prompt, {
      ...(job.model ? { model: job.model } : {}),
    });
    finalText = `${summary}\n\n---\nLocal recording: ${job.audioPath}`;
  } else {
    prompt = `Capture "${job.title}" finished but no transcript is available.`;
    finalText = `${note}\n\nLocal recording: ${job.audioPath}`;
  }
  const chat = this.deps.chatSink.createChat(job.agentId, `Capture · ${job.title}`);
  this.deps.chatSink.appendMessage(chat.id, { role: 'user', content: prompt });
  this.deps.chatSink.appendMessage(chat.id, { role: 'assistant', content: finalText });
  this.set(job, { status: 'done', chatId: chat.id });
} catch (err) {
  this.set(job, { status: 'error', error: err instanceof Error ? err.message : String(err) });
}
return job;
```

`buildCapturePrompt(job, transcript)` (exported for tests): "You attended a recorded session titled "<title>". Write a concise summary, key decisions, and action items with owners.\n\nTranscript:\n<transcript truncated to 24_000 chars>".

- [ ] **Step 4:** `npx vitest run tests/main/services/capture-recorder.test.ts` — PASS.
- [ ] **Step 5:** Commit: `feat(capture): capture recorder job pipeline (record → transcribe → summarize → chat)`

### Task 3: IPC — channels, handler, register

**Files:**
- Modify: `src/shared/ipc-channels.ts` (CHANNELS after `ZOOM_OPEN_RECORDING`; schemas + DTOs near the zoom ones)
- Create: `src/main/ipc/handlers/capture.ts`
- Modify: `src/main/ipc/register.ts` (call after `registerZoomHandlers`)

- [ ] **Step 1:** Add to `CHANNELS`:

```ts
CAPTURE_START: 'capture:start',
CAPTURE_CHUNK: 'capture:chunk',
CAPTURE_STOP: 'capture:stop',
CAPTURE_JOBS: 'capture:jobs',
CAPTURE_SAVE_TRANSCRIBER: 'capture:save-transcriber',
CAPTURE_TEST_TRANSCRIBER: 'capture:test-transcriber',
```

Schemas (in `schemas`): `captureStartRequest: z.object({ title: z.string().min(1), agentId: z.string().min(1), connectionId: z.string().min(1), model: z.string().optional() })`; `captureStopRequest: z.object({ captureId: z.string().min(1) })`; `captureSaveTranscriberRequest: z.object({ mode: z.enum(['openai','cli']), url: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional(), command: z.string().optional() })`. Chunk payload is NOT zod-validated (binary; handler checks `captureId` string + `data instanceof Uint8Array || ArrayBuffer`). DTOs: `CaptureJobDto` mirroring `CaptureJob`, `CaptureJobsResponse { jobs: CaptureJobDto[] }`, `CaptureStartResponse { captureId: string }`.

- [ ] **Step 2:** Handler `src/main/ipc/handlers/capture.ts` — mirror `src/main/ipc/handlers/zoom.ts` exactly: `registerCaptureHandlers({ settings, repo })` builds SecretStore (electronSafeStorageBackend) → TranscriberStore → SettingsConnectionStore + FlowclawConnections (dispatcher) → CaptureRecorder with `jobsPath: join(app.getPath('userData'), 'capture-jobs.json')`, `capturesDir: join(app.getPath('userData'), 'captures')`, `chatSink: repo`. Six `ipcMain.handle` entries; `capture:chunk` converts `ArrayBuffer` → `new Uint8Array(buf)`; `capture:save-transcriber` write-only `{ok:true}`; `capture:test-transcriber` builds via `buildTranscriber` and returns `{ok:false, error:'not configured'}` when null.
- [ ] **Step 3:** Register in `src/main/ipc/register.ts`: `registerCaptureHandlers({ settings: deps.settings, repo: deps.repo });` after the zoom line.
- [ ] **Step 4:** `npx tsc --noEmit -p tsconfig.node.json` — clean.
- [ ] **Step 5:** Commit: `feat(capture): capture IPC surface (start/chunk/stop/jobs/transcriber config)`

### Task 4: Loopback + renderer helper + preload

**Files:**
- Modify: `src/main/index.ts` (inside `app.whenReady().then(...)` before window creation — the same async block that builds `manager` ~line 270; add near the top of it)
- Create: `src/renderer/src/lib/capture.ts`
- Modify: `src/preload/index.ts`, `src/renderer/src/lib/ipc.ts`

- [ ] **Step 1:** Loopback in `src/main/index.ts` (imports: add `session`, `desktopCapturer` to the existing `electron` import):

```ts
// System-audio loopback: makes renderer getDisplayMedia({audio:true}) yield
// desktop audio on Windows (Electron 33+). Used by the webinar Capture card.
session.defaultSession.setDisplayMediaRequestHandler(
  (_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const first = sources[0];
      if (first) callback({ video: first, audio: 'loopback' });
      else callback({});
    });
  },
  { useSystemPicker: false },
);
```

- [ ] **Step 2:** `src/renderer/src/lib/capture.ts`:

```ts
import { ipc } from './ipc';

// Captures system audio via the loopback handler registered in main.
// Caller creates the job first (ipc.capture.start) and passes its id here.
export async function startSystemAudioCapture(
  captureId: string,
): Promise<{ stop: () => Promise<void> }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  for (const track of stream.getVideoTracks()) track.stop(); // audio only
  const audio = new MediaStream(stream.getAudioTracks());
  const rec = new MediaRecorder(audio, { mimeType: 'audio/webm;codecs=opus' });
  rec.ondataavailable = (ev) => {
    if (ev.data.size > 0) {
      void ev.data.arrayBuffer().then((buf) => ipc.capture.chunk(captureId, buf));
    }
  };
  rec.start(5_000);
  return {
    stop: () =>
      new Promise<void>((resolve) => {
        rec.onstop = () => {
          for (const track of audio.getTracks()) track.stop();
          void ipc.capture.stop(captureId).then(() => resolve());
        };
        rec.stop(); // flushes a final ondataavailable before onstop
      }),
  };
}
```

- [ ] **Step 3:** Preload `src/preload/index.ts` — add `capture` block to the `api` object next to `zoom` (invoke each channel; `chunk: (captureId, data) => ipcRenderer.invoke(CHANNELS.CAPTURE_CHUNK, { captureId, data })` — structured clone carries the ArrayBuffer). Renderer `src/renderer/src/lib/ipc.ts` — add to `FlowstateApi`:

```ts
capture: {
  start: (req: { title: string; agentId: string; connectionId: string; model?: string }) =>
    Promise<{ captureId: string }>;
  chunk: (captureId: string, data: ArrayBuffer) => Promise<{ ok: boolean }>;
  stop: (captureId: string) => Promise<{ ok: boolean }>;
  jobs: () => Promise<import('@shared/ipc-channels').CaptureJobsResponse>;
  saveTranscriber: (cfg: { mode: 'openai' | 'cli'; url?: string; apiKey?: string; model?: string; command?: string }) =>
    Promise<{ ok: boolean }>;
  testTranscriber: () => Promise<{ ok: boolean; error?: string }>;
};
```

- [ ] **Step 4:** Both typechecks clean; `npx vitest run tests/main/services/transcriber.test.ts tests/main/services/capture-recorder.test.ts` PASS.
- [ ] **Step 5:** Commit: `feat(capture): system-audio loopback, renderer capture helper, preload surface`

---

## Self-review notes
- Spec §1–§7 all mapped: loopback (T4), capture.ts (T4), transcriber (T1), recorder (T2), IPC (T3), tests (T1/T2), UI addendum already superseded by `docs/claude-design-prompt-all-features.md`.
- Names pinned: `CaptureRecorder`, `buildTranscriber`, `TRANSCRIBER_KEY`, channels `capture:*`, DTO `CaptureJobDto`.
