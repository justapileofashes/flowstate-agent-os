# Zoom Meeting Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** flowclaw can arm a Zoom meeting for cloud recording, wait for it to finish, download the full recording + transcript locally, and dispatch the transcript to an OpenClaw/Hermes connection for a summary delivered as a chat.

**Architecture:** Three new main-process services with injected dependencies (no Electron/DB imports in the service layer, same pattern as the flowclaw services): `ZoomService` (S2S OAuth + Zoom REST), `ZoomCredsStore` (encrypted creds in settings KV), `ZoomRecorder` (persistent job store + 60s poller that drives the armed→done lifecycle and calls `FlowclawConnections.runToText`). One thin IPC handler wires them to the renderer.

**Tech Stack:** TypeScript (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes — use conditional spreads `...(x ? {x} : {})`, bracket access on parsed JSON), vitest, zod IPC schemas, `node:http` fake servers for integration-grade tests.

**Spec:** `docs/superpowers/specs/2026-06-10-zoom-meeting-recorder-design.md`
**Spec amendment locked here:** jobs carry `agentId` (chats require an agent FK; renderer picks the agent). `ZOOM_RECORD` request includes it.

**Run tests with `npx vitest run <file>` (NOT `npm test` — pretest rebuilds better-sqlite3, slow; these tests are DB-free).** Typecheck: `npx tsc --noEmit -p tsconfig.node.json` and `-p tsconfig.web.json`.

---

### Task 1: ZoomService (OAuth + REST client)

**Files:**
- Create: `src/main/services/zoom-service.ts`
- Test: `tests/main/services/zoom-service.test.ts`

- [ ] **Step 1: Write the failing test** — a real `node:http` fake Zoom served over TCP (same realism bar as `tests/main/agent/flowclaw-integration.test.ts`).

```ts
// tests/main/services/zoom-service.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZoomService } from '@main/services/zoom-service';

// ── Fake Zoom: /oauth/token (Basic auth), /v2 API (Bearer auth) ─────────────
let server: Server;
let base: string;
let tokenRequests = 0;
let lastPatchBody: unknown = null;
let recordingsResponse: { status: number; body: unknown } = { status: 404, body: {} };

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', base);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    tokenRequests++;
    const auth = req.headers.authorization ?? '';
    const expected = 'Basic ' + Buffer.from('cid:csecret').toString('base64');
    if (auth !== expected) return send(401, { error: 'bad basic auth' });
    if (url.searchParams.get('grant_type') !== 'account_credentials') {
      return send(400, { error: 'bad grant' });
    }
    if (url.searchParams.get('account_id') !== 'acc1') return send(400, { error: 'bad account' });
    return send(200, { access_token: 'tok-zoom', expires_in: 3600 });
  }

  // All /v2 routes require the bearer token.
  if ((req.headers.authorization ?? '') !== 'Bearer tok-zoom') return send(401, { error: 'no bearer' });

  if (url.pathname === '/v2/meetings/123' && req.method === 'PATCH') {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      lastPatchBody = JSON.parse(raw);
      res.writeHead(204).end();
    });
    return;
  }
  if (url.pathname === '/v2/users/me/meetings' && req.method === 'POST') {
    return send(201, { id: 9876543210, join_url: 'https://zoom.us/j/9876543210' });
  }
  if (url.pathname === '/v2/meetings/123/recordings' && req.method === 'GET') {
    return send(recordingsResponse.status, recordingsResponse.body);
  }
  if (url.pathname === '/files/video.mp4' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end(Buffer.from('FAKE-MP4-BYTES'));
    return;
  }
  if (url.pathname === '/files/transcript.vtt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/vtt' });
    res.end('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello world');
    return;
  }
  send(404, { error: 'not found' });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

const CREDS = { accountId: 'acc1', clientId: 'cid', clientSecret: 'csecret' };

function makeService(now?: () => number): ZoomService {
  return new ZoomService(() => CREDS, {
    oauthBase: base,
    apiBase: `${base}/v2`,
    ...(now ? { now } : {}),
  });
}

describe('ZoomService auth', () => {
  it('fetches a token with Basic auth + account_credentials grant, then caches it', async () => {
    tokenRequests = 0;
    const svc = makeService();
    expect((await svc.testAuth()).ok).toBe(true);
    await svc.ensureCloudRecording('123'); // second call must reuse the cached token
    expect(tokenRequests).toBe(1);
  });

  it('refreshes the token after expiry', async () => {
    tokenRequests = 0;
    let t = 1_000_000;
    const svc = makeService(() => t);
    await svc.ensureCloudRecording('123');
    t += 3601 * 1000; // past expires_in
    await svc.ensureCloudRecording('123');
    expect(tokenRequests).toBe(2);
  });

  it('reports auth failure when creds are wrong', async () => {
    const bad = new ZoomService(() => ({ ...CREDS, clientSecret: 'nope' }), {
      oauthBase: base,
      apiBase: `${base}/v2`,
    });
    const res = await bad.testAuth();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/401/);
  });

  it('throws a clear error when no creds are configured', async () => {
    const svc = new ZoomService(() => null, { oauthBase: base, apiBase: `${base}/v2` });
    const res = await svc.testAuth();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });
});

describe('ZoomService meetings + recordings', () => {
  it('PATCHes auto_recording=cloud onto an existing meeting', async () => {
    await makeService().ensureCloudRecording('123');
    expect(lastPatchBody).toEqual({ settings: { auto_recording: 'cloud' } });
  });

  it('creates an instant meeting with cloud auto-recording', async () => {
    const m = await makeService().createMeeting('Standup');
    expect(m.id).toBe('9876543210');
    expect(m.joinUrl).toContain('zoom.us/j/');
  });

  it('treats recordings 404 as not-ready (meeting not ended/processed)', async () => {
    recordingsResponse = { status: 404, body: { code: 3301 } };
    const rec = await makeService().getRecordings('123');
    expect(rec.ready).toBe(false);
    expect(rec.files).toEqual([]);
  });

  it('maps the recordings payload to typed files + share url', async () => {
    recordingsResponse = {
      status: 200,
      body: {
        share_url: 'https://zoom.us/rec/share/abc',
        recording_files: [
          { file_type: 'MP4', download_url: `${base}/files/video.mp4` },
          { file_type: 'TRANSCRIPT', download_url: `${base}/files/transcript.vtt` },
          { file_type: '', download_url: '' }, // junk dropped
        ],
      },
    };
    const rec = await makeService().getRecordings('123');
    expect(rec.ready).toBe(true);
    expect(rec.shareUrl).toBe('https://zoom.us/rec/share/abc');
    expect(rec.files).toEqual([
      { fileType: 'MP4', downloadUrl: `${base}/files/video.mp4` },
      { fileType: 'TRANSCRIPT', downloadUrl: `${base}/files/transcript.vtt` },
    ]);
  });
});

describe('ZoomService downloads', () => {
  it('streams a binary file to disk with bearer auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoom-test-'));
    const dest = join(dir, 'nested', 'video.mp4');
    await makeService().download(`${base}/files/video.mp4`, dest);
    expect(readFileSync(dest).toString()).toBe('FAKE-MP4-BYTES');
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloads a transcript as text', async () => {
    const text = await makeService().downloadText(`${base}/files/transcript.vtt`);
    expect(text).toContain('WEBVTT');
    expect(text).toContain('hello world');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/services/zoom-service.test.ts`
Expected: FAIL — `Cannot find module '@main/services/zoom-service'`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/services/zoom-service.ts
//
// Zoom REST client for the meeting-recorder pipeline (spec:
// docs/superpowers/specs/2026-06-10-zoom-meeting-recorder-design.md).
//
// Auth is Server-to-Server OAuth: POST /oauth/token with HTTP Basic
// clientId:clientSecret and grant_type=account_credentials. The access token
// (1h) is cached and refreshed 5 minutes early. Credentials are injected via
// a getter (same pattern as OpenClawClient.getToken) so the store can rotate
// them without rebuilding the service. fetch + base URLs are injectable so the
// whole client is testable against a local node:http fake.

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ZoomCreds {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomServiceOpts {
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** OAuth host, default https://zoom.us */
  oauthBase?: string;
  /** API base, default https://api.zoom.us/v2 */
  apiBase?: string;
  /** Clock, injectable for token-expiry tests. */
  now?: () => number;
}

export interface ZoomRecordingFile {
  fileType: string; // 'MP4' | 'M4A' | 'TRANSCRIPT' | ...
  downloadUrl: string;
}

export interface ZoomRecordings {
  ready: boolean;
  shareUrl?: string;
  files: ZoomRecordingFile[];
}

export interface CreatedMeeting {
  id: string;
  joinUrl: string;
}

export class ZoomService {
  private readonly fetchImpl: typeof fetch;
  private readonly oauthBase: string;
  private readonly apiBase: string;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly getCreds: () => ZoomCreds | null,
    opts: ZoomServiceOpts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.oauthBase = opts.oauthBase ?? 'https://zoom.us';
    this.apiBase = opts.apiBase ?? 'https://api.zoom.us/v2';
    this.now = opts.now ?? Date.now;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    const creds = this.getCreds();
    if (!creds) throw new Error('Zoom credentials not configured');
    const url =
      `${this.oauthBase}/oauth/token?grant_type=account_credentials` +
      `&account_id=${encodeURIComponent(creds.accountId)}`;
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new Error(`Zoom token request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh 5 minutes before Zoom expires the token.
    this.token = {
      value: body.access_token,
      expiresAt: this.now() + Math.max(body.expires_in - 300, 60) * 1000,
    };
    return this.token.value;
  }

  /** Token-fetch ping with fresh (uncached) credentials. */
  async testAuth(): Promise<{ ok: boolean; error?: string }> {
    this.token = null;
    try {
      await this.getToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return this.fetchImpl(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  /** Turn on cloud auto-recording for an existing meeting. */
  async ensureCloudRecording(meetingId: string): Promise<void> {
    const res = await this.api(`/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ settings: { auto_recording: 'cloud' } }),
    });
    if (!res.ok) throw new Error(`Failed to enable cloud recording: HTTP ${res.status}`);
  }

  /** Create an instant meeting that records to cloud from the start. */
  async createMeeting(topic: string): Promise<CreatedMeeting> {
    const res = await this.api('/users/me/meetings', {
      method: 'POST',
      body: JSON.stringify({ topic, type: 1, settings: { auto_recording: 'cloud' } }),
    });
    if (!res.ok) throw new Error(`Failed to create meeting: HTTP ${res.status}`);
    const body = (await res.json()) as { id: number | string; join_url: string };
    return { id: String(body.id), joinUrl: body.join_url };
  }

  /** Recording files for a meeting. 404 = not ended/processed yet (not an error). */
  async getRecordings(meetingId: string): Promise<ZoomRecordings> {
    const res = await this.api(`/meetings/${encodeURIComponent(meetingId)}/recordings`);
    if (res.status === 404) return { ready: false, files: [] };
    if (!res.ok) throw new Error(`Failed to fetch recordings: HTTP ${res.status}`);
    const body = (await res.json()) as {
      share_url?: string;
      recording_files?: Array<{ file_type?: string; download_url?: string }>;
    };
    const files = (body.recording_files ?? [])
      .filter((f) => !!f.file_type && !!f.download_url)
      .map((f) => ({ fileType: f.file_type as string, downloadUrl: f.download_url as string }));
    return {
      ready: files.length > 0,
      files,
      ...(body.share_url ? { shareUrl: body.share_url } : {}),
    };
  }

  /** Stream a recording file to disk (bearer-authorized). Creates parent dirs. */
  async download(url: string, destPath: string): Promise<void> {
    const token = await this.getToken();
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    await mkdir(dirname(destPath), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destPath));
  }

  /** Download a small text file (VTT transcript) as a string. */
  async downloadText(url: string): Promise<string> {
    const token = await this.getToken();
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Transcript download failed: HTTP ${res.status}`);
    return res.text();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/services/zoom-service.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

```bash
git add src/main/services/zoom-service.ts tests/main/services/zoom-service.test.ts
git commit -m "feat(zoom): ZoomService — S2S OAuth + meetings/recordings REST client"
```

---

### Task 2: ZoomCredsStore (encrypted creds in settings KV)

**Files:**
- Create: `src/main/services/zoom-creds.ts`
- Test: `tests/main/services/zoom-creds.test.ts`

- [ ] **Step 1: Write the failing test** (fake KV + fake SecretBackend, same style as `tests/main/services/flowclaw-store.test.ts`)

```ts
// tests/main/services/zoom-creds.test.ts
import { describe, it, expect } from 'vitest';
import { SecretStore, type SecretBackend } from '@main/services/secret-store';
import { ZoomCredsStore, ZOOM_CREDS_KEY } from '@main/services/zoom-creds';

/** Reversible fake "encryption" so tests can assert ciphertext at rest. */
function fakeBackend(): SecretBackend {
  return {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from([...plain].reverse().join('')),
    decrypt: (buf) => [...buf.toString()].reverse().join(''),
  };
}

function fakeKV(): { get(k: string): string | null; set(k: string, v: string): void; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return { get: (k) => raw.get(k) ?? null, set: (k, v) => void raw.set(k, v), raw };
}

describe('ZoomCredsStore', () => {
  it('round-trips creds, encrypting the client secret at rest', () => {
    const kv = fakeKV();
    const store = new ZoomCredsStore(kv, new SecretStore(fakeBackend()));
    store.save({ accountId: 'acc1', clientId: 'cid', clientSecret: 'topsecret' });

    // At rest: secret is ciphertext, not plaintext.
    const persisted = kv.raw.get(ZOOM_CREDS_KEY) ?? '';
    expect(persisted).not.toContain('topsecret');
    expect(persisted).toContain('enc:v1:');

    // Loaded: decrypted.
    expect(store.load()).toEqual({ accountId: 'acc1', clientId: 'cid', clientSecret: 'topsecret' });
  });

  it('returns null when nothing is stored or the blob is junk', () => {
    const kv = fakeKV();
    const store = new ZoomCredsStore(kv, new SecretStore(fakeBackend()));
    expect(store.load()).toBeNull();
    kv.set(ZOOM_CREDS_KEY, 'not json');
    expect(store.load()).toBeNull();
    kv.set(ZOOM_CREDS_KEY, JSON.stringify({ accountId: 'a' })); // missing fields
    expect(store.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/services/zoom-creds.test.ts`
Expected: FAIL — `Cannot find module '@main/services/zoom-creds'`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/services/zoom-creds.ts
//
// Zoom Server-to-Server OAuth credentials, persisted in the settings KV with
// the client secret encrypted via SecretStore (identical treatment to flowclaw
// connection tokens): write-only across IPC, decrypted only in main.

import type { SecretStore } from './secret-store';
import type { SettingsKV } from './flowclaw-store';
import type { ZoomCreds } from './zoom-service';

export const ZOOM_CREDS_KEY = 'zoom_credentials';

export class ZoomCredsStore {
  constructor(
    private readonly settings: SettingsKV,
    private readonly secrets: SecretStore,
  ) {}

  save(creds: ZoomCreds): void {
    this.settings.set(
      ZOOM_CREDS_KEY,
      JSON.stringify({
        accountId: creds.accountId,
        clientId: creds.clientId,
        clientSecret: this.secrets.encryptValue(creds.clientSecret),
      }),
    );
  }

  load(): ZoomCreds | null {
    const raw = this.settings.get(ZOOM_CREDS_KEY);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      const accountId = typeof p['accountId'] === 'string' ? p['accountId'] : '';
      const clientId = typeof p['clientId'] === 'string' ? p['clientId'] : '';
      const secret = typeof p['clientSecret'] === 'string' ? p['clientSecret'] : '';
      if (!accountId || !clientId || !secret) return null;
      return { accountId, clientId, clientSecret: this.secrets.decryptValue(secret) };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/services/zoom-creds.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/zoom-creds.ts tests/main/services/zoom-creds.test.ts
git commit -m "feat(zoom): encrypted Zoom S2S credential store over settings KV"
```

---

### Task 3: ZoomRecorder (job store + poll lifecycle)

**Files:**
- Create: `src/main/services/zoom-recorder.ts`
- Test: `tests/main/services/zoom-recorder.test.ts`

- [ ] **Step 1: Write the failing test** (all deps faked; jobs file in a temp dir)

```ts
// tests/main/services/zoom-recorder.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ZoomRecorder,
  buildSummaryPrompt,
  finalMessage,
  type ZoomServiceLike,
  type ZoomJob,
} from '@main/services/zoom-recorder';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zoom-rec-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface FakeZoomOpts {
  ready?: boolean;
  withTranscript?: boolean;
  failDownloads?: boolean;
  failArm?: boolean;
}

function fakeZoom(opts: FakeZoomOpts = {}): ZoomServiceLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ensureCloudRecording(meetingId) {
      calls.push(`arm:${meetingId}`);
      if (opts.failArm) throw new Error('HTTP 401');
    },
    async createMeeting(topic) {
      calls.push(`create:${topic}`);
      return { id: 'm-new', joinUrl: 'https://zoom.us/j/m-new' };
    },
    async getRecordings(meetingId) {
      calls.push(`recordings:${meetingId}`);
      if (!opts.ready) return { ready: false, files: [] };
      return {
        ready: true,
        shareUrl: 'https://zoom.us/rec/share/xyz',
        files: [
          { fileType: 'MP4', downloadUrl: 'https://dl/video.mp4' },
          { fileType: 'M4A', downloadUrl: 'https://dl/audio.m4a' },
          ...(opts.withTranscript
            ? [{ fileType: 'TRANSCRIPT', downloadUrl: 'https://dl/t.vtt' }]
            : []),
        ],
      };
    },
    async download(url, dest) {
      calls.push(`download:${url}->${dest}`);
      if (opts.failDownloads) throw new Error('download boom');
    },
    async downloadText(url) {
      calls.push(`text:${url}`);
      if (opts.failDownloads) throw new Error('text boom');
      return 'WEBVTT\n\nalice: ship it\nbob: agreed';
    },
  };
}

function fakeDispatcher(result = 'SUMMARY: shipped it'): {
  runToText(id: string, prompt: string, opts?: { model?: string }): Promise<string>;
  seen: Array<{ id: string; prompt: string; model?: string }>;
} {
  const seen: Array<{ id: string; prompt: string; model?: string }> = [];
  return {
    seen,
    async runToText(id, prompt, opts) {
      seen.push({ id, prompt, ...(opts?.model ? { model: opts.model } : {}) });
      if (result === 'THROW') throw new Error('gateway down');
      return result;
    },
  };
}

function fakeChats(): {
  createChat(agentId: string, title?: string): { id: string };
  appendMessage(chatId: string, msg: { role: 'user' | 'assistant'; content: string }): unknown;
  chats: Array<{ id: string; agentId: string; title?: string }>;
  messages: Array<{ chatId: string; role: string; content: string }>;
} {
  const chats: Array<{ id: string; agentId: string; title?: string }> = [];
  const messages: Array<{ chatId: string; role: string; content: string }> = [];
  return {
    chats,
    messages,
    createChat(agentId, title) {
      const id = `chat-${chats.length + 1}`;
      chats.push({ id, agentId, ...(title !== undefined ? { title } : {}) });
      return { id };
    },
    appendMessage(chatId, msg) {
      messages.push({ chatId, ...msg });
      return {};
    },
  };
}

function makeRecorder(zoom: ZoomServiceLike, dispatcher: ReturnType<typeof fakeDispatcher>, chats = fakeChats()) {
  const recorder = new ZoomRecorder({
    zoom,
    dispatcher,
    chats,
    jobsPath: join(dir, 'zoom-jobs.json'),
    recordingsDir: join(dir, 'recordings'),
  });
  return { recorder, chats };
}

describe('ZoomRecorder.record', () => {
  it('arms an existing meeting for cloud recording -> waiting', async () => {
    const zoom = fakeZoom();
    const { recorder } = makeRecorder(zoom, fakeDispatcher());
    const job = await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    expect(zoom.calls).toContain('arm:123');
    expect(job.status).toBe('waiting');
  });

  it('creates a fresh recorded meeting when only a topic is given', async () => {
    const zoom = fakeZoom();
    const { recorder } = makeRecorder(zoom, fakeDispatcher());
    const job = await recorder.record({ topic: 'Standup', agentId: 'a1', connectionId: 'h1' });
    expect(job.meetingId).toBe('m-new');
    expect(job.joinUrl).toBe('https://zoom.us/j/m-new');
    expect(job.status).toBe('waiting');
  });

  it('lands in error when arming fails', async () => {
    const { recorder } = makeRecorder(fakeZoom({ failArm: true }), fakeDispatcher());
    const job = await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/401/);
  });

  it('persists jobs across recorder instances', async () => {
    const { recorder } = makeRecorder(fakeZoom(), fakeDispatcher());
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    const again = new ZoomRecorder({
      zoom: fakeZoom(),
      dispatcher: fakeDispatcher(),
      chats: fakeChats(),
      jobsPath: join(dir, 'zoom-jobs.json'),
      recordingsDir: join(dir, 'recordings'),
    });
    expect(again.list()).toHaveLength(1);
    expect(again.list()[0]?.meetingId).toBe('123');
  });
});

describe('ZoomRecorder.tick', () => {
  it('keeps waiting while the recording is not ready', async () => {
    const { recorder } = makeRecorder(fakeZoom({ ready: false }), fakeDispatcher());
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    expect(recorder.list()[0]?.status).toBe('waiting');
  });

  it('full pipeline: download recording + transcript, summarize via dispatcher, chat persisted', async () => {
    const zoom = fakeZoom({ ready: true, withTranscript: true });
    const dispatcher = fakeDispatcher();
    const { recorder, chats } = makeRecorder(zoom, dispatcher);
    await recorder.record({ meetingId: '123', topic: 'Sprint review', agentId: 'a1', connectionId: 'h1', model: 'qwen2.5' });
    await recorder.tick();

    const job = recorder.list()[0] as ZoomJob;
    expect(job.status).toBe('done');
    // Full recording downloaded locally (MP4 + M4A + transcript file).
    expect(job.recordingFiles).toHaveLength(3);
    expect(job.shareUrl).toBe('https://zoom.us/rec/share/xyz');
    // Transcript fed to the gateway with the model override.
    expect(dispatcher.seen[0]?.id).toBe('h1');
    expect(dispatcher.seen[0]?.model).toBe('qwen2.5');
    expect(dispatcher.seen[0]?.prompt).toContain('alice: ship it');
    // Chat: prompt + final message with summary, local paths, share link.
    expect(job.chatId).toBe('chat-1');
    expect(chats.chats[0]?.agentId).toBe('a1');
    expect(chats.messages).toHaveLength(2);
    expect(chats.messages[1]?.content).toContain('SUMMARY: shipped it');
    expect(chats.messages[1]?.content).toContain('recording.mp4');
    expect(chats.messages[1]?.content).toContain('https://zoom.us/rec/share/xyz');
  });

  it('falls back to a metadata-only prompt when there is no transcript', async () => {
    const dispatcher = fakeDispatcher();
    const { recorder } = makeRecorder(fakeZoom({ ready: true, withTranscript: false }), dispatcher);
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    expect(recorder.list()[0]?.status).toBe('done');
    expect(dispatcher.seen[0]?.prompt).toMatch(/no transcript was available/i);
  });

  it('download failures are non-fatal: summary still runs, chat notes cloud-only', async () => {
    const { recorder, chats } = makeRecorder(
      fakeZoom({ ready: true, withTranscript: true, failDownloads: true }),
      fakeDispatcher(),
    );
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    const job = recorder.list()[0] as ZoomJob;
    expect(job.status).toBe('done');
    expect(job.recordingFiles).toBeUndefined();
    expect(chats.messages[1]?.content).toMatch(/local download unavailable/i);
  });

  it('gateway failure lands the job in error with a message', async () => {
    const { recorder } = makeRecorder(fakeZoom({ ready: true, withTranscript: true }), fakeDispatcher('THROW'));
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    const job = recorder.list()[0] as ZoomJob;
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/gateway down/);
  });

  it('writes the transcript text to a local .vtt file', async () => {
    const { recorder } = makeRecorder(fakeZoom({ ready: true, withTranscript: true }), fakeDispatcher());
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    const vtt = join(dir, 'recordings', '123', 'transcript.vtt');
    expect(existsSync(vtt)).toBe(true);
    expect(readFileSync(vtt, 'utf8')).toContain('alice: ship it');
  });
});

describe('prompt + final message builders', () => {
  const job = {
    id: 'j1', meetingId: '123', topic: 'Demo', agentId: 'a1', connectionId: 'h1',
    status: 'summarizing', createdAt: 0, updatedAt: 0,
  } as ZoomJob;

  it('transcript prompt asks for notes, decisions, action items', () => {
    const p = buildSummaryPrompt(job, 'WEBVTT\nhello');
    expect(p).toContain('Demo');
    expect(p).toMatch(/action items/i);
    expect(p).toContain('WEBVTT');
  });

  it('final message includes local paths and the share link', () => {
    const msg = finalMessage(
      { ...job, recordingFiles: ['C:\\rec\\video.mp4'], shareUrl: 'https://zoom.us/rec/s' },
      'the summary',
    );
    expect(msg).toContain('the summary');
    expect(msg).toContain('C:\\rec\\video.mp4');
    expect(msg).toContain('https://zoom.us/rec/s');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/services/zoom-recorder.test.ts`
Expected: FAIL — `Cannot find module '@main/services/zoom-recorder'`

- [ ] **Step 3: Write the implementation**

```ts
// src/main/services/zoom-recorder.ts
//
// Meeting-recorder job store + poller (spec §2). A job arms a Zoom meeting for
// cloud recording, waits for Zoom to finish processing, downloads the full
// recording + transcript into recordingsDir, then dispatches the transcript to
// a flowclaw gateway connection for a summary and persists the result as a
// chat. All dependencies are injected so the lifecycle is testable without
// Electron, the DB, or the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ZoomJobStatus = 'armed' | 'waiting' | 'downloading' | 'summarizing' | 'done' | 'error';

export interface ZoomJob {
  id: string;
  meetingId: string;
  topic: string;
  agentId: string; // chat rows require an agent
  connectionId: string; // flowclaw connection that writes the summary
  model?: string;
  status: ZoomJobStatus;
  chatId?: string;
  recordingFiles?: string[]; // local absolute paths after download
  shareUrl?: string;
  joinUrl?: string; // set when the job created the meeting
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** The slice of ZoomService the recorder needs (kept narrow for fakes). */
export interface ZoomServiceLike {
  ensureCloudRecording(meetingId: string): Promise<void>;
  createMeeting(topic: string): Promise<{ id: string; joinUrl: string }>;
  getRecordings(meetingId: string): Promise<{
    ready: boolean;
    shareUrl?: string;
    files: Array<{ fileType: string; downloadUrl: string }>;
  }>;
  download(url: string, destPath: string): Promise<void>;
  downloadText(url: string): Promise<string>;
}

/** The slice of FlowclawConnections the recorder needs. */
export interface RunDispatcher {
  runToText(id: string, prompt: string, opts?: { model?: string }): Promise<string>;
}

/** The slice of ChatRepository the recorder needs. */
export interface ChatSink {
  createChat(agentId: string, title?: string): { id: string };
  appendMessage(chatId: string, msg: { role: 'user' | 'assistant'; content: string }): unknown;
}

export interface RecordInput {
  meetingId?: string;
  topic?: string;
  agentId: string;
  connectionId: string;
  model?: string;
}

export interface ZoomRecorderDeps {
  zoom: ZoomServiceLike;
  dispatcher: RunDispatcher;
  chats: ChatSink;
  jobsPath: string; // e.g. userData/zoom-jobs.json
  recordingsDir: string; // e.g. userData/zoom-recordings
  now?: () => number;
}

export class ZoomRecorder {
  private jobs: ZoomJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ZoomRecorderDeps) {
    this.load();
  }

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private load(): void {
    try {
      if (!existsSync(this.deps.jobsPath)) return;
      const parsed = JSON.parse(readFileSync(this.deps.jobsPath, 'utf8'));
      if (Array.isArray(parsed)) this.jobs = parsed as ZoomJob[];
    } catch {
      this.jobs = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.deps.jobsPath), { recursive: true });
      writeFileSync(this.deps.jobsPath, JSON.stringify(this.jobs), 'utf8');
    } catch {
      // best-effort, same as RoutineStore
    }
  }

  list(): ZoomJob[] {
    return this.jobs.slice();
  }

  private setStatus(job: ZoomJob, status: ZoomJobStatus): void {
    job.status = status;
    job.updatedAt = this.nowMs();
    this.persist();
  }

  /** Arm a meeting for cloud recording (or create a fresh recorded meeting). */
  async record(input: RecordInput): Promise<ZoomJob> {
    const now = this.nowMs();
    const job: ZoomJob = {
      id: randomUUID(),
      meetingId: input.meetingId ?? '',
      topic: input.topic ?? 'Zoom meeting',
      agentId: input.agentId,
      connectionId: input.connectionId,
      ...(input.model ? { model: input.model } : {}),
      status: 'armed',
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.push(job);
    this.persist();
    try {
      if (input.meetingId) {
        await this.deps.zoom.ensureCloudRecording(input.meetingId);
      } else if (input.topic) {
        const m = await this.deps.zoom.createMeeting(input.topic);
        job.meetingId = m.id;
        job.joinUrl = m.joinUrl;
      } else {
        throw new Error('Either meetingId or topic is required');
      }
      this.setStatus(job, 'waiting');
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      this.setStatus(job, 'error');
    }
    return job;
  }

  /** One poll cycle: advance every waiting job whose recording became ready. */
  async tick(): Promise<void> {
    for (const job of this.jobs.filter((j) => j.status === 'waiting')) {
      try {
        const rec = await this.deps.zoom.getRecordings(job.meetingId);
        if (!rec.ready) continue;
        if (rec.shareUrl) job.shareUrl = rec.shareUrl;

        this.setStatus(job, 'downloading');
        const transcript = await this.collectFiles(job, rec.files);

        this.setStatus(job, 'summarizing');
        const prompt = buildSummaryPrompt(job, transcript);
        const summary = await this.deps.dispatcher.runToText(job.connectionId, prompt, {
          ...(job.model ? { model: job.model } : {}),
        });

        const chat = this.deps.chats.createChat(job.agentId, `Zoom · ${job.topic}`);
        this.deps.chats.appendMessage(chat.id, { role: 'user', content: prompt });
        this.deps.chats.appendMessage(chat.id, {
          role: 'assistant',
          content: finalMessage(job, summary),
        });
        job.chatId = chat.id;
        this.setStatus(job, 'done');
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        this.setStatus(job, 'error');
      }
    }
  }

  /** Download MP4/M4A + transcript locally. Returns transcript text when
   *  available. Download failures are non-fatal — cloud links remain. */
  private async collectFiles(
    job: ZoomJob,
    files: Array<{ fileType: string; downloadUrl: string }>,
  ): Promise<string | null> {
    const local: string[] = [];
    let transcript: string | null = null;
    const dir = join(this.deps.recordingsDir, job.meetingId);
    for (const f of files) {
      const type = f.fileType.toUpperCase();
      try {
        if (type === 'TRANSCRIPT' || type === 'VTT') {
          transcript = await this.deps.zoom.downloadText(f.downloadUrl);
          const dest = join(dir, 'transcript.vtt');
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, transcript, 'utf8');
          local.push(dest);
        } else if (type === 'MP4' || type === 'M4A') {
          const dest = join(dir, `recording.${type.toLowerCase()}`);
          await this.deps.zoom.download(f.downloadUrl, dest);
          local.push(dest);
        }
      } catch {
        // non-fatal: this file stays cloud-only
      }
    }
    if (local.length > 0) job.recordingFiles = local;
    return transcript;
  }

  /** Start the poller. Runs only the cheap filter when no jobs are active. */
  start(intervalMs = 60_000): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function buildSummaryPrompt(job: ZoomJob, transcript: string | null): string {
  const head = `You are reviewing the Zoom meeting "${job.topic}" (meeting ID ${job.meetingId}).`;
  if (transcript) {
    return (
      `${head}\nBelow is the meeting transcript (VTT). Write meeting notes: a concise ` +
      `summary, key decisions, and action items with owners.\n\n${transcript}`
    );
  }
  return (
    `${head}\nNo transcript was available for this recording (enable "Audio transcript" ` +
    `in Zoom recording settings to get one next time). Write a short note that the ` +
    `meeting was recorded and point the reader to the recording files listed after ` +
    `your note.`
  );
}

export function finalMessage(job: ZoomJob, summary: string): string {
  const lines = [summary.trim(), '', '---'];
  if (job.recordingFiles && job.recordingFiles.length > 0) {
    lines.push('Full recording (local):', ...job.recordingFiles.map((p) => `- ${p}`));
  } else {
    lines.push('Local download unavailable — use the cloud link below.');
  }
  if (job.shareUrl) lines.push(`Zoom share link: ${job.shareUrl}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/services/zoom-recorder.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

```bash
git add src/main/services/zoom-recorder.ts tests/main/services/zoom-recorder.test.ts
git commit -m "feat(zoom): meeting-recorder job store + poll lifecycle (arm/wait/download/summarize)"
```

---

### Task 4: IPC channels, schemas, DTOs

**Files:**
- Modify: `src/shared/ipc-channels.ts`

- [ ] **Step 1: Add channels** — inside `export const CHANNELS = {` after the `FLOWCLAW_*` entries (`src/shared/ipc-channels.ts:45`):

```ts
  ZOOM_SAVE_CREDS: 'zoom:save-creds',
  ZOOM_TEST: 'zoom:test',
  ZOOM_RECORD: 'zoom:record',
  ZOOM_JOBS: 'zoom:jobs',
  ZOOM_OPEN_RECORDING: 'zoom:open-recording',
```

- [ ] **Step 2: Add schemas** — inside `export const schemas = {` after the flowclaw schemas:

```ts
  zoomSaveCredsRequest: z.object({
    accountId: z.string().trim().min(1).max(120),
    clientId: z.string().trim().min(1).max(120),
    clientSecret: z.string().trim().min(1).max(300),
  }),
  zoomTestRequest: z.object({}),
  zoomRecordRequest: z
    .object({
      meetingId: z.string().trim().min(1).max(40).optional(),
      topic: z.string().trim().min(1).max(200).optional(),
      agentId: z.string().min(1),
      connectionId: z.string().min(1),
      model: z.string().trim().max(120).optional(),
    })
    .refine((v) => !!v.meetingId || !!v.topic, {
      message: 'meetingId or topic is required',
    }),
  zoomJobsRequest: z.object({}),
  zoomOpenRecordingRequest: z.object({ path: z.string().min(1).max(500) }),
```

- [ ] **Step 3: Add DTO types** — next to the Flowclaw DTO exports near the bottom of the file:

```ts
export type ZoomJobStatusDto =
  | 'armed'
  | 'waiting'
  | 'downloading'
  | 'summarizing'
  | 'done'
  | 'error';

export interface ZoomJobDto {
  id: string;
  meetingId: string;
  topic: string;
  agentId: string;
  connectionId: string;
  model?: string;
  status: ZoomJobStatusDto;
  chatId?: string;
  recordingFiles?: string[];
  shareUrl?: string;
  joinUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type ZoomRecordRequest = z.infer<typeof schemas.zoomRecordRequest>;
export interface ZoomRecordResponse {
  jobId: string;
  joinUrl?: string;
  error?: string;
}
export interface ZoomJobsResponse {
  jobs: ZoomJobDto[];
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json; npx tsc --noEmit -p tsconfig.web.json`
Expected: both exit 0

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-channels.ts
git commit -m "feat(zoom): IPC channels + zod schemas + DTOs for meeting recorder"
```

---

### Task 5: IPC handler + registration

**Files:**
- Create: `src/main/ipc/handlers/zoom.ts`
- Modify: `src/main/ipc/register.ts`

- [ ] **Step 1: Write the handler**

```ts
// src/main/ipc/handlers/zoom.ts
//
// IPC glue for the Zoom meeting-recorder pipeline. Thin over the tested
// services: ZoomCredsStore (encrypted creds), ZoomService (REST), ZoomRecorder
// (job lifecycle + poller), FlowclawConnections (summary dispatch). Creds are
// write-only across IPC; recording paths opened via shell are validated to be
// inside the recordings dir.

import { app, ipcMain, shell } from 'electron';
import { join, resolve } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import type { ChatRepository } from '@main/repos/chat-repository';
import { SecretStore, electronSafeStorageBackend } from '@main/services/secret-store';
import { SettingsConnectionStore } from '@main/services/flowclaw-store';
import { FlowclawConnections } from '@main/agent/flowclaw-connections';
import { ZoomService } from '@main/services/zoom-service';
import { ZoomCredsStore } from '@main/services/zoom-creds';
import { ZoomRecorder } from '@main/services/zoom-recorder';

export function registerZoomHandlers(deps: {
  settings: SettingsService;
  repo: ChatRepository;
}): void {
  const secrets = new SecretStore(electronSafeStorageBackend());
  const creds = new ZoomCredsStore(deps.settings, secrets);
  const zoom = new ZoomService(() => creds.load());
  const flowclaw = new FlowclawConnections(new SettingsConnectionStore(deps.settings, secrets));

  const recordingsDir = join(app.getPath('userData'), 'zoom-recordings');
  const recorder = new ZoomRecorder({
    zoom,
    dispatcher: flowclaw,
    chats: deps.repo,
    jobsPath: join(app.getPath('userData'), 'zoom-jobs.json'),
    recordingsDir,
  });
  recorder.start();

  ipcMain.handle(CHANNELS.ZOOM_SAVE_CREDS, (_e, raw) => {
    const args = schemas.zoomSaveCredsRequest.parse(raw);
    creds.save(args);
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.ZOOM_TEST, () => zoom.testAuth());

  ipcMain.handle(CHANNELS.ZOOM_RECORD, async (_e, raw) => {
    const args = schemas.zoomRecordRequest.parse(raw);
    const job = await recorder.record({
      ...(args.meetingId ? { meetingId: args.meetingId } : {}),
      ...(args.topic ? { topic: args.topic } : {}),
      agentId: args.agentId,
      connectionId: args.connectionId,
      ...(args.model ? { model: args.model } : {}),
    });
    return {
      jobId: job.id,
      ...(job.joinUrl ? { joinUrl: job.joinUrl } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  });

  ipcMain.handle(CHANNELS.ZOOM_JOBS, () => ({ jobs: recorder.list() }));

  ipcMain.handle(CHANNELS.ZOOM_OPEN_RECORDING, async (_e, raw) => {
    const { path } = schemas.zoomOpenRecordingRequest.parse(raw);
    // Only files inside the recordings dir may be shell-opened.
    const abs = resolve(path);
    if (!abs.startsWith(resolve(recordingsDir))) return { ok: false as const };
    const errMsg = await shell.openPath(abs);
    return { ok: errMsg.length === 0 };
  });
}
```

- [ ] **Step 2: Register it** — in `src/main/ipc/register.ts`, add the import next to `registerFlowclawHandlers`:

```ts
import { registerZoomHandlers } from './handlers/zoom';
```

and the call right after `registerFlowclawHandlers(...)` (`src/main/ipc/register.ts:73`):

```ts
  registerZoomHandlers({ settings: deps.settings, repo: deps.repo });
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0. (`ChatRepository.createChat(agentId, title?)` returns a `ChatRow` with `id`, and `appendMessage(chatId, {role, content})` matches `ChatSink` structurally — verified at `src/main/repos/chat-repository.ts:193` and `:279`.)

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/handlers/zoom.ts src/main/ipc/register.ts
git commit -m "feat(zoom): IPC handlers — save-creds/test/record/jobs/open-recording"
```

---

### Task 6: Preload + renderer API surface

**Files:**
- Modify: `src/preload/index.ts` (after the `routines:` block, `src/preload/index.ts:386`)
- Modify: `src/renderer/src/lib/ipc.ts` (after the `routines:` block in `FlowstateApi`)

- [ ] **Step 1: Preload block** — add inside the `api` object:

```ts
  zoom: {
    saveCreds: (creds: { accountId: string; clientId: string; clientSecret: string }) =>
      ipcRenderer.invoke(CHANNELS.ZOOM_SAVE_CREDS, creds),
    test: () => ipcRenderer.invoke(CHANNELS.ZOOM_TEST, {}),
    record: (req: {
      meetingId?: string;
      topic?: string;
      agentId: string;
      connectionId: string;
      model?: string;
    }) => ipcRenderer.invoke(CHANNELS.ZOOM_RECORD, req),
    jobs: () => ipcRenderer.invoke(CHANNELS.ZOOM_JOBS, {}),
    openRecording: (path: string) => ipcRenderer.invoke(CHANNELS.ZOOM_OPEN_RECORDING, { path }),
  },
```

- [ ] **Step 2: Renderer types** — add to the `FlowstateApi` interface in `src/renderer/src/lib/ipc.ts`:

```ts
  zoom: {
    saveCreds: (creds: {
      accountId: string;
      clientId: string;
      clientSecret: string;
    }) => Promise<{ ok: boolean }>;
    test: () => Promise<{ ok: boolean; error?: string }>;
    record: (req: {
      meetingId?: string;
      topic?: string;
      agentId: string;
      connectionId: string;
      model?: string;
    }) => Promise<import('@shared/ipc-channels').ZoomRecordResponse>;
    jobs: () => Promise<import('@shared/ipc-channels').ZoomJobsResponse>;
    openRecording: (path: string) => Promise<{ ok: boolean }>;
  };
```

- [ ] **Step 3: Typecheck both configs**

Run: `npx tsc --noEmit -p tsconfig.node.json; npx tsc --noEmit -p tsconfig.web.json`
Expected: both exit 0

- [ ] **Step 4: Run the full flowclaw + zoom test set**

Run: `npx vitest run tests/main/services tests/main/agent`
Expected: all green (zoom-service 10, zoom-creds 2, zoom-recorder 12, plus existing 26+ flowclaw/agent tests)

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/renderer/src/lib/ipc.ts
git commit -m "feat(zoom): expose zoom.* IPC surface to the renderer"
```

---

### Task 7: UI design-prompt addendum

**Files:**
- Modify: `docs/flowclaw-ui-design-prompt.md` (append a section)

- [ ] **Step 1: Append the Meetings card contract** to the end of `docs/flowclaw-ui-design-prompt.md`:

```markdown
## Addendum: Meetings card (Zoom recorder)

Add a "Meetings" card to the Flowclaw screen. It uses `window.flowstate.zoom.*`:

- `zoom.saveCreds({accountId, clientId, clientSecret})` → `{ok}` — three password
  fields (Server-to-Server OAuth app from Zoom Marketplace). Write-only: never
  display stored values; show "credentials saved" state instead.
- `zoom.test()` → `{ok, error?}` — "Test" button next to the creds form.
- `zoom.record({meetingId? | topic?, agentId, connectionId, model?})` →
  `{jobId, joinUrl?, error?}` — form: meeting ID input OR new-meeting topic
  input (tabs/toggle), agent picker, flowclaw connection picker
  (`flowclaw.list()`), optional model. When `joinUrl` returns, show it as a
  copyable link.
- `zoom.jobs()` → `{jobs: ZoomJobDto[]}` — job list, poll every ~10s while
  visible. Status chip per job: armed/waiting/downloading/summarizing/done/error
  (use --good for done, --bad for error, muted for in-flight). When done: button
  "Open recording" per local file via `zoom.openRecording(path)`, link to the
  summary chat via `chatId`, and the Zoom share link.

Same monochrome token rules as the rest of this prompt.
```

- [ ] **Step 2: Commit**

```bash
git add docs/flowclaw-ui-design-prompt.md
git commit -m "docs(flowclaw): add Meetings card contract to the Claude Design prompt"
```

---

## Self-review (done at plan-writing time)

- **Spec coverage:** ZoomService (Task 1) ✓, creds encryption (Task 2) ✓, job
  lifecycle incl. full-recording download + fallbacks (Task 3) ✓, IPC contract
  (Tasks 4–6) ✓, path-validation on shell-open (Task 5) ✓, UI addendum for
  Claude Design (Task 7) ✓. Webhook mode + agent-actions explicitly out of
  scope per spec.
- **Placeholders:** none — every step has complete code.
- **Type consistency:** `ZoomServiceLike`/`RunDispatcher`/`ChatSink` in Task 3
  match `ZoomService` (Task 1), `FlowclawConnections.runToText` (exists), and
  `ChatRepository.createChat/appendMessage` (verified line refs in Task 5).
  `ZoomJobDto` mirrors `ZoomJob` field-for-field.
```
