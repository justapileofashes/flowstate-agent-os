// Auto-update. In a packaged build with a configured publish feed (see
// electron-builder.yml `publish:`), this checks for a newer release on launch,
// downloads it in the background, and installs on the next quit. Everything is
// best-effort and fully guarded: in dev, or when no update feed is configured,
// it silently does nothing rather than erroring. No UI is forced on the user.

import { app } from 'electron';

export function initAutoUpdate(): void {
  if (!app.isPackaged) return; // dev / unpackaged: nothing to update against

  void (async () => {
    try {
      // Lazy import so the dependency never loads in dev or tests.
      const { autoUpdater } = await import('electron-updater');
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('error', (err: Error) => {
        // A missing/unreachable feed throws here — log and move on.
        // eslint-disable-next-line no-console
        console.warn('[update] check failed:', err?.message ?? err);
      });
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[update] disabled:', err instanceof Error ? err.message : String(err));
    }
  })();
}
