// Customize feature — re-exports the pure schema/helpers and layers the
// IPC-backed persistence on top. Renderer code imports from here; tests
// import directly from ./customize-schema to avoid the IPC dependency.

import { ipc } from './ipc';
import {
  DEFAULT_PREFS,
  STORAGE_KEY,
  mergeWithDefaults,
  type CustomizePrefs,
} from './customize-schema';

export * from './customize-schema';

export async function loadPrefs(): Promise<CustomizePrefs> {
  try {
    const res = await ipc.settings.get(STORAGE_KEY);
    if (!res.value) return DEFAULT_PREFS;
    const parsed = JSON.parse(res.value);
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: CustomizePrefs): Promise<void> {
  try {
    await ipc.settings.set(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // best-effort; in-memory copy stays.
  }
}

export async function resetPrefs(): Promise<CustomizePrefs> {
  await savePrefs(DEFAULT_PREFS);
  return DEFAULT_PREFS;
}
