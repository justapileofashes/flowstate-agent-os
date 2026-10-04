import { BrowserWindow } from 'electron';

/**
 * Send an event to every open window. Chats can be popped out into their own
 * window, so sending only to `getAllWindows()[0]` left one of them without
 * its stream events (stuck on "streaming" forever).
 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}
