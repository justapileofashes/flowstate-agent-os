// IPC for detecting + connecting installed CLIs. Detection is a process-heavy
// scan (one probe per catalog entry), so results are cached in memory and
// reused for the agent system-prompt injection (getConnectedClis) — that runs
// on every chat start and must not re-scan.

import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import { detectInstalledClis } from '@main/services/cli-detector';
import type { DetectedCli } from '@main/services/cli-catalog';

const CONNECTED_KEY = 'connected_clis';
const SEEN_KEY = 'clis_onboarding_seen';
const CACHE_TTL_MS = 60_000;

let cache: { at: number; clis: DetectedCli[] } | null = null;
let settingsRef: SettingsService | null = null;

function readConnectedIds(s: SettingsService): string[] {
  const raw = s.get(CONNECTED_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function refresh(): Promise<DetectedCli[]> {
  const clis = await detectInstalledClis();
  cache = { at: Date.now(), clis };
  return clis;
}

/** The connected + still-installed CLIs, from the warmed cache. Returns [] until
 *  the first scan completes — agents simply get no CLI block until then. */
export function getConnectedClis(): DetectedCli[] {
  if (!cache || !settingsRef) return [];
  const ids = new Set(readConnectedIds(settingsRef));
  return cache.clis.filter((c) => c.installed && ids.has(c.id));
}

export function registerClisHandlers(deps: { settings: SettingsService }): void {
  settingsRef = deps.settings;
  // Warm the cache on startup so the first-run modal + agent context are ready.
  void refresh().catch(() => {
    // best-effort; detect again on demand
  });

  ipcMain.handle(CHANNELS.CLIS_DETECT, async () => {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return { clis: cache.clis };
    return { clis: await refresh() };
  });

  ipcMain.handle(CHANNELS.CLIS_GET, () => ({
    connected: readConnectedIds(deps.settings),
    onboardingSeen: deps.settings.get(SEEN_KEY) === 'true',
  }));

  ipcMain.handle(CHANNELS.CLIS_CONNECT, (_e, raw) => {
    const { ids } = schemas.clisConnectRequest.parse(raw);
    deps.settings.set(CONNECTED_KEY, JSON.stringify(ids));
    deps.settings.set(SEEN_KEY, 'true');
    return { ok: true as const };
  });
}
