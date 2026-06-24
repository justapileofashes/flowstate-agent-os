# Webinar Capture — free-plan recording via system-audio loopback

**Date:** 2026-06-11
**Status:** Approved by user (record + transcribe locally + summarize via gateway)

## What this is

Recording webinars/meetings **without a paid Zoom plan** (and regardless of
platform — Zoom, Meet, Teams): Flowstate itself captures system audio while the
user attends, saves it locally, transcribes it with a local speech-to-text
backend, then dispatches the transcript to a flowclaw gateway connection
(OpenClaw/Hermes, local models supported) for meeting notes — the same
summarize-and-persist pipeline as the Zoom cloud recorder.

Rationale: Zoom's cloud recording API requires a paid plan; Zoom Webinars are a
paid add-on even to host, so the free-plan user is an attendee, and attendees
have no API recording path at all. System-audio capture is the only
plan-independent route.

**Consent:** recording calls may require participant consent depending on
jurisdiction and may conflict with the host's terms. The user is responsible
for obtaining consent where required. The UI addendum must include this notice.

Out of scope: video capture, speaker diarization, auto-joining meetings, the
UI screen itself (contract documented for Claude Design).

## Components

### 1. Loopback plumbing — `src/main/index.ts`

Electron 33: after the session is available, register

```ts
session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
  desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
    const first = sources[0];
    if (first) callback({ video: first, audio: 'loopback' });
    else callback({});
  });
}, { useSystemPicker: false });
```

This makes renderer `getDisplayMedia({ video: true, audio: true })` deliver
system loopback audio on Windows.

### 2. Capture helper — `src/renderer/src/lib/capture.ts` (no UI)

`startSystemAudioCapture(captureId): Promise<{ stop(): Promise<void> }>`:
`getDisplayMedia` → keep only audio tracks (stop video track immediately) →
`MediaRecorder` audio/webm;codecs=opus → `ondataavailable` every 5 s sends the
chunk to main via `ipc.capture.chunk(captureId, arrayBuffer)` → `stop()` flushes
the final chunk, stops tracks, then calls `ipc.capture.stop(captureId)`.
Typecheck-only (real display media needed at runtime); the future Flowclaw
screen calls this helper.

### 3. Transcriber — `src/main/services/transcriber.ts`

```ts
interface Transcriber {
  transcribe(filePath: string): Promise<string>;
  test(): Promise<{ ok: boolean; error?: string }>;
}
```

Two implementations:

- **OpenAICompatTranscriber** — POST multipart/form-data (`file`, `model`) to
  `<baseUrl>/v1/audio/transcriptions`, optional bearer key. Compatible with
  local GPU servers (speaches, faster-whisper-server) and any OpenAI-compatible
  speech backend. `test()` probes the baseUrl reachability (`GET /v1/models`,
  ok on any HTTP response; failure = network error only, since some servers
  404 that route).
- **CliTranscriber** — runs a user command template, `{file}` substituted with
  the audio path, captures stdout as the transcript. Escape hatch for
  whisper.cpp. `test()` runs the command with `{file}` replaced by an empty
  temp file and reports exit-code success.

Config persisted by **TranscriberStore** (same file): settings KV key
`capture_transcriber`, JSON `{mode:'openai'|'cli', url?, apiKey?, model?,
command?}` with `apiKey` encrypted via SecretStore (write-only across IPC).
A factory `buildTranscriber(store, fetchImpl?) → Transcriber | null` returns
null when unconfigured.

### 4. CaptureRecorder — `src/main/services/capture-recorder.ts`

Mirror of ZoomRecorder. Jobs persist to `userData/capture-jobs.json`; audio to
`userData/captures/<captureId>/audio.webm` (appended chunk-by-chunk with
`appendFileSync`).

```ts
interface CaptureJob {
  id: string;
  title: string;
  agentId: string;
  connectionId: string;
  model?: string;
  status: 'recording' | 'transcribing' | 'summarizing' | 'done' | 'error';
  audioPath: string;
  bytes: number;            // running size, for the UI
  chatId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}
```

- `start(input)` → creates the job (`recording`), creates the audio file.
- `appendChunk(id, buf)` → appends bytes, bumps `bytes` + `updatedAt`.
- `stop(id)` → async pipeline: `transcribing` (Transcriber.transcribe on the
  webm) → `summarizing` (`RunDispatcher.runToText(connectionId, prompt,
  {model})`) → chat via `ChatSink` (user msg = prompt, assistant msg = notes +
  local audio path) → `done`.
- **Transcription failure is non-fatal:** job still produces a chat containing
  the audio path + an explicit "transcription failed/unconfigured" note,
  status `done` (the recording itself succeeded). Gateway failure → `error`.
- Reuses `RunDispatcher` + `ChatSink` interfaces imported from
  `zoom-recorder.ts`.
- Jobs stuck in `recording` on app restart (crash) are marked `error`
  ("interrupted") at load.

### 5. IPC

Channels `capture:start|chunk|stop|jobs|save-transcriber|test-transcriber` +
zod schemas + DTOs in `shared/ipc-channels.ts`; handler
`src/main/ipc/handlers/capture.ts` registered in `register.ts`; preload +
renderer `ipc.capture.*`. Chunk payload crosses IPC as `ArrayBuffer`/
`Uint8Array` (structured clone — no base64). `capture:save-transcriber` is
write-only (no read-back of the key).

### 6. Tests

- `tests/main/services/transcriber.test.ts` — OpenAICompat vs a real
  `node:http` server (asserts multipart contains the file bytes + model field,
  returns `{text}`); Cli via `node -e "console.log('hi from cli')"` template;
  store round-trip with encrypted key; factory returns null unconfigured.
- `tests/main/services/capture-recorder.test.ts` — temp-dir lifecycle:
  start→chunks land in file→stop→transcribe→summarize→chat persisted;
  transcriber-fail → done with note; gateway-fail → error; restart marks
  in-flight jobs error; jobs persist across instances.
- Typecheck both tsconfigs (capture.ts renderer helper covered here).

### 7. UI addendum

Append "Capture card" contract to `docs/flowclaw-ui-design-prompt.md`:
record/stop button + elapsed/bytes, transcriber settings form (mode toggle,
url/model/key or command), jobs list with status chips, consent notice.
