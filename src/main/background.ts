// Background mode: Routines, the Business scheduler, the AI Trader and
// Flowclaw automations all run in the main process, so closing the window
// must not quit the app. The main window hides to a tray icon instead
// (Settings → Background, on by default); Quit lives in the tray menu.
// Also: launch at login (starts hidden) and re-focusing the running copy
// when the app is launched a second time.

import { app, BrowserWindow, Menu, Notification, Tray, type NativeImage } from 'electron';

export const CLOSE_TO_TRAY_KEY = 'close_to_tray';
export const TRAY_HINT_SHOWN_KEY = 'close_to_tray_hint_shown';
/** argv flag the login item passes so a login launch starts in the tray. */
export const HIDDEN_FLAG = '--hidden';

interface SettingsKV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/** Close-to-tray is on unless the user turned it off. */
export function closeToTrayEnabled(settings: SettingsKV): boolean {
  return settings.get(CLOSE_TO_TRAY_KEY) !== 'false';
}

/** What closing the main window should do. Pop-out chat windows always close. */
export function onCloseDecision(opts: { quitting: boolean; isMainWindow: boolean; closeToTray: boolean }): 'hide' | 'close' {
  return !opts.quitting && opts.isMainWindow && opts.closeToTray ? 'hide' : 'close';
}

/** The exe to register for login: the portable build runs from a temp copy,
 *  so it must register the real file electron-builder points at. */
export function loginExecutable(env: NodeJS.ProcessEnv, execPath: string): string {
  return env['PORTABLE_EXECUTABLE_FILE'] || execPath;
}

export function getOpenAtLogin(): boolean {
  if (!app.isPackaged) return false;
  return app.getLoginItemSettings({ path: loginExecutable(process.env, process.execPath), args: [HIDDEN_FLAG] })
    .openAtLogin;
}

export function setOpenAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return; // dev builds would register electron.exe
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: loginExecutable(process.env, process.execPath),
    args: [HIDDEN_FLAG],
  });
}

let tray: Tray | null = null;
let quitting = false;

export function isQuitting(): boolean {
  return quitting;
}

export function showWindow(win: BrowserWindow | null | undefined): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Wire background mode around the main window. Call once after it exists. */
export function setupBackground(opts: {
  mainWindow: () => BrowserWindow | null;
  settings: SettingsKV;
  icon: NativeImage | undefined;
}): void {
  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('second-instance', () => showWindow(opts.mainWindow()));

  if (opts.icon) {
    tray = new Tray(opts.icon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Flowstate');
    const rebuild = (): void => {
      tray?.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Open Flowstate', click: () => showWindow(opts.mainWindow()) },
          { type: 'separator' },
          {
            label: 'Keep running when closed',
            type: 'checkbox',
            checked: closeToTrayEnabled(opts.settings),
            click: (item) => opts.settings.set(CLOSE_TO_TRAY_KEY, item.checked ? 'true' : 'false'),
          },
          ...(app.isPackaged
            ? [
                {
                  label: 'Start with Windows',
                  type: 'checkbox' as const,
                  checked: getOpenAtLogin(),
                  click: (item: Electron.MenuItem) => setOpenAtLogin(item.checked),
                },
              ]
            : []),
          { type: 'separator' },
          { label: 'Quit Flowstate', click: () => app.quit() },
        ]),
      );
    };
    rebuild();
    tray.on('right-click', rebuild);
    tray.on('click', () => showWindow(opts.mainWindow()));
  }
}

/** Attach close-to-tray to the main window. */
export function hideOnClose(win: BrowserWindow, settings: SettingsKV): void {
  win.on('close', (e) => {
    const decision = onCloseDecision({ quitting, isMainWindow: true, closeToTray: closeToTrayEnabled(settings) && !!tray });
    if (decision === 'close') return;
    e.preventDefault();
    win.hide();
    if (settings.get(TRAY_HINT_SHOWN_KEY) !== 'true' && Notification.isSupported()) {
      settings.set(TRAY_HINT_SHOWN_KEY, 'true');
      new Notification({
        title: 'Flowstate is still running',
        body: 'Routines and automations keep running in the tray. Quit from the tray icon, or turn this off in Settings → Background.',
      }).show();
    }
  });
}
