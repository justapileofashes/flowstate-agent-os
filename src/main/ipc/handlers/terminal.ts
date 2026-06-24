import { ipcMain, BrowserWindow } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import { TerminalService } from '@main/services/terminal-service';

export function registerTerminalHandlers(): TerminalService {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
  };
  const service = new TerminalService({
    onData: (id, chunk) => broadcast(CHANNELS.TERMINAL_DATA, { id, chunk }),
    onExit: (id, code) => broadcast(CHANNELS.TERMINAL_EXIT, { id, code }),
  });

  ipcMain.handle(CHANNELS.TERMINAL_START, (_e, raw) => {
    const { id, cwd } = schemas.terminalStartRequest.parse(raw);
    service.start(id, cwd);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TERMINAL_INPUT, (_e, raw) => {
    const { id, data } = schemas.terminalInputRequest.parse(raw);
    service.write(id, data);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TERMINAL_KILL, (_e, raw) => {
    const { id } = schemas.terminalKillRequest.parse(raw);
    service.kill(id);
    return { ok: true };
  });

  return service;
}
