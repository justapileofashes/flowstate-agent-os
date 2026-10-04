import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, BrowserWindow: class {}, Menu: {}, Notification: {}, Tray: class {} }));

const { closeToTrayEnabled, loginExecutable, onCloseDecision } = await import('@main/background');

const kv = (v: string | null) => ({ get: () => v, set: () => {} });

describe('background mode', () => {
  it('close-to-tray is on by default, off only when turned off', () => {
    expect(closeToTrayEnabled(kv(null))).toBe(true);
    expect(closeToTrayEnabled(kv('true'))).toBe(true);
    expect(closeToTrayEnabled(kv('false'))).toBe(false);
  });

  it('hides the main window on close; quitting and pop-outs really close', () => {
    expect(onCloseDecision({ quitting: false, isMainWindow: true, closeToTray: true })).toBe('hide');
    expect(onCloseDecision({ quitting: true, isMainWindow: true, closeToTray: true })).toBe('close');
    expect(onCloseDecision({ quitting: false, isMainWindow: false, closeToTray: true })).toBe('close');
    expect(onCloseDecision({ quitting: false, isMainWindow: true, closeToTray: false })).toBe('close');
  });

  it('the portable build registers its real exe for login, not the temp copy', () => {
    expect(loginExecutable({ PORTABLE_EXECUTABLE_FILE: 'D:\\Flowstate.exe' }, 'C:\\Temp\\x\\Flowstate.exe')).toBe(
      'D:\\Flowstate.exe',
    );
    expect(loginExecutable({}, 'C:\\Program Files\\Flowstate\\Flowstate.exe')).toBe(
      'C:\\Program Files\\Flowstate\\Flowstate.exe',
    );
  });
});
