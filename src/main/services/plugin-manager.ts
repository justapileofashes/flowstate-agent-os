// Owns the Claude Code-format plugin lifecycle: marketplaces (git/local),
// install/uninstall/enable, manifest + component scanning, and aggregation for
// consumers (skills, MCP, commands, agents, hooks). Filesystem layout:
//
//   <root>/marketplaces/<id>/   cloned git repos / registered local paths
//   <root>/installed/<id>/      installed plugin dirs
//   <root>/registry.json        source of truth (state + agent skill allowlist)
//
// Also discovers (read-only) plugins in ~/.claude/plugins and standalone skills
// in ~/.claude/skills, for zero-install compatibility.

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename, isAbsolute, join } from 'node:path';
import {
  parseMarketplace,
  readPluginManifest,
  scanAgents,
  scanCommands,
  scanHooks,
  scanMcp,
  scanSkills,
  scanStandaloneSkills,
  SAFE_ID_RE,
} from './plugin-scan';
import type {
  CommandEntry,
  HookEntry,
  InstalledPlugin,
  MarketplacePlugin,
  MarketplaceRef,
  PluginAgentEntry,
  PluginMcpEntry,
  PluginOrigin,
  SkillEntry,
} from './plugin-types';

interface PersistedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  origin: PluginOrigin;
  enabled: boolean;
  hooksConsent: boolean;
}

interface RegistryFile {
  marketplaces: MarketplaceRef[];
  plugins: PersistedPlugin[];
  /** State for read-only ~/.claude discoveries, keyed by synthetic id. */
  discovered: Record<string, { enabled: boolean; hooksConsent: boolean }>;
  agentSkills: Record<string, string[]>;
}

interface Aggregate {
  plugins: InstalledPlugin[];
  skills: SkillEntry[];
  commands: CommandEntry[];
  agents: PluginAgentEntry[];
  mcp: PluginMcpEntry[];
  hooks: HookEntry[];
}

const EMPTY_REGISTRY: RegistryFile = {
  marketplaces: [],
  plugins: [],
  discovered: {},
  agentSkills: {},
};

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/\.git$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'item'
  );
}

function isGitSource(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(s) || s.endsWith('.git');
}

function execGit(args: string[], timeoutMs: number): Promise<{ ok: boolean; err: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { windowsHide: true, timeout: timeoutMs }, (err) => {
      resolve(err ? { ok: false, err: err.message } : { ok: true, err: '' });
    });
  });
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export interface PluginManagerOpts {
  /** Root for marketplaces/installed/registry.json. */
  root: string;
  /** ~/.claude/plugins (read-only discovery). Omit to disable. */
  pluginsHome?: string;
  /** ~/.claude/skills (read-only standalone skills). Omit to disable. */
  skillsHome?: string;
}

export class PluginManager extends EventEmitter {
  private reg: RegistryFile = structuredClone(EMPTY_REGISTRY);
  private cache: Aggregate = { plugins: [], skills: [], commands: [], agents: [], mcp: [], hooks: [] };
  private readonly marketplacesDir: string;
  private readonly installedDir: string;
  private readonly registryPath: string;

  constructor(private readonly opts: PluginManagerOpts) {
    super();
    this.marketplacesDir = join(opts.root, 'marketplaces');
    this.installedDir = join(opts.root, 'installed');
    this.registryPath = join(opts.root, 'registry.json');
  }

  /** Read registry + scan everything. Call once at startup. */
  async load(): Promise<void> {
    await fs.mkdir(this.marketplacesDir, { recursive: true });
    await fs.mkdir(this.installedDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.registryPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RegistryFile>;
      this.reg = {
        marketplaces: parsed.marketplaces ?? [],
        plugins: parsed.plugins ?? [],
        discovered: parsed.discovered ?? {},
        agentSkills: parsed.agentSkills ?? {},
      };
    } catch {
      this.reg = structuredClone(EMPTY_REGISTRY);
    }
    await this.rebuild();
  }

  private async persist(): Promise<void> {
    await fs.writeFile(this.registryPath, JSON.stringify(this.reg, null, 2), 'utf8');
  }

  /** Re-scan all installed + discovered plugins into the component caches. */
  private async rebuild(): Promise<void> {
    const agg: Aggregate = { plugins: [], skills: [], commands: [], agents: [], mcp: [], hooks: [] };

    for (const p of this.reg.plugins) {
      await this.collect(p, join(this.installedDir, p.id), false, agg);
    }

    // Read-only ~/.claude/plugins discoveries (skip ids already installed).
    if (this.opts.pluginsHome) {
      for (const name of await listDirs(this.opts.pluginsHome)) {
        const id = `claude-home-${slug(name)}`;
        if (this.reg.plugins.some((x) => x.id === id)) continue;
        const dir = join(this.opts.pluginsHome, name);
        const manifest = await readPluginManifest(dir);
        const state = this.reg.discovered[id] ?? { enabled: true, hooksConsent: false };
        const persisted: PersistedPlugin = {
          id,
          name: manifest.name,
          version: manifest.version ?? '',
          description: manifest.description ?? '',
          origin: { kind: 'claude-home' },
          enabled: state.enabled,
          hooksConsent: state.hooksConsent,
        };
        await this.collect(persisted, dir, true, agg);
      }
    }

    // Standalone ~/.claude/skills — always available, no plugin entry.
    if (this.opts.skillsHome) {
      for (const s of await scanStandaloneSkills(this.opts.skillsHome)) {
        if (!agg.skills.some((x) => x.name === s.name)) agg.skills.push(s);
      }
    }

    this.cache = agg;
    this.emit('status', this.cache.plugins);
  }

  /** Scan one plugin dir, record an InstalledPlugin row, and (if enabled) feed
   *  its components into the aggregate. Hooks require explicit consent. */
  private async collect(
    p: PersistedPlugin,
    dir: string,
    readOnly: boolean,
    agg: Aggregate,
  ): Promise<void> {
    const [skills, commands, agents, mcp, hooks] = await Promise.all([
      scanSkills(dir, p.id),
      scanCommands(dir, p.id),
      scanAgents(dir, p.id),
      scanMcp(dir, p.id),
      scanHooks(dir, p.id),
    ]);

    agg.plugins.push({
      id: p.id,
      name: p.name,
      version: p.version,
      description: p.description,
      origin: p.origin,
      path: dir,
      enabled: p.enabled,
      hooksConsent: p.hooksConsent,
      readOnly,
      components: {
        skills: skills.length,
        commands: commands.length,
        agents: agents.length,
        mcp: mcp.length,
        hooks: hooks.length,
      },
    });

    if (!p.enabled) return;
    for (const s of skills) if (!agg.skills.some((x) => x.name === s.name)) agg.skills.push(s);
    agg.commands.push(...commands);
    agg.agents.push(...agents);
    agg.mcp.push(...mcp);
    if (p.hooksConsent) agg.hooks.push(...hooks);
  }

  // ── Aggregates (consumers) ───────────────────────────────────────────────
  list(): InstalledPlugin[] {
    return this.cache.plugins;
  }
  skills(): SkillEntry[] {
    return this.cache.skills;
  }
  commands(): CommandEntry[] {
    return this.cache.commands;
  }
  agents(): PluginAgentEntry[] {
    return this.cache.agents;
  }
  mcpConfigs(): PluginMcpEntry[] {
    return this.cache.mcp;
  }
  hooks(): HookEntry[] {
    return this.cache.hooks;
  }

  // ── Agent skill allowlist ────────────────────────────────────────────────
  getAgentSkills(agentId: string): string[] | null {
    return this.reg.agentSkills[agentId] ?? null;
  }
  async setAgentSkills(agentId: string, names: string[]): Promise<void> {
    this.reg.agentSkills[agentId] = names;
    await this.persist();
  }

  // ── Marketplaces ─────────────────────────────────────────────────────────
  listMarketplaces(): MarketplaceRef[] {
    return this.reg.marketplaces;
  }

  async addMarketplace(source: string): Promise<MarketplaceRef> {
    const trimmed = source.trim();
    if (!trimmed) throw new Error('Marketplace source is empty.');

    let path: string;
    let tmpClone = '';
    if (isGitSource(trimmed)) {
      // Clone to a temp dir first so we can read its name before final placement.
      tmpClone = join(this.marketplacesDir, `_clone-${Date.now()}`);
      const res = await execGit(['clone', '--depth', '1', trimmed, tmpClone], 60_000);
      if (!res.ok) throw new Error(`git clone failed: ${res.err}`);
      path = tmpClone;
    } else {
      if (!isAbsolute(trimmed)) throw new Error('Local marketplace path must be absolute.');
      await fs.access(trimmed); // throws if missing
      path = trimmed;
    }

    // Prefer the marketplace.json `name` for the id; fall back to the basename.
    const manifestPath = await this.marketplaceManifestPath(path);
    let id = slug(basename(trimmed));
    if (manifestPath) {
      try {
        const name = (JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { name?: unknown })
          .name;
        if (typeof name === 'string' && name.trim()) id = slug(name);
      } catch {
        /* keep basename id */
      }
    }
    if (this.reg.marketplaces.some((m) => m.id === id)) {
      if (tmpClone) await fs.rm(tmpClone, { recursive: true, force: true }).catch(() => {});
      throw new Error(`A marketplace named "${id}" already exists.`);
    }
    // Move the clone into its final id-named home.
    if (tmpClone) {
      path = join(this.marketplacesDir, id);
      await fs.rename(tmpClone, path);
    }

    const ref: MarketplaceRef = {
      id,
      name: id,
      source: trimmed,
      path,
      addedAt: Date.now(),
    };
    this.reg.marketplaces.push(ref);
    await this.persist();
    this.emit('status', this.cache.plugins);
    return ref;
  }

  async refreshMarketplace(id: string): Promise<void> {
    const m = this.reg.marketplaces.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown marketplace: ${id}`);
    if (isGitSource(m.source)) {
      const res = await execGit(['-C', m.path, 'pull', '--ff-only'], 60_000);
      if (!res.ok) throw new Error(`git pull failed: ${res.err}`);
    }
  }

  async removeMarketplace(id: string): Promise<void> {
    const m = this.reg.marketplaces.find((x) => x.id === id);
    if (!m) return;
    this.reg.marketplaces = this.reg.marketplaces.filter((x) => x.id !== id);
    // Only delete clones we own (inside marketplacesDir); never a user's local dir.
    if (m.path.startsWith(this.marketplacesDir)) {
      await fs.rm(m.path, { recursive: true, force: true }).catch(() => {});
    }
    await this.persist();
    this.emit('status', this.cache.plugins);
  }

  /** Find a marketplace's manifest file (root or .claude-plugin/). */
  private async marketplaceManifestPath(path: string): Promise<string | null> {
    for (const p of [
      join(path, '.claude-plugin', 'marketplace.json'),
      join(path, 'marketplace.json'),
    ]) {
      try {
        await fs.access(p);
        return p;
      } catch {
        /* next */
      }
    }
    return null;
  }

  async browse(query?: string): Promise<MarketplacePlugin[]> {
    const q = query?.trim().toLowerCase();
    const out: MarketplacePlugin[] = [];
    for (const m of this.reg.marketplaces) {
      const manifestPath = await this.marketplaceManifestPath(m.path);
      if (!manifestPath) continue;
      let raw: string;
      try {
        raw = await fs.readFile(manifestPath, 'utf8');
      } catch {
        continue;
      }
      for (const p of parseMarketplace(raw, m.id)) {
        const installedId = `${m.id}-${slug(p.name)}`;
        out.push({
          marketplaceId: m.id,
          name: p.name,
          description: p.description,
          source: p.source,
          installed: this.reg.plugins.some((x) => x.id === installedId),
        });
      }
    }
    return q
      ? out.filter((p) => (p.name + ' ' + p.description).toLowerCase().includes(q))
      : out;
  }

  // ── Install / uninstall ──────────────────────────────────────────────────
  async install(marketplaceId: string, pluginName: string): Promise<InstalledPlugin> {
    const m = this.reg.marketplaces.find((x) => x.id === marketplaceId);
    if (!m) throw new Error(`Unknown marketplace: ${marketplaceId}`);
    const manifestPath = await this.marketplaceManifestPath(m.path);
    if (!manifestPath) throw new Error(`Marketplace ${marketplaceId} has no marketplace.json`);
    const entry = parseMarketplace(await fs.readFile(manifestPath, 'utf8'), m.id).find(
      (p) => p.name === pluginName,
    );
    if (!entry) throw new Error(`Plugin "${pluginName}" not found in ${marketplaceId}`);

    const id = `${m.id}-${slug(pluginName)}`;
    let srcDir: string;
    if (isGitSource(entry.source)) {
      srcDir = join(this.marketplacesDir, `${id}-src`);
      await fs.rm(srcDir, { recursive: true, force: true }).catch(() => {});
      const res = await execGit(['clone', '--depth', '1', entry.source, srcDir], 60_000);
      if (!res.ok) throw new Error(`git clone failed: ${res.err}`);
    } else {
      // Relative path within the marketplace repo.
      srcDir = isAbsolute(entry.source) ? entry.source : join(m.path, entry.source);
    }
    return this.installFromDir(srcDir, id, { kind: 'marketplace', marketplaceId: m.id });
  }

  async installLocal(path: string): Promise<InstalledPlugin> {
    if (!isAbsolute(path)) throw new Error('Plugin path must be absolute.');
    await fs.access(path);
    const id = `local-${slug(basename(path))}`;
    return this.installFromDir(path, id, { kind: 'local' });
  }

  private async installFromDir(
    srcDir: string,
    id: string,
    origin: PluginOrigin,
  ): Promise<InstalledPlugin> {
    if (!SAFE_ID_RE.test(id)) throw new Error(`Unsafe plugin id: ${id}`);
    const dest = join(this.installedDir, id);
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    await fs.cp(srcDir, dest, { recursive: true });

    const manifest = await readPluginManifest(dest);
    this.reg.plugins = this.reg.plugins.filter((p) => p.id !== id);
    this.reg.plugins.push({
      id,
      name: manifest.name,
      version: manifest.version ?? '',
      description: manifest.description ?? '',
      origin,
      enabled: true,
      hooksConsent: false,
    });
    await this.persist();
    await this.rebuild();
    const installed = this.cache.plugins.find((p) => p.id === id);
    if (!installed) throw new Error('Install succeeded but plugin did not scan.');
    return installed;
  }

  async uninstall(id: string): Promise<void> {
    const p = this.reg.plugins.find((x) => x.id === id);
    if (!p) throw new Error(`Not installed (or read-only): ${id}`);
    this.reg.plugins = this.reg.plugins.filter((x) => x.id !== id);
    delete this.reg.agentSkills[id];
    await fs.rm(join(this.installedDir, id), { recursive: true, force: true }).catch(() => {});
    await this.persist();
    await this.rebuild();
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const p = this.reg.plugins.find((x) => x.id === id);
    if (p) {
      p.enabled = enabled;
    } else {
      // Read-only discovery — track state separately.
      const cur = this.reg.discovered[id] ?? { enabled: true, hooksConsent: false };
      this.reg.discovered[id] = { ...cur, enabled };
    }
    await this.persist();
    await this.rebuild();
  }

  async setHooksConsent(id: string, consent: boolean): Promise<void> {
    const p = this.reg.plugins.find((x) => x.id === id);
    if (p) {
      p.hooksConsent = consent;
    } else {
      const cur = this.reg.discovered[id] ?? { enabled: true, hooksConsent: false };
      this.reg.discovered[id] = { ...cur, hooksConsent: consent };
    }
    await this.persist();
    await this.rebuild();
  }
}
