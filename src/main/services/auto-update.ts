// Auto-update from GitHub Releases (electron-builder.yml `publish:`). In the
// installed (NSIS) build this checks on launch and every few hours, downloads
// in the background, and reports progress on `update:status` so the renderer
// can offer "Update ready — restart". The update also installs on the next
// quit. The portable Flowstate.exe, the Store build and dev runs can't
// self-update; they report `disabled` with the reason instead of erroring.

import { app } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { CHANNELS, type UpdateStatusDto } from '@shared/ipc-channels';
import { broadcast } from '@main/util/broadcast';

const RECHECK_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatusDto = { state: 'idle', current: '' };
let updater: AppUpdater | null = null;
let checking: Promise<void> | null = null;

function set(next: Omit<UpdateStatusDto, 'current'>): void {
  status = { ...next, current: app.getVersion() };
  broadcast(CHANNELS.UPDATE_STATUS, status);
}

/** Why this build can't update itself, or null when it can. */
export function updateUnsupportedReason(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!app.isPackaged) return 'Updates only run in the installed app, not in development.';
  if (env['PORTABLE_EXECUTABLE_FILE']) {
    return "The portable Flowstate.exe can't update itself. Use the installer build (Flowstate-Setup), which updates automatically, or download the new version.";
  }
  if (process.windowsStore) return 'This copy updates through the Microsoft Store.';
  return null;
}

/** Map updater errors to something a person can act on. */
export function describeUpdateError(message: string): { state: 'none' | 'error'; text: string } {
  if (/Unable to find latest version|No published versions|latest\.yml.*404|HttpError: 404/i.test(message)) {
    return { state: 'none', text: 'No release has been published yet.' };
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(message)) {
    return { state: 'error', text: "Couldn't reach GitHub to check for updates." };
  }
  if (/rate limit/i.test(message)) return { state: 'error', text: 'GitHub rate limit hit — will try again later.' };
  return { state: 'error', text: message.split('\n')[0]!.slice(0, 300) };
}

async function getUpdater(): Promise<AppUpdater> {
  if (updater) return updater;
  // Lazy import so the dependency never loads in dev or tests.
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  let lastPercent = -1;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('update-available', (info: { version: string }) => {
    lastPercent = 0;
    set({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p: { percent: number }) => {
    const percent = Math.floor(p.percent);
    if (percent === lastPercent) return;
    lastPercent = percent;
    set({ state: 'downloading', percent, ...(status.version ? { version: status.version } : {}) });
  });
  autoUpdater.on('update-downloaded', (info: { version: string }) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err: Error) => {
    const d = describeUpdateError(err?.message ?? String(err));
    console.warn('[update]', err?.message ?? err);
    set(d.state === 'none' ? { state: 'none', note: d.text } : { state: 'error', error: d.text });
  });
  updater = autoUpdater;
  return autoUpdater;
}

export function getUpdateStatus(): UpdateStatusDto {
  return { ...status, current: app.getVersion() };
}

/** Check now (no-op while a check is running or an update is ready). */
export async function checkForUpdates(): Promise<UpdateStatusDto> {
  const reason = updateUnsupportedReason();
  if (reason) {
    set({ state: 'disabled', reason });
    return getUpdateStatus();
  }
  if (status.state === 'ready' || status.state === 'downloading') return getUpdateStatus();
  checking ??= (async () => {
    try {
      await (await getUpdater()).checkForUpdates();
    } catch (err) {
      const d = describeUpdateError(err instanceof Error ? err.message : String(err));
      set(d.state === 'none' ? { state: 'none', note: d.text } : { state: 'error', error: d.text });
    } finally {
      checking = null;
    }
  })();
  await checking;
  return getUpdateStatus();
}

/** Restart into the downloaded update. */
export function installUpdate(): boolean {
  if (status.state !== 'ready' || !updater) return false;
  const u = updater;
  // Let the IPC reply go out before the app quits.
  setImmediate(() => u.quitAndInstall(false, true));
  return true;
}

export function initAutoUpdate(): void {
  status = { state: 'idle', current: app.getVersion() };
  const reason = updateUnsupportedReason();
  if (reason) {
    status = { state: 'disabled', reason, current: app.getVersion() };
    return;
  }
  void checkForUpdates();
  setInterval(() => void checkForUpdates(), RECHECK_MS).unref();
}
