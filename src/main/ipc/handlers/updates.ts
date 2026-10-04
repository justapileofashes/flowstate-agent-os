import { ipcMain } from 'electron';
import { CHANNELS } from '@shared/ipc-channels';
import { checkForUpdates, getUpdateStatus, installUpdate } from '@main/services/auto-update';

export function registerUpdateHandlers(): void {
  ipcMain.handle(CHANNELS.UPDATE_GET_STATUS, () => getUpdateStatus());
  ipcMain.handle(CHANNELS.UPDATE_CHECK, () => checkForUpdates());
  ipcMain.handle(CHANNELS.UPDATE_INSTALL, () => ({ ok: installUpdate() }));
}
