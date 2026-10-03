// IPC glue for composer voice input: the speech-to-text backend config
// (TranscriberStore — API key encrypted, write-only across IPC) and one-clip
// transcription. Chromium's Web Speech API has no speech service inside
// Electron, so dictation goes through this transcriber instead.

import { ipcMain } from 'electron';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHANNELS, schemas, type VoiceTranscriberDto } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import { SecretStore, electronSafeStorageBackend } from '@main/services/secret-store';
import { TranscriberStore, buildTranscriber } from '@main/services/transcriber';

export function registerVoiceHandlers(deps: { settings: SettingsService }): void {
  const secrets = new SecretStore(electronSafeStorageBackend());
  const transcriberStore = new TranscriberStore(deps.settings, secrets);

  ipcMain.handle(CHANNELS.VOICE_GET_TRANSCRIBER, (): { config: VoiceTranscriberDto | null } => {
    const cfg = transcriberStore.load();
    if (!cfg) return { config: null };
    return {
      config: {
        mode: cfg.mode,
        ...(cfg.url ? { url: cfg.url } : {}),
        ...(cfg.model ? { model: cfg.model } : {}),
        ...(cfg.command ? { command: cfg.command } : {}),
        hasKey: !!cfg.apiKey,
      },
    };
  });

  ipcMain.handle(CHANNELS.VOICE_SAVE_TRANSCRIBER, (_e, raw) => {
    const args = schemas.voiceSaveTranscriberRequest.parse(raw);
    // A blank key field means "keep the stored key", like every other
    // write-only secret field in the app.
    const apiKey = args.apiKey || transcriberStore.load()?.apiKey;
    transcriberStore.save({
      mode: args.mode,
      ...(args.url ? { url: args.url } : {}),
      ...(apiKey && args.mode === 'openai' ? { apiKey } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.command ? { command: args.command } : {}),
    });
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.VOICE_TEST_TRANSCRIBER, async () => {
    const t = buildTranscriber(transcriberStore);
    if (!t) return { ok: false as const, error: 'not configured' };
    return t.test();
  });

  // One recorded clip → text.
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
