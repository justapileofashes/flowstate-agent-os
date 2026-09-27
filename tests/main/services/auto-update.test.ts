import { describe, it, expect, vi, beforeEach } from 'vitest';

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.2.3' },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('electron', () => electron);

import {
  checkForUpdates,
  describeUpdateError,
  getUpdateStatus,
  initAutoUpdate,
  installUpdate,
  updateUnsupportedReason,
} from '@main/services/auto-update';

describe('updateUnsupportedReason', () => {
  beforeEach(() => {
    electron.app.isPackaged = true;
  });

  it('allows the installed build', () => {
    expect(updateUnsupportedReason({})).toBeNull();
  });

  it('explains why the portable exe and dev runs cannot update', () => {
    expect(updateUnsupportedReason({ PORTABLE_EXECUTABLE_FILE: 'C:\\x\\Flowstate.exe' })).toMatch(/portable/);
    electron.app.isPackaged = false;
    expect(updateUnsupportedReason({})).toMatch(/installed app/);
  });
});

describe('describeUpdateError', () => {
  it('treats "no release yet" as up to date, with a note', () => {
    expect(
      describeUpdateError(
        'Unable to find latest version on GitHub (https://github.com/o/r/releases/latest), please ensure a production release exists',
      ),
    ).toEqual({ state: 'none', text: 'No release has been published yet.' });
    expect(describeUpdateError('HttpError: 404 Not Found\n"method: GET url: …/latest.yml"').state).toBe('none');
  });

  it('turns network failures into a readable line', () => {
    expect(describeUpdateError('net::ERR_INTERNET_DISCONNECTED')).toEqual({
      state: 'error',
      text: "Couldn't reach GitHub to check for updates.",
    });
    expect(describeUpdateError('something odd\nstack…').text).toBe('something odd');
  });
});

describe('status without an updater', () => {
  it('reports disabled for dev runs and refuses to install', async () => {
    electron.app.isPackaged = false;
    initAutoUpdate();
    expect(getUpdateStatus()).toMatchObject({ state: 'disabled', current: '1.2.3' });
    expect((await checkForUpdates()).state).toBe('disabled');
    expect(installUpdate()).toBe(false);
  });
});
