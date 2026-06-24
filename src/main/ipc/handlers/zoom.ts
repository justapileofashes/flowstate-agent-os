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
