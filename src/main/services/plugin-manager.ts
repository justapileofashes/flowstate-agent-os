// Owns the Claude Code-format plugin lifecycle: marketplaces (git/local),
// install/uninstall/enable, manifest + component scanning, and aggregation for
// consumers (skills, MCP, commands, agents, hooks). Filesystem layout:
//
//   <root>/marketplaces/<id>/   cloned git repos / registered local paths
//   <root>/installed/<id>/      installed plugin dirs
//   <root>/registry.json        source of truth (state + agent skill allowlist)
//
// Also discovers (read-only) plugins in ~/.claude/plugins, and skills in
// ~/.claude/skills plus other coding agents' skill folders (toggle per
// source), for zero-install compatibility. `installFrom` takes GitHub
// shorthand, git URLs, folders and zip/.plugin/.skill archives.

import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { discoverClaudeCodePlugins, discoverPluginDirs } from './plugin-discovery';
import {
  parseMarketplace,
  readPluginManifest,
  readSkillDir,
  scanAgents,
  scanCommands,
  scanHooks,
  scanMcp,
  scanSkills,
  SAFE_ID_RE,
} from './plugin-scan';
import {
  detectContent,
  extractArchive,
  findSkillDirs,
  isArchive,
  parseInstallSource,
  unwrapSingleDir,
  type SkillSourceDef,
} from './plugin-sources';
import type {
  CommandEntry,
  HookEntry,
  InstallFromResult,
  InstalledPlugin,
  MarketplacePlugin,
  MarketplaceRef,
  PluginAgentEntry,
  PluginMcpEntry,
  PluginOrigin,
  SkillEntry,
  SkillSourceInfo,
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
  /** On/off per skill source (knownSkillSources ids); unset = its default. */
  skillSources: Record<string, boolean>;
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
  skillSources: {},
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

interface GitResult {
  ok: boolean;
  /** git's own error output (progress lines dropped), or the spawn error. */
  err: string;
  timedOut: boolean;
}

/**
 * Run git without ever blocking on a credential prompt (terminal or Git
 * Credential Manager). Transfers slower than 1 KB/s for 30 s abort instead of
 * hanging. On timeout the whole process tree is killed: on Windows `git` is a
 * launcher, and killing only it leaves the real git + git-remote-https
 * running and holding the target folder.
 */
function execGit(args: string[], timeoutMs: number): Promise<GitResult> {
  return new Promise((resolve) => {
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const child = spawn('git', ['-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=30', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d: string) => {
      stderr = (stderr + d).slice(-8000);
    });
    const done = (r: GitResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on(
          'error',
          () => child.kill(),
        );
      } else {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    child.on('error', (err) => done({ ok: false, err: err.message, timedOut: false }));
    child.on('close', (code) => {
      const message = stderr
        .split(/\r?\n/)
        .filter((l) => l.trim() && !/^Cloning into /.test(l))
        .join('\n');
      done(code === 0 && !timedOut ? { ok: true, err: '', timedOut: false } : { ok: false, err: message, timedOut });
    });
  });
}

function gitError(res: GitResult, url: string): Error {
  const err = res.err;
  if (res.timedOut || /Operation too slow|timed out/i.test(err)) {
    return new Error(`Timed out downloading ${url}. The network may be slow or GitHub unreachable — try again.`);
  }
  if (/ENOENT/.test(err)) return new Error('Git is not installed. Install Git for Windows (git-scm.com) and try again.');
  if (/Remote branch .* not found/i.test(err)) return new Error(`That branch or tag doesn't exist in ${url}`);
  if (
    /not found|does not exist|not appear to be a git repository|Could not read from remote|could not read Username|Authentication failed|terminal prompts disabled/i.test(
      err,
    )
  ) {
    return new Error(`Repository not found, or it's private: ${url}`);
  }
  return new Error(`git clone failed: ${err.slice(-400) || 'unknown error'}`);
}

/** Worth one more try: a stall or dropped connection, not a missing repo. */
function isTransientGitFailure(res: GitResult): boolean {
  if (res.timedOut) return true;
  return /Operation too slow|timed out|early EOF|RPC failed|Could not resolve host|Connection (reset|refused|was reset)|unexpected disconnect|SSL|TLS/i.test(
    res.err,
  );
}

/** Shallow clone (retried once on a stall); a commit SHA ref falls back to a
 *  full clone + checkout. */
async function cloneRepo(url: string, ref: string | undefined, dest: string): Promise<void> {
  const args = ['clone', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', url, dest];
  let res = await execGit(args, 90_000);
  if (!res.ok && isTransientGitFailure(res)) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    res = await execGit(args, 90_000);
  }
  if (res.ok) return;
  if (ref && /^[0-9a-f]{7,40}$/i.test(ref)) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    const full = await execGit(['clone', '--', url, dest], 300_000);
    if (!full.ok) throw gitError(full, url);
    const co = await execGit(['-C', dest, 'checkout', ref], 60_000);
    if (!co.ok) throw new Error(`git checkout ${ref} failed: ${co.err.slice(-300)}`);
    return;
  }
  throw gitError(res, url);
}

async function isDir(p: string): Promise<boolean> {
  return fs.stat(p).then((s) => s.isDirectory(), () => false);
}

/** Copy a tree, skipping VCS metadata. */
function copyTree(src: string, dest: string): Promise<void> {
  return fs.cp(src, dest, {
    recursive: true,
    filter: (s) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(s.slice(src.length)),
  });
}

function idFor(prefix: string, name: string): string {
  return `${prefix}-${slug(name)}`.slice(0, 41).replace(/-+$/, '');
}

export interface PluginManagerOpts {
  /** Root for marketplaces/installed/registry.json. */
  root: string;
  /** ~/.claude — Claude Code's installed plugins are discovered read-only. Omit to disable. */
  claudeHome?: string;
  /** ~/.claude/skills (read-only standalone skills). Omit to disable. */
  skillsHome?: string;
  /** Skill folders to discover read-only (see knownSkillSources). Overrides skillsHome. */
  skillSources?: SkillSourceDef[];
}

/** Id for a read-only discovery; keyed by the tool's own plugin key. */
function discoveredId(key: string): string {
  return `claude-home-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)}`;
}

export class PluginManager extends EventEmitter {
  private reg: RegistryFile = structuredClone(EMPTY_REGISTRY);
  private cache: Aggregate = { plugins: [], skills: [], commands: [], agents: [], mcp: [], hooks: [] };
  private sourceInfo: SkillSourceInfo[] = [];
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
        skillSources: parsed.skillSources ?? {},
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

    // Read-only discoveries: plugins Claude Code has installed (skip ids
    // already installed here). Enabled state mirrors Claude Code's until the
    // user toggles it in Flowstate.
    if (this.opts.claudeHome) {
      const found =
        (await discoverClaudeCodePlugins(this.opts.claudeHome)) ??
        (await discoverPluginDirs(join(this.opts.claudeHome, 'plugins')));
      for (const d of found) {
        const id = discoveredId(d.key);
        if (this.reg.plugins.some((x) => x.id === id)) continue;
        const manifest = await readPluginManifest(d.dir);
        const state = this.reg.discovered[id] ?? { enabled: d.defaultEnabled, hooksConsent: false };
        const persisted: PersistedPlugin = {
          id,
          // A versioned cache dir makes a poor fallback name; prefer the key's.
          name: manifest.name === basename(d.dir) ? d.name : manifest.name,
          version: manifest.version ?? d.version,
          description: manifest.description ?? '',
          origin: { kind: 'claude-home', source: d.source },
          enabled: state.enabled,
          hooksConsent: state.hooksConsent,
        };
        await this.collect(persisted, d.dir, true, agg);
      }
    }

    // Standalone skill folders (~/.claude/skills, other agents') — read-only,
    // no plugin entry. Scanned even when off so the UI can show counts.
    const infos: SkillSourceInfo[] = [];
    for (const src of this.skillSourceDefs()) {
      const enabled = this.reg.skillSources[src.id] ?? src.defaultEnabled;
      const paths: string[] = [];
      const found: SkillEntry[] = [];
      for (const root of src.roots) {
        const dirs = await findSkillDirs(root, 3);
        if (!dirs.length) continue;
        paths.push(root);
        for (const d of dirs) {
          const s = await readSkillDir(d, null, src.label);
          if (s) found.push(s);
        }
      }
      if (!paths.length) continue; // only list sources that hold skills here
      infos.push({ id: src.id, label: src.label, paths, count: found.length, enabled });
      if (!enabled) continue;
      for (const s of found) if (!agg.skills.some((x) => x.name === s.name)) agg.skills.push(s);
    }

    this.sourceInfo = infos;
    this.cache = agg;
    this.emit('status', this.cache.plugins);
  }

  private skillSourceDefs(): SkillSourceDef[] {
    if (this.opts.skillSources) return this.opts.skillSources;
    return this.opts.skillsHome
      ? [{ id: 'claude', label: 'Claude Code', roots: [this.opts.skillsHome], defaultEnabled: true }]
      : [];
  }

  // ── Skill sources (other tools' folders) ─────────────────────────────────
  listSkillSources(): SkillSourceInfo[] {
    return this.sourceInfo;
  }

  async setSkillSourceEnabled(id: string, enabled: boolean): Promise<void> {
    if (!this.skillSourceDefs().some((s) => s.id === id)) throw new Error(`Unknown skill source: ${id}`);
    this.reg.skillSources[id] = enabled;
    await this.persist();
    await this.rebuild();
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
    // MCP servers are local processes too: for plugins merely discovered on
    // disk (not installed here) they need the same consent as hooks.
    if (!readOnly || p.hooksConsent) agg.mcp.push(...mcp);
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
  /** `null` lifts the restriction (the agent sees every enabled skill). */
  async setAgentSkills(agentId: string, names: string[] | null): Promise<void> {
    if (names === null) delete this.reg.agentSkills[agentId];
    else this.reg.agentSkills[agentId] = names;
    await this.persist();
  }

  // ── Marketplaces ─────────────────────────────────────────────────────────
  listMarketplaces(): MarketplaceRef[] {
    return this.reg.marketplaces;
  }

  async addMarketplace(source: string): Promise<MarketplaceRef> {
    const trimmed = source.trim();
    if (!trimmed) throw new Error('Marketplace source is empty.');

    if (isGitSource(trimmed)) {
      // Clone to a temp dir first so we can read its name before final placement.
      const tmpClone = join(this.marketplacesDir, `_clone-${Date.now()}`);
      await cloneRepo(trimmed, undefined, tmpClone);
      return this.registerMarketplace({ dir: tmpClone, source: trimmed, ownedRoot: tmpClone });
    }
    if (!isAbsolute(trimmed)) throw new Error('Local marketplace path must be absolute.');
    await fs.access(trimmed); // throws if missing
    return this.registerMarketplace({ dir: trimmed, source: trimmed });
  }

  /**
   * Register a marketplace at `dir`. When `ownedRoot` is given it's a temp
   * folder Flowstate owns (a clone or extracted archive) containing `dir`; it
   * is moved under marketplacesDir. Otherwise `dir` is the user's own folder
   * and is used in place.
   */
  private async registerMarketplace(o: { dir: string; source: string; ownedRoot?: string }): Promise<MarketplaceRef> {
    // Prefer the marketplace.json `name` for the id; fall back to the basename.
    const manifestPath = await this.marketplaceManifestPath(o.dir);
    let id = slug(basename(o.source.replace(/[#?].*$/, '')));
    if (manifestPath) {
      try {
        const name = (JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { name?: unknown }).name;
        if (typeof name === 'string' && name.trim()) id = slug(name);
      } catch {
        /* keep basename id */
      }
    }
    if (this.reg.marketplaces.some((m) => m.id === id)) {
      if (o.ownedRoot) await fs.rm(o.ownedRoot, { recursive: true, force: true }).catch(() => {});
      throw new Error(`A marketplace named "${id}" already exists.`);
    }
    let path = o.dir;
    let root: string | undefined;
    if (o.ownedRoot) {
      // Move into its final id-named home, keeping any sub-folder.
      const home = join(this.marketplacesDir, id);
      await fs.rm(home, { recursive: true, force: true }).catch(() => {});
      await fs.rename(o.ownedRoot, home);
      const sub = relative(o.ownedRoot, o.dir);
      path = sub ? join(home, sub) : home;
      if (sub) root = home;
    }

    const ref: MarketplaceRef = { id, name: id, source: o.source, path, addedAt: Date.now() };
    if (root) ref.root = root;
    this.reg.marketplaces.push(ref);
    await this.persist();
    this.emit('status', this.cache.plugins);
    return ref;
  }

  /**
   * One box for everything: GitHub `owner/repo[/sub/folder][#ref]`, a GitHub
   * or git URL, a folder, or a .zip/.plugin/.skill archive. Works out whether
   * it holds a marketplace (added), a plugin (installed) or SKILL.md skills
   * (installed as one toggleable bundle).
   */
  async installFrom(input: string): Promise<InstallFromResult> {
    const src = parseInstallSource(input);
    const staging = join(this.opts.root, '_staging', `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.mkdir(staging, { recursive: true });
    try {
      let base: string;
      let ownedRoot: string | undefined;
      let origin: PluginOrigin;
      let label = src.label;
      if (src.kind === 'git') {
        const clone = join(staging, 'repo');
        await cloneRepo(src.url, src.ref, clone);
        base = clone;
        ownedRoot = clone;
        origin = { kind: 'git', source: input.trim() };
      } else {
        const st = await fs.stat(src.path).catch(() => null);
        if (!st) throw new Error(`Not found: ${src.path}`);
        origin = { kind: 'local', source: src.path };
        if (st.isDirectory()) {
          base = src.path;
        } else if (isArchive(src.path)) {
          const out = join(staging, 'unpacked');
          await extractArchive(src.path, out);
          base = await unwrapSingleDir(out);
          ownedRoot = out;
          label = basename(src.path).replace(/\.(zip|plugin|skill)$/i, '');
        } else if (basename(src.path).toLowerCase() === 'skill.md') {
          base = dirname(src.path);
          label = basename(base);
        } else {
          throw new Error('Pick a folder, a SKILL.md, or a .zip / .plugin / .skill file.');
        }
      }
      const root = src.kind === 'git' && src.subpath ? join(base, ...src.subpath.split('/')) : base;
      if (!(await isDir(root))) throw new Error(`"${src.kind === 'git' ? src.subpath : root}" isn't a folder in ${src.label}.`);

      const found = await detectContent(root);
      if (found.type === 'marketplace') {
        const ref =
          src.kind === 'git'
            ? await this.registerMarketplace({ dir: root, source: src.url, ownedRoot: ownedRoot! })
            : ownedRoot
              ? await this.registerMarketplace({ dir: root, source: src.path, ownedRoot })
              : await this.registerMarketplace({ dir: root, source: root });
        return { kind: 'marketplace', id: ref.id, name: ref.name, skills: 0 };
      }
      if (found.type === 'plugin') {
        const manifest = await readPluginManifest(root);
        // No plugin.json → the manifest name is just the folder (e.g. the clone dir).
        const name = manifest.name === basename(root) ? label.split('/').pop()! : manifest.name;
        const id = idFor(src.kind === 'git' ? 'gh' : 'local', name);
        const p = await this.installFromDir(root, id, origin, name);
        return { kind: 'plugin', id: p.id, name: p.name, skills: p.components.skills };
      }
      if (found.type === 'skills') {
        const p = await this.installSkillBundle(found.dirs, label, origin);
        return { kind: 'skills', id: p.id, name: p.name, skills: p.components.skills };
      }
      throw new Error(`No plugin, marketplace or SKILL.md found in ${src.label}.`);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Loose SKILL.md folders become one plugin (skills/<name>/…) so they can be
   *  toggled and uninstalled like any other. */
  private async installSkillBundle(dirs: string[], label: string, origin: PluginOrigin): Promise<InstalledPlugin> {
    const id = idFor('skills', label);
    if (!SAFE_ID_RE.test(id)) throw new Error(`Unsafe plugin id: ${id}`);
    const dest = join(this.installedDir, id);
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(join(dest, 'skills'), { recursive: true });
    const used = new Set<string>();
    let copied = 0;
    for (const dir of dirs) {
      const entry = await readSkillDir(dir, null);
      if (!entry) continue; // no description → never triggers
      let folder = slug(entry.name);
      for (let n = 2; used.has(folder); n++) folder = `${slug(entry.name)}-${n}`;
      used.add(folder);
      await copyTree(dir, join(dest, 'skills', folder));
      copied++;
    }
    if (!copied) {
      await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
      throw new Error('Found SKILL.md files, but none has a description in its frontmatter, so none could be used.');
    }
    const description = `${copied} skill${copied === 1 ? '' : 's'} from ${label}`;
    await fs.mkdir(join(dest, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      join(dest, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: label, description }, null, 2),
      'utf8',
    );
    return this.registerInstalled(id, dest, origin);
  }

  async refreshMarketplace(id: string): Promise<void> {
    const m = this.reg.marketplaces.find((x) => x.id === id);
    if (!m) throw new Error(`Unknown marketplace: ${id}`);
    if (isGitSource(m.source)) {
      const res = await execGit(['-C', m.path, 'pull', '--ff-only'], 60_000);
      if (!res.ok) throw new Error(res.timedOut ? 'git pull timed out — try again.' : `git pull failed: ${res.err.slice(-400)}`);
    }
  }

  async removeMarketplace(id: string): Promise<void> {
    const m = this.reg.marketplaces.find((x) => x.id === id);
    if (!m) return;
    this.reg.marketplaces = this.reg.marketplaces.filter((x) => x.id !== id);
    // Only delete clones we own (inside marketplacesDir); never a user's local dir.
    const owned = m.root ?? m.path;
    if (owned.startsWith(this.marketplacesDir)) {
      await fs.rm(owned, { recursive: true, force: true }).catch(() => {});
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
      await cloneRepo(entry.source, undefined, srcDir);
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
    return this.installFromDir(path, id, { kind: 'local', source: path });
  }

  private async installFromDir(
    srcDir: string,
    id: string,
    origin: PluginOrigin,
    fallbackName?: string,
  ): Promise<InstalledPlugin> {
    if (!SAFE_ID_RE.test(id)) throw new Error(`Unsafe plugin id: ${id}`);
    const dest = join(this.installedDir, id);
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {});
    await copyTree(srcDir, dest);
    return this.registerInstalled(id, dest, origin, fallbackName ?? basename(srcDir));
  }

  /** Record an installed plugin dir in the registry and re-scan. */
  private async registerInstalled(
    id: string,
    dest: string,
    origin: PluginOrigin,
    fallbackName?: string,
  ): Promise<InstalledPlugin> {
    const manifest = await readPluginManifest(dest);
    // No plugin.json → the manifest name is just the dir (the id); prefer the source's name.
    const name = fallbackName && manifest.name === basename(dest) ? fallbackName : manifest.name;
    this.reg.plugins = this.reg.plugins.filter((p) => p.id !== id);
    this.reg.plugins.push({
      id,
      name,
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
