// Read-only discovery of plugins another tool has already installed, so they
// work in Flowstate with zero setup.
//
// Claude Code keeps the real list in ~/.claude/plugins/installed_plugins.json
// (plugins live under cache/<marketplace>/<plugin>/<version>/). Flowstate used
// to treat every top-level folder of ~/.claude/plugins as a plugin, which
// listed Claude Code's internals (cache, data, marketplaces, …) and found none
// of the actual plugins.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface DiscoveredPlugin {
  /** Stable key, e.g. "superpowers@claude-plugins-official". */
  key: string;
  /** Plugin name without the marketplace suffix. */
  name: string;
  /** Where it came from (marketplace name), for display. */
  source: string;
  dir: string;
  version: string;
  /** Mirrors the tool's own enabled/disabled state. */
  defaultEnabled: boolean;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** `enabledPlugins` from ~/.claude/settings.json: { "name@mkt": true|false }. */
async function claudeEnabledPlugins(claudeHome: string): Promise<Record<string, boolean>> {
  const settings = (await readJson(join(claudeHome, 'settings.json'))) as { enabledPlugins?: unknown } | null;
  const map = settings?.enabledPlugins;
  if (!map || typeof map !== 'object') return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

interface InstallRecord {
  scope?: string;
  installPath?: string;
  version?: string;
}

/**
 * Plugins Claude Code has installed. Handles both installed_plugins.json
 * layouts: v2 `{ plugins: { key: [record, …] } }` and v1 `{ plugins: { key:
 * record } }`. Project-scoped installs are skipped (they only apply inside
 * that project). Returns null when there is no manifest to read.
 */
export async function discoverClaudeCodePlugins(claudeHome: string): Promise<DiscoveredPlugin[] | null> {
  const manifest = (await readJson(join(claudeHome, 'plugins', 'installed_plugins.json'))) as {
    plugins?: unknown;
  } | null;
  if (!manifest || !manifest.plugins || typeof manifest.plugins !== 'object') return null;
  const enabled = await claudeEnabledPlugins(claudeHome);
  const out: DiscoveredPlugin[] = [];
  for (const [key, value] of Object.entries(manifest.plugins as Record<string, unknown>)) {
    const records = (Array.isArray(value) ? value : [value]).filter(
      (r): r is InstallRecord => !!r && typeof r === 'object',
    );
    const rec =
      records.find((r) => r.scope === 'user' && r.installPath) ??
      records.find((r) => !r.scope && r.installPath);
    if (!rec?.installPath || !(await isDir(rec.installPath))) continue;
    const at = key.lastIndexOf('@');
    out.push({
      key,
      name: at > 0 ? key.slice(0, at) : key,
      source: at > 0 ? key.slice(at + 1) : 'claude-code',
      dir: rec.installPath,
      version: rec.version && rec.version !== 'unknown' ? rec.version : '',
      defaultEnabled: enabled[key] !== false,
    });
  }
  return out;
}

/**
 * Fallback for a plugins folder without installed_plugins.json: only
 * top-level folders that actually carry a plugin manifest.
 */
export async function discoverPluginDirs(root: string): Promise<DiscoveredPlugin[]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  const out: DiscoveredPlugin[] = [];
  for (const name of names) {
    const dir = join(root, name);
    try {
      await fs.access(join(dir, '.claude-plugin', 'plugin.json'));
    } catch {
      continue;
    }
    out.push({ key: name, name, source: 'local', dir, version: '', defaultEnabled: true });
  }
  return out;
}
