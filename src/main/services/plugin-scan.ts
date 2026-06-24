// Filesystem scanners that turn a Claude Code plugin directory into typed
// component entries. Pure-ish (only read the filesystem), no persistence — the
// PluginManager composes these with the registry. Each scanner is defensive:
// a malformed file is skipped, never thrown, so one bad skill can't sink a
// whole plugin.

import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { parseFrontmatter, parseListValue } from './frontmatter';
import type {
  CommandEntry,
  HookEntry,
  PluginAgentEntry,
  PluginManifest,
  PluginMcpEntry,
  SkillEntry,
} from './plugin-types';
import type { McpServerConfig } from './mcp-client';

export const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/i;

async function readText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listFiles(path: string, ext: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Read `.claude-plugin/plugin.json`. Falls back to a manifest named after the
 *  directory when the file is missing (a bare skills folder is still usable). */
export async function readPluginManifest(pluginDir: string): Promise<PluginManifest> {
  const raw = await readText(join(pluginDir, '.claude-plugin', 'plugin.json'));
  const fallback: PluginManifest = { name: basename(pluginDir) };
  if (!raw) return fallback;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const m: PluginManifest = {
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : fallback.name,
    };
    if (typeof o.version === 'string') m.version = o.version;
    if (typeof o.description === 'string') m.description = o.description;
    if (typeof o.author === 'string') m.author = o.author;
    else if (o.author && typeof o.author === 'object') {
      const a = (o.author as { name?: unknown }).name;
      if (typeof a === 'string') m.author = a;
    }
    return m;
  } catch {
    return fallback;
  }
}

/** Skills inside a plugin: `<dir>/skills/<name>/SKILL.md`. */
export async function scanSkills(pluginDir: string, pluginId: string | null): Promise<SkillEntry[]> {
  const skillsRoot = join(pluginDir, 'skills');
  const out: SkillEntry[] = [];
  for (const name of await listDirs(skillsRoot)) {
    const dir = join(skillsRoot, name);
    const entry = await readSkillDir(dir, pluginId);
    if (entry) out.push(entry);
  }
  return out;
}

/** Standalone skills (e.g. `~/.claude/skills/<name>/SKILL.md`). */
export async function scanStandaloneSkills(root: string): Promise<SkillEntry[]> {
  const out: SkillEntry[] = [];
  for (const name of await listDirs(root)) {
    const entry = await readSkillDir(join(root, name), null);
    if (entry) out.push(entry);
  }
  return out;
}

async function readSkillDir(dir: string, pluginId: string | null): Promise<SkillEntry | null> {
  const path = join(dir, 'SKILL.md');
  const raw = await readText(path);
  if (!raw) return null;
  const { data } = parseFrontmatter(raw);
  const name = data.name?.trim() || basename(dir);
  const description = data.description?.trim() || '';
  if (!description) return null; // a skill with no description can't be triggered
  return { name, description, path, dir, pluginId };
}

/** Commands: `<dir>/commands/*.md`. */
export async function scanCommands(pluginDir: string, pluginId: string): Promise<CommandEntry[]> {
  const root = join(pluginDir, 'commands');
  const out: CommandEntry[] = [];
  for (const file of await listFiles(root, '.md')) {
    const raw = await readText(join(root, file));
    if (!raw) continue;
    const { data, body } = parseFrontmatter(raw);
    const name = (data.name?.trim() || file.replace(/\.md$/i, '')).replace(/^\//, '');
    out.push({
      name,
      description: data.description?.trim() || '',
      body,
      pluginId,
    });
  }
  return out;
}

/** Agents: `<dir>/agents/*.md`. */
export async function scanAgents(pluginDir: string, pluginId: string): Promise<PluginAgentEntry[]> {
  const root = join(pluginDir, 'agents');
  const out: PluginAgentEntry[] = [];
  for (const file of await listFiles(root, '.md')) {
    const raw = await readText(join(root, file));
    if (!raw) continue;
    const { data, body } = parseFrontmatter(raw);
    const name = data.name?.trim() || file.replace(/\.md$/i, '');
    const entry: PluginAgentEntry = {
      name,
      description: data.description?.trim() || '',
      tools: parseListValue(data.tools ?? data['allowed-tools']),
      body,
      pluginId,
    };
    if (data.model?.trim()) entry.model = data.model.trim();
    out.push(entry);
  }
  return out;
}

/** MCP servers: `<dir>/.mcp.json` (Claude Code `{ mcpServers: { name: {...} } }`). */
export async function scanMcp(pluginDir: string, pluginId: string): Promise<PluginMcpEntry[]> {
  const raw = await readText(join(pluginDir, '.mcp.json'));
  if (!raw) return [];
  return parseMcpJson(raw, pluginId, pluginDir);
}

/** Exported for tests: parse a `.mcp.json` body into namespaced configs. */
export function parseMcpJson(raw: string, pluginId: string, pluginDir: string): PluginMcpEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (!servers || typeof servers !== 'object') return [];
  const out: PluginMcpEntry[] = [];
  for (const [serverName, def] of Object.entries(servers as Record<string, unknown>)) {
    if (!def || typeof def !== 'object') continue;
    const d = def as Record<string, unknown>;
    const command = typeof d.command === 'string' ? d.command : '';
    if (!command) continue; // stdio servers only (no remote URL transport yet)
    const args = Array.isArray(d.args)
      ? (d.args as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const env =
      d.env && typeof d.env === 'object'
        ? (Object.fromEntries(
            Object.entries(d.env as Record<string, unknown>).filter(
              ([, v]) => typeof v === 'string',
            ),
          ) as Record<string, string>)
        : undefined;
    // Namespaced id so plugin servers never collide with user servers.
    const safeServer = serverName.replace(/[^a-z0-9_-]/gi, '-').slice(0, 30);
    const config: McpServerConfig = {
      id: `plugin-${pluginId}-${safeServer}`.slice(0, 60),
      name: `${serverName} (plugin)`,
      command: substitutePluginRoot(command, pluginDir),
      args: args.map((a) => substitutePluginRoot(a, pluginDir)),
    };
    if (env) config.env = env;
    out.push({ serverName, config, pluginId });
  }
  return out;
}

/** Hooks: `<dir>/hooks/hooks.json`. */
export async function scanHooks(pluginDir: string, pluginId: string): Promise<HookEntry[]> {
  const raw = await readText(join(pluginDir, 'hooks', 'hooks.json'));
  if (!raw) return [];
  return parseHooksJson(raw, pluginId, pluginDir);
}

/** Exported for tests: parse a `hooks.json` body. Claude Code shape:
 *  `{ hooks: { <Event>: [ { matcher?, hooks: [ { type:"command", command } ] } ] } }` */
export function parseHooksJson(raw: string, pluginId: string, pluginDir: string): HookEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const root = (parsed as { hooks?: unknown }).hooks ?? parsed;
  if (!root || typeof root !== 'object') return [];
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries(root as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const g = group as Record<string, unknown>;
      const matcher = typeof g.matcher === 'string' ? g.matcher : undefined;
      const cmds = Array.isArray(g.hooks) ? g.hooks : [];
      for (const c of cmds) {
        if (!c || typeof c !== 'object') continue;
        const command = (c as { command?: unknown }).command;
        if (typeof command !== 'string' || !command.trim()) continue;
        const entry: HookEntry = {
          event,
          command: substitutePluginRoot(command, pluginDir),
          pluginId,
        };
        if (matcher) entry.matcher = matcher;
        out.push(entry);
      }
    }
  }
  return out;
}

/** Claude Code plugins reference their own root via ${CLAUDE_PLUGIN_ROOT}. */
function substitutePluginRoot(s: string, pluginDir: string): string {
  return s.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, pluginDir);
}

/** Parse a marketplace's `.claude-plugin/marketplace.json`. */
export function parseMarketplace(
  raw: string,
  marketplaceId: string,
): Array<{ name: string; description: string; source: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const plugins = (parsed as { plugins?: unknown }).plugins;
  if (!Array.isArray(plugins)) return [];
  const out: Array<{ name: string; description: string; source: string }> = [];
  for (const p of plugins) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;
    const source =
      typeof o.source === 'string' ? o.source : name; // default: subdir named after plugin
    out.push({
      name,
      description: typeof o.description === 'string' ? o.description : '',
      source,
    });
  }
  void marketplaceId;
  return out;
}
