import { ipcMain, shell } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SecondBrain } from '@main/services/second-brain';
import type { SettingsService } from '@main/services/settings-service';

export function registerBrainHandlers(deps: {
  brain: SecondBrain;
  settings: SettingsService;
}): void {
  ipcMain.handle(CHANNELS.BRAIN_STATUS, () => deps.brain.status());

  ipcMain.handle(CHANNELS.BRAIN_LIST, (_e, raw) => {
    const { category } = schemas.brainListRequest.parse(raw ?? {});
    return deps.brain.list(category);
  });

  ipcMain.handle(CHANNELS.BRAIN_READ, (_e, raw) => {
    const { relPath } = schemas.brainReadRequest.parse(raw);
    return deps.brain.readNote(relPath);
  });

  ipcMain.handle(CHANNELS.BRAIN_WRITE, (_e, raw) => {
    const input = schemas.brainWriteRequest.parse(raw);
    return deps.brain.writeNote(input);
  });

  ipcMain.handle(CHANNELS.BRAIN_CAPTURE, (_e, raw) => {
    const { text, source, tags } = schemas.brainCaptureRequest.parse(raw);
    return deps.brain.capture(text, {
      ...(source ? { source } : {}),
      ...(tags ? { tags } : {}),
    });
  });

  ipcMain.handle(CHANNELS.BRAIN_SEARCH, (_e, raw) => {
    const { query, limit } = schemas.brainSearchRequest.parse(raw);
    return deps.brain.search(query, limit ?? 25);
  });

  ipcMain.handle(CHANNELS.BRAIN_OPEN_VAULT, () => {
    return shell.openPath(deps.brain.getVaultPath());
  });

  ipcMain.handle(CHANNELS.BRAIN_SET_VAULT, async (_e, raw) => {
    const { path } = schemas.brainSetVaultRequest.parse(raw);
    deps.brain.setVaultPath(path);
    deps.settings.set('brain_vault_path', path);
    await deps.brain.initialize();
    return { ok: true };
  });
}
