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
