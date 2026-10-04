import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverClaudeCodePlugins, discoverPluginDirs } from '@main/services/plugin-discovery';
import { PluginManager } from '@main/services/plugin-manager';

let home: string;

function plugin(dir: string, name: string, opts: { skill?: string; mcp?: boolean } = {}): void {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '1.2.3' }));
  if (opts.skill) {
    mkdirSync(join(dir, 'skills', opts.skill), { recursive: true });
    writeFileSync(join(dir, 'skills', opts.skill, 'SKILL.md'), `---\nname: ${opts.skill}\ndescription: does ${opts.skill}\n---\nbody`);
  }
  if (opts.mcp) {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { srv: { command: 'npx', args: ['-y', 'x'] } } }));
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-home-'));
  const plugins = join(home, 'plugins');
  // Claude Code internals that must NOT show up as plugins.
  for (const d of ['cache', 'data', 'marketplaces', 'local-marketplace']) mkdirSync(join(plugins, d), { recursive: true });
  const sp = join(plugins, 'cache', 'official', 'superpowers', '6.2.0');
  const pw = join(plugins, 'cache', 'official', 'playwright', 'unknown');
  const off = join(plugins, 'cache', 'official', 'turned-off', '1.0.0');
  plugin(sp, 'superpowers', { skill: 'brainstorming' });
  plugin(pw, 'playwright', { mcp: true });
  plugin(off, 'turned-off', { skill: 'nope' });
  writeFileSync(
    join(plugins, 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'superpowers@official': [{ scope: 'user', installPath: sp, version: '6.2.0' }],
        'playwright@official': [{ scope: 'user', installPath: pw, version: 'unknown' }],
        'turned-off@official': [{ scope: 'user', installPath: off, version: '1.0.0' }],
        'project-only@official': [{ scope: 'project', installPath: sp, projectPath: 'D:\\x' }],
        'gone@official': [{ scope: 'user', installPath: join(plugins, 'cache', 'missing') }],
      },
    }),
  );
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ enabledPlugins: { 'turned-off@official': false } }));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('discoverClaudeCodePlugins', () => {
  it('reads installed_plugins.json instead of listing ~/.claude/plugins folders', async () => {
    const found = (await discoverClaudeCodePlugins(home))!;
    expect(found.map((p) => p.key).sort()).toEqual(['playwright@official', 'superpowers@official', 'turned-off@official']);
    const sp = found.find((p) => p.name === 'superpowers')!;
    expect(sp).toMatchObject({ source: 'official', version: '6.2.0', defaultEnabled: true });
    expect(found.find((p) => p.name === 'playwright')!.version).toBe('');
  });

  it("mirrors Claude Code's disabled plugins", async () => {
    const found = (await discoverClaudeCodePlugins(home))!;
    expect(found.find((p) => p.name === 'turned-off')!.defaultEnabled).toBe(false);
  });

  it('returns null without a manifest; the fallback only takes real plugin folders', async () => {
    rmSync(join(home, 'plugins', 'installed_plugins.json'));
    expect(await discoverClaudeCodePlugins(home)).toBeNull();
    expect(await discoverPluginDirs(join(home, 'plugins'))).toEqual([]);
  });
});

describe('PluginManager with Claude Code discovery', () => {
  it('lists real plugins, feeds their skills, and gates their MCP servers behind consent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pm-root-'));
    try {
      const pm = new PluginManager({ root, claudeHome: home });
      await pm.load();
      const names = pm.list().map((p) => p.name).sort();
      expect(names).toEqual(['playwright', 'superpowers', 'turned-off']);
      expect(pm.list().every((p) => p.readOnly)).toBe(true);
      expect(pm.skills().map((s) => s.name)).toEqual(['brainstorming']); // turned-off stays off
      expect(pm.mcpConfigs()).toHaveLength(0); // no consent yet
      const pw = pm.list().find((p) => p.name === 'playwright')!;
      await pm.setHooksConsent(pw.id, true);
      expect(pm.mcpConfigs()).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
