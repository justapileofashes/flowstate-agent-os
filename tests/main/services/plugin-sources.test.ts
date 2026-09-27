import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { strToU8, zipSync } from 'fflate';
import {
  detectContent,
  extractArchive,
  findSkillDirs,
  parseInstallSource,
  safeEntryPath,
  unwrapSingleDir,
} from '@main/services/plugin-sources';
import { PluginManager } from '@main/services/plugin-manager';
import { SkillRegistry } from '@main/services/skill-registry';

const skillMd = (name: string, description = `${name} does things`): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\nBody of ${name}\n`;

async function write(path: string, text: string): Promise<void> {
  await fs.mkdir(join(path, '..'), { recursive: true });
  await fs.writeFile(path, text, 'utf8');
}

describe('parseInstallSource', () => {
  it('reads GitHub shorthand with sub-folders and refs', () => {
    expect(parseInstallSource('anthropics/skills')).toEqual({
      kind: 'git',
      url: 'https://github.com/anthropics/skills.git',
      label: 'anthropics/skills',
    });
    expect(parseInstallSource('anthropics/skills/skills/pdf#main')).toEqual({
      kind: 'git',
      url: 'https://github.com/anthropics/skills.git',
      subpath: 'skills/pdf',
      ref: 'main',
      label: 'anthropics/skills/skills/pdf',
    });
  });

  it('reads GitHub tree and blob links', () => {
    expect(parseInstallSource('https://github.com/o/r/tree/dev/skills/x')).toMatchObject({
      url: 'https://github.com/o/r.git',
      ref: 'dev',
      subpath: 'skills/x',
    });
    // A link to the SKILL.md file means its folder.
    expect(parseInstallSource('https://github.com/o/r/blob/main/skills/x/SKILL.md')).toMatchObject({
      ref: 'main',
      subpath: 'skills/x',
    });
    expect(parseInstallSource('https://github.com/o/r.git')).toMatchObject({ url: 'https://github.com/o/r.git' });
  });

  it('keeps other git URLs, with an optional #ref', () => {
    expect(parseInstallSource('https://gitlab.com/g/p.git#v1.2')).toMatchObject({
      kind: 'git',
      url: 'https://gitlab.com/g/p.git',
      ref: 'v1.2',
    });
    expect(parseInstallSource('git@github.com:o/r.git')).toMatchObject({ kind: 'git', url: 'git@github.com:o/r.git' });
  });

  it('treats absolute paths as local sources', () => {
    expect(parseInstallSource('C:\\Users\\me\\skills.zip')).toMatchObject({ kind: 'path', label: 'skills.zip' });
    expect(parseInstallSource('"D:\\x\\my plugin"')).toMatchObject({ kind: 'path' });
  });

  it('rejects unsafe or ambiguous input', () => {
    expect(() => parseInstallSource('')).toThrow();
    expect(() => parseInstallSource('--upload-pack=evil')).toThrow(/can't start with "-"/);
    expect(() => parseInstallSource('o/r/../../etc')).toThrow(/"\.\."/);
    expect(() => parseInstallSource('o/r#--evil')).toThrow(/valid branch/);
    expect(() => parseInstallSource('./relative')).toThrow(/absolute/);
    expect(() => parseInstallSource('just-a-word')).toThrow();
  });
});

describe('archives', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'fs-src-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('refuses entries that escape the destination', () => {
    const dest = join(dir, 'out');
    expect(safeEntryPath(dest, 'a/b.txt')).toBe(join(dest, 'a', 'b.txt'));
    expect(safeEntryPath(dest, '../evil.txt')).toBeNull();
    expect(safeEntryPath(dest, 'a/../../evil.txt')).toBeNull();
    expect(safeEntryPath(dest, '/abs.txt')).toBeNull();
    expect(safeEntryPath(dest, 'C:/abs.txt')).toBeNull();
    expect(safeEntryPath(dest, '..\\evil.txt')).toBeNull();
  });

  it('extracts a zip and unwraps its single top folder', async () => {
    const zip = zipSync({ 'my-skill/SKILL.md': strToU8(skillMd('my-skill')), 'my-skill/ref/notes.md': strToU8('n') });
    const archive = join(dir, 'my-skill.skill');
    await fs.writeFile(archive, zip);
    const out = join(dir, 'out');
    await extractArchive(archive, out);
    const root = await unwrapSingleDir(out);
    expect(root).toBe(join(out, 'my-skill'));
    expect(await fs.readFile(join(root, 'ref', 'notes.md'), 'utf8')).toBe('n');
  });

  it('refuses a zip-slip archive', async () => {
    const archive = join(dir, 'evil.zip');
    await fs.writeFile(archive, zipSync({ '../outside.txt': strToU8('x') }));
    await expect(extractArchive(archive, join(dir, 'out'))).rejects.toThrow(/outside the install folder/);
    await expect(fs.access(join(dir, 'outside.txt'))).rejects.toThrow();
  });

  it('reports a non-zip file clearly', async () => {
    const bad = join(dir, 'bad.zip');
    await fs.writeFile(bad, 'not a zip');
    await expect(extractArchive(bad, join(dir, 'out'))).rejects.toThrow(/Not a readable zip/);
  });
});

describe('detectContent / findSkillDirs', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'fs-detect-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('tells marketplaces, plugins and skill collections apart', async () => {
    await write(join(dir, 'm', '.claude-plugin', 'marketplace.json'), '{"name":"m","plugins":[]}');
    await write(join(dir, 'p', '.claude-plugin', 'plugin.json'), '{"name":"p"}');
    await write(join(dir, 'bare', 'commands', 'go.md'), 'go');
    await write(join(dir, 's', 'skills', 'a', 'SKILL.md'), skillMd('a'));
    await write(join(dir, 's', 'other', 'deep', 'b', 'SKILL.md'), skillMd('b'));
    await write(join(dir, 's', 'node_modules', 'x', 'SKILL.md'), skillMd('x'));
    await fs.mkdir(join(dir, 'empty'));

    expect((await detectContent(join(dir, 'm'))).type).toBe('marketplace');
    expect((await detectContent(join(dir, 'p'))).type).toBe('plugin');
    expect((await detectContent(join(dir, 'bare'))).type).toBe('plugin');
    const s = await detectContent(join(dir, 's'));
    expect(s.type).toBe('skills');
    expect(s.type === 'skills' ? s.dirs : []).toEqual([
      join(dir, 's', 'other', 'deep', 'b'),
      join(dir, 's', 'skills', 'a'),
    ]);
    expect((await detectContent(join(dir, 'empty'))).type).toBe('none');
  });

  it('does not descend into a skill folder', async () => {
    await write(join(dir, 'top', 'SKILL.md'), skillMd('top'));
    await write(join(dir, 'top', 'examples', 'SKILL.md'), skillMd('nested'));
    expect(await findSkillDirs(dir)).toEqual([join(dir, 'top')]);
  });
});

describe('PluginManager.installFrom (local sources)', () => {
  let dir: string;
  let pm: PluginManager;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'fs-install-'));
    pm = new PluginManager({ root: join(dir, 'root') });
    await pm.load();
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('installs loose skills from a folder as one toggleable bundle', async () => {
    const src = join(dir, 'my-skills');
    await write(join(src, 'one', 'SKILL.md'), skillMd('one'));
    await write(join(src, 'group', 'two', 'SKILL.md'), skillMd('two'));
    await write(join(src, 'group', 'undescribed', 'SKILL.md'), '# no frontmatter');

    const r = await pm.installFrom(src);
    expect(r).toMatchObject({ kind: 'skills', name: 'my-skills', skills: 2 });
    expect(pm.skills().map((s) => s.name).sort()).toEqual(['one', 'two']);
    const plugin = pm.list().find((p) => p.id === r.id)!;
    expect(plugin.origin).toEqual({ kind: 'local', source: src });

    await pm.setEnabled(r.id, false);
    expect(pm.skills()).toEqual([]);
    await pm.uninstall(r.id);
    expect(pm.list()).toEqual([]);
  });

  it('installs a .skill archive', async () => {
    const archive = join(dir, 'pdf-tools.skill');
    await fs.writeFile(archive, zipSync({ 'pdf-tools/SKILL.md': strToU8(skillMd('pdf-tools')) }));
    const r = await pm.installFrom(archive);
    expect(r).toMatchObject({ kind: 'skills', name: 'pdf-tools', skills: 1 });
    expect(pm.skills()[0]!.name).toBe('pdf-tools');
    // The staging folder is cleaned up.
    expect(await fs.readdir(join(dir, 'root', '_staging'))).toEqual([]);
  });

  it('installs a plugin from a zip, keeping its manifest name', async () => {
    const archive = join(dir, 'plug.zip');
    await fs.writeFile(
      archive,
      zipSync({
        'plug/.claude-plugin/plugin.json': strToU8('{"name":"Nice Plugin","version":"1.0.0"}'),
        'plug/skills/s1/SKILL.md': strToU8(skillMd('s1')),
        'plug/commands/hi.md': strToU8('say hi'),
      }),
    );
    const r = await pm.installFrom(archive);
    expect(r).toMatchObject({ kind: 'plugin', name: 'Nice Plugin', skills: 1, id: 'local-nice-plugin' });
    expect(pm.commands().map((c) => c.name)).toEqual(['hi']);
  });

  it('registers a local marketplace folder in place', async () => {
    const mk = join(dir, 'market');
    await write(join(mk, '.claude-plugin', 'marketplace.json'), '{"name":"My Market","plugins":[{"name":"x","source":"./x"}]}');
    const r = await pm.installFrom(mk);
    expect(r).toMatchObject({ kind: 'marketplace', id: 'my-market' });
    expect(pm.listMarketplaces()[0]!.path).toBe(mk);
    expect((await pm.browse()).map((p) => p.name)).toEqual(['x']);
  });

  it('says what it could not find', async () => {
    await fs.mkdir(join(dir, 'nothing'));
    await expect(pm.installFrom(join(dir, 'nothing'))).rejects.toThrow(/No plugin, marketplace or SKILL\.md/);
    await expect(pm.installFrom(join(dir, 'missing'))).rejects.toThrow(/Not found/);
  });
});

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(hasGit)('git sources (local bare repo)', () => {
  let dir: string;
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], {
      cwd,
      stdio: 'ignore',
    });
  };
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'fs-git-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('clones a marketplace repo, and names a missing repo clearly', async () => {
    const work = join(dir, 'work');
    await write(join(work, '.claude-plugin', 'marketplace.json'), '{"name":"Git Market","plugins":[{"name":"p","source":"./p"}]}');
    await write(join(work, 'p', 'skills', 's', 'SKILL.md'), skillMd('s'));
    git(work, 'init');
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'init');
    const bare = join(dir, 'market.git');
    git(dir, 'clone', '--bare', work, bare);

    const pm = new PluginManager({ root: join(dir, 'root') });
    await pm.load();
    const ref = await pm.addMarketplace(bare);
    expect(ref.id).toBe('git-market');
    await pm.install('git-market', 'p');
    expect(pm.skills().map((s) => s.name)).toEqual(['s']);

    await expect(pm.addMarketplace(join(dir, 'missing.git'))).rejects.toThrow(/Repository not found/);
  });
});

describe('skill sources', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'fs-sources-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('lists only sources with skills, honours defaults and toggles', async () => {
    await write(join(dir, 'claude', 'a', 'SKILL.md'), skillMd('a'));
    await write(join(dir, 'codex', '.system', 'b', 'SKILL.md'), skillMd('b'));
    const pm = new PluginManager({
      root: join(dir, 'root'),
      skillSources: [
        { id: 'claude', label: 'Claude Code', roots: [join(dir, 'claude')], defaultEnabled: true },
        { id: 'codex', label: 'Codex CLI', roots: [join(dir, 'codex')], defaultEnabled: false },
        { id: 'none', label: 'Nothing', roots: [join(dir, 'missing')], defaultEnabled: true },
      ],
    });
    await pm.load();
    expect(pm.listSkillSources().map((s) => [s.id, s.count, s.enabled])).toEqual([
      ['claude', 1, true],
      ['codex', 1, false],
    ]);
    expect(pm.skills().map((s) => [s.name, s.source])).toEqual([['a', 'Claude Code']]);

    await pm.setSkillSourceEnabled('codex', true);
    expect(pm.skills().map((s) => s.name)).toEqual(['a', 'b']);
    // Persisted across restarts.
    const again = new PluginManager({
      root: join(dir, 'root'),
      skillSources: [{ id: 'codex', label: 'Codex CLI', roots: [join(dir, 'codex')], defaultEnabled: false }],
    });
    await again.load();
    expect(again.skills().map((s) => s.name)).toEqual(['b']);
    await expect(pm.setSkillSourceEnabled('nope', true)).rejects.toThrow(/Unknown skill source/);
  });

  it('adds an agent workspace\'s own skills for that agent only', async () => {
    const ws = join(dir, 'ws');
    await write(join(ws, '.claude', 'skills', 'local-one', 'SKILL.md'), skillMd('local-one'));
    const reg = new SkillRegistry({
      skills: () => [{ name: 'global', description: 'g', path: 'x', dir: 'x', pluginId: null }],
      allowlist: (id) => (id === 'restricted' ? [] : null),
    });
    await reg.refreshWorkspace('agent-a', ws);
    await reg.refreshWorkspace('restricted', ws);
    expect(reg.descriptions('agent-a').map((s) => s.name)).toEqual(['local-one', 'global']);
    // An empty allowlist hides global skills but not the workspace's own.
    expect(reg.descriptions('restricted').map((s) => s.name)).toEqual(['local-one']);
    expect(reg.descriptions('agent-b').map((s) => s.name)).toEqual(['global']);
    expect(await reg.load('agent-a', 'local-one')).toContain('Body of local-one');
  });
});
