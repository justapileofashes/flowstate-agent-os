# Zoom Meeting Recorder — flowclaw agent pipeline

**Date:** 2026-06-10
**Status:** Approved by user (cloud-recording path, record + summarize + deliver full recording)

## What this is

A flowclaw feature: "deploy" an OpenClaw/Hermes agent against a Zoom meeting. Since
text/tool agents cannot sit in an AV call, the chosen architecture is Zoom **cloud
recording** orchestration: flowclaw enables cloud recording on a meeting on the
user's own Zoom account, waits for Zoom to finish processing, downloads the full
recording + transcript locally, then dispatches the transcript to a configured
flowclaw gateway connection (OpenClaw or Hermes, including local models) for a
summary. The user ends up with: meeting notes + action items in a chat, the full
recording files on disk, and the Zoom share link.

Explicitly **not** in scope:
- Bot participant joining arbitrary/third-party meetings (that is the Recall.ai
  path; rejected for now).
- Live in-meeting audio processing.
- The UI screen (flowclaw UI is with Claude Design; this feature ships its IPC
  contract, and the design prompt gets an addendum).

## Requirements on the Zoom side

- Server-to-Server OAuth app on Zoom Marketplace → `account_id`, `client_id`,
  `client_secret`. Scopes: meeting read/write, recording read.
- Paid Zoom plan (cloud recording requirement).
- "Audio transcript" enabled in Zoom recording settings for VTT transcripts;
  when absent the pipeline degrades gracefully (summary from metadata + links).

## Components

### 1. ZoomService — `src/main/services/zoom-service.ts`

Pure service, injectable `fetchImpl` (same pattern as OpenClawClient), no
Electron/DB imports.

- **Auth:** `POST https://zoom.us/oauth/token?grant_type=account_credentials&account_id=…`
  with HTTP Basic `client_id:client_secret`. Caches the access token; refreshes
  ~5 min before expiry (tokens last 1 h).
- `ensureCloudRecording(meetingId)` — `PATCH /v2/meetings/{id}` with
  `settings.auto_recording: "cloud"`.
- `createMeeting(topic)` — `POST /v2/users/me/meetings` with
  `auto_recording: "cloud"`; returns id + join_url.
- `getRecordings(meetingId)` — `GET /v2/meetings/{id}/recordings`. Returns the
  file list (MP4, M4A, TRANSCRIPT/VTT), share URL, and per-file download URLs.
  404 means "not ready yet" while a meeting hasn't ended/processed — not an error.
- `download(url, destPath)` — streams a recording file to disk, authorized with
  the OAuth bearer token.

Credentials live in the settings KV encrypted via SecretStore (identical
treatment to flowclaw connection tokens): write-only across IPC, never returned
to the renderer, decrypted only in the main process.

### 2. ZoomRecorder (job store + poller) — `src/main/services/zoom-recorder.ts`

Persists jobs to `userData/zoom-jobs.json` (same approach as `routines.json`).

Job shape:

```ts
interface ZoomJob {
  id: string;            // uuid
  meetingId: string;
  topic: string;
  connectionId: string;  // flowclaw connection that summarizes
  model?: string;        // optional model override
  status: 'armed' | 'waiting' | 'downloading' | 'summarizing' | 'done' | 'error';
  chatId?: string;       // result chat once created
  recordingFiles?: string[]; // local absolute paths after download
  shareUrl?: string;     // Zoom cloud share link
  error?: string;
  createdAt: number;
  updatedAt: number;
}
```

Lifecycle:

1. **armed** — `ZOOM_RECORD` IPC arrived. Either patches an existing meeting to
   cloud auto-record, or creates a fresh meeting (topic given, no meetingId).
2. **waiting** — 60 s poller (runs only while non-terminal jobs exist) calls
   `getRecordings`. 404/empty → keep waiting.
3. **downloading** — files appeared. Download MP4 + M4A to
   `userData/zoom-recordings/<meetingId>/`, plus the VTT transcript when
   present. Download failure is non-fatal: fall back to cloud links only and
   note it in the final chat.
4. **summarizing** — build prompt ("Summarize this meeting: notes, decisions,
   action items" + transcript text, or metadata-only fallback note) and call
   `FlowclawConnections.runToText(connectionId, prompt, { model })`.
5. **done** — create a chat (same persistence pattern as routine `fire()`):
   user message = the prompt context, assistant message = summary + local
   recording paths + share link. `markDone` stamps chatId.
6. **error** — any unrecoverable failure (auth rejected, meeting truly not
   found after grace, gateway connection unreachable) lands on the job with a
   message; surfaced via `ZOOM_JOBS` list.

The recorder takes injected dependencies (`ZoomService`, `FlowclawConnections`,
chat repo, clock/now) so the poll cycle is unit-testable without Electron.

### 3. IPC

New channels + zod schemas + DTOs in `shared/ipc-channels.ts`, handler in
`src/main/ipc/handlers/zoom.ts`, registered in `register.ts`, exposed in
preload + renderer `lib/ipc.ts` as `window.flowstate.zoom.*`:

- `ZOOM_SAVE_CREDS` `{accountId, clientId, clientSecret}` → `{ok}` — encrypts +
  stores. Write-only: no read-back channel.
- `ZOOM_TEST` `{}` → `{ok, error?}` — performs a token fetch with stored creds.
- `ZOOM_RECORD` `{meetingId? , topic?, connectionId, model?}` → `{jobId}` —
  one of meetingId/topic required (meetingId = existing meeting; topic only =
  create new recorded meeting, response also returns join_url).
- `ZOOM_JOBS` `{}` → `{jobs: ZoomJobDto[]}` — job list incl. status,
  recordingFiles, shareUrl, chatId.
- `ZOOM_OPEN_RECORDING` `{path}` → `{ok}` — opens a downloaded file/folder via
  the existing shellOpen service; path must be inside the zoom-recordings dir.

### 4. Testing

- `tests/main/services/zoom-service.test.ts` — real `node:http` fake Zoom over
  TCP (token endpoint w/ Basic-auth assertion, PATCH meeting, recordings list,
  VTT + MP4 download). Same realism bar as `flowclaw-integration.test.ts`.
- `tests/main/services/zoom-recorder.test.ts` — injected fake ZoomService +
  fake FlowclawConnections + in-memory repo: full lifecycle armed→done,
  404-then-ready polling, transcript-missing fallback, download-failure
  fallback, gateway-error → status error.
- Typecheck across tsconfigs.

### 5. Security

- Zoom creds encrypted at rest (SecretStore), never cross IPC outward.
- Recording downloads authorized via short-lived OAuth bearer; URLs never
  logged.
- `ZOOM_OPEN_RECORDING` validates the path is inside the recordings dir
  (no arbitrary shell-open).

## Open follow-ups (not this build)

- UI: add a "Meetings" card to the Flowclaw screen prompt for Claude Design
  (creds form, record button, job list with status + open-recording).
- Optional webhook mode if the app ever has a public endpoint (replaces polling).
- "Full pipeline + actions" (agent emails notes / posts to Slack) once gateway
  tool configs are known.
