import { app, ipcMain, BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import { TerminalService, type PtyModule } from '@main/services/terminal-service';

/**
 * node-pty ships native code, a worker script and OpenConsole.exe that must be
 * real files, so the packaged app loads it from app.asar.unpacked (see
 * electron-builder.yml asarUnpack) rather than through the asar archive.
 */
function loadPty(): PtyModule {
  const from = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'index.js')
    : import.meta.url;
  return createRequire(from)('@lydell/node-pty') as PtyModule;
}

export function registerTerminalHandlers(): TerminalService {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
  };
  const service = new TerminalService(
    {
      onData: (id, chunk) => broadcast(CHANNELS.TERMINAL_DATA, { id, chunk }),
      onExit: (id, code) => broadcast(CHANNELS.TERMINAL_EXIT, { id, code }),
    },
    loadPty,
  );
  // ConPTY shells aren't torn down with the app on Windows; end them on quit.
  app.on('will-quit', () => service.killAll());

  ipcMain.handle(CHANNELS.TERMINAL_START, (_e, raw) => {
    const { id, cwd, cols, rows } = schemas.terminalStartRequest.parse(raw);
    const { pty } = service.start(id, cwd, { ...(cols ? { cols } : {}), ...(rows ? { rows } : {}) });
    return { ok: true, pty };
  });

  ipcMain.handle(CHANNELS.TERMINAL_INPUT, (_e, raw) => {
    const { id, data } = schemas.terminalInputRequest.parse(raw);
    service.write(id, data);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TERMINAL_RESIZE, (_e, raw) => {
    const { id, cols, rows } = schemas.terminalResizeRequest.parse(raw);
    service.resize(id, cols, rows);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.TERMINAL_KILL, (_e, raw) => {
    const { id } = schemas.terminalKillRequest.parse(raw);
    service.kill(id);
    return { ok: true };
  });

  return service;
}
