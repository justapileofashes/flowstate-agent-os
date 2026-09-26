// IPC glue for the system-audio capture pipeline. Thin over the tested
// services: TranscriberStore (encrypted STT config), CaptureRecorder (job
// lifecycle), FlowclawConnections (summary dispatch). Transcriber API key is
// write-only across IPC, identical treatment to Zoom credentials.

import { app, ipcMain } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import type { ChatRepository } from '@main/repos/chat-repository';
import { SecretStore, electronSafeStorageBackend } from '@main/services/secret-store';
import { SettingsConnectionStore } from '@main/services/flowclaw-store';
import { FlowclawConnections } from '@main/agent/flowclaw-connections';
import { TranscriberStore, buildTranscriber } from '@main/services/transcriber';
import { CaptureRecorder } from '@main/services/capture-recorder';

export function registerCaptureHandlers(deps: {
  settings: SettingsService;
  repo: ChatRepository;
}): void {
  const secrets = new SecretStore(electronSafeStorageBackend());
  const transcriberStore = new TranscriberStore(deps.settings, secrets);
  const flowclaw = new FlowclawConnections(new SettingsConnectionStore(deps.settings, secrets));

  const recorder = new CaptureRecorder({
    jobsPath: join(app.getPath('userData'), 'capture-jobs.json'),
    capturesDir: join(app.getPath('userData'), 'captures'),
    getTranscriber: () => buildTranscriber(transcriberStore),
    dispatcher: flowclaw,
    chatSink: deps.repo,
  });

  ipcMain.handle(CHANNELS.CAPTURE_START, (_e, raw) => {
    const args = schemas.captureStartRequest.parse(raw);
    const job = recorder.start({
      title: args.title,
      agentId: args.agentId,
      connectionId: args.connectionId,
      ...(args.model ? { model: args.model } : {}),
    });
    return { captureId: job.id };
  });

  ipcMain.handle(CHANNELS.CAPTURE_CHUNK, (_e, raw) => {
    // Binary payload — validated by hand, not zod (structured clone carries
    // the ArrayBuffer; zod would walk every byte).
    const p = raw as { captureId?: unknown; data?: unknown };
    if (typeof p?.captureId !== 'string') return { ok: false as const };
    const data =
      p.data instanceof Uint8Array
        ? p.data
        : p.data instanceof ArrayBuffer
          ? new Uint8Array(p.data)
          : null;
    if (!data) return { ok: false as const };
    recorder.appendChunk(p.captureId, data);
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.CAPTURE_STOP, async (_e, raw) => {
    const args = schemas.captureStopRequest.parse(raw);
    await recorder.stop(args.captureId);
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.CAPTURE_JOBS, () => ({ jobs: recorder.jobs() }));

  ipcMain.handle(CHANNELS.CAPTURE_SAVE_TRANSCRIBER, (_e, raw) => {
    const args = schemas.captureSaveTranscriberRequest.parse(raw);
    transcriberStore.save({
      mode: args.mode,
      ...(args.url ? { url: args.url } : {}),
      ...(args.apiKey ? { apiKey: args.apiKey } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.command ? { command: args.command } : {}),
    });
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.CAPTURE_TEST_TRANSCRIBER, async () => {
    const t = buildTranscriber(transcriberStore);
    if (!t) return { ok: false as const, error: 'not configured' };
    return t.test();
  });

  // Composer voice input: one recorded clip → text via the same transcriber
  // the Capture appliance uses. (Chromium's Web Speech API has no speech
  // backend inside Electron, so the mic button never worked.)
  ipcMain.handle(CHANNELS.VOICE_TRANSCRIBE, async (_e, raw) => {
    const p = raw as { data?: unknown; mime?: unknown };
    const data =
      p?.data instanceof Uint8Array ? p.data : p?.data instanceof ArrayBuffer ? new Uint8Array(p.data) : null;
    if (!data || data.byteLength === 0) return { error: 'No audio recorded.' };
    if (data.byteLength > 50 * 1024 * 1024) return { error: 'Recording too long.' };
    const t = buildTranscriber(transcriberStore);
    if (!t) return { notConfigured: true };
    const ext = typeof p.mime === 'string' && p.mime.includes('ogg') ? 'ogg' : 'webm';
    const dir = await mkdtemp(join(tmpdir(), 'flowstate-voice-'));
    const file = join(dir, `clip.${ext}`);
    try {
      await writeFile(file, data);
      return { text: (await t.transcribe(file)).trim() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}
