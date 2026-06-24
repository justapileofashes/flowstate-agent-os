import { app } from 'electron';
import { join } from 'node:path';

export function appDataDir(): string {
  return app.getPath('userData');
}

export function databasePath(): string {
  return join(appDataDir(), 'flowstate.sqlite');
}

export function defaultWorkspacesDir(): string {
  return join(app.getPath('home'), 'Flowstate', 'workspaces');
}
