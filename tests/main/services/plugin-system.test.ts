import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontmatter, parseListValue } from '@main/services/frontmatter';
import { parseMcpJson, parseHooksJson, parseMarketplace } from '@main/services/plugin-scan';
import { PluginManager } from '@main/services/plugin-manager';
import { SkillRegistry } from '@main/services/skill-registry';

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from the body', () => {
    const { data, body } = parseFrontmatter(
      '---\nname: my-skill\ndescription: "Does a thing"\n---\nHello body\nmore',
    );
    expect(data.name).toBe('my-skill');
    expect(data.description).toBe('Does a thing');
    expect(body).toBe('Hello body\nmore');
  });

  it('returns the whole text as body when no frontmatter', () => {
    const { data, body } = parseFrontmatter('just text');
    expect(data).toEqual({});
    expect(body).toBe('just text');
  });
});

describe('parseListValue', () => {
  it('parses comma lists and bracketed lists', () => {
    expect(parseListValue('a, b, c')).toEqual(['a', 'b', 'c']);
    expect(parseListValue('[Read, Write]')).toEqual(['Read', 'Write']);
    expect(parseListValue(undefined)).toEqual([]);
  });
});

describe('parseMcpJson', () => {
  it('namespaces servers by plugin id and substitutes plugin root', () => {
    const raw = JSON.stringify({
      mcpServers: {
        weather: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server.js'], env: { K: 'v' } },
        remote: { url: 'https://x' }, // skipped: no command
      },
    });
    const out = parseMcpJson(raw, 'myplugin', '/plugins/mp');
    expect(out).toHaveLength(1);
    expect(out[0]!.config.id).toBe('plugin-myplugin-weather');
    expect(out[0]!.config.args[0]).toBe('/plugins/mp/server.js');
    expect(out[0]!.config.env).toEqual({ K: 'v' });
  });
});

describe('parseHooksJson', () => {
  it('flattens events into command entries with matchers', () => {
    const raw = JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'cleanup.sh' }] }],
      },
    });
    const out = parseHooksJson(raw, 'p', '/dir');
    expect(out).toHaveLength(2);
    expect(out.find((h) => h.event === 'PreToolUse')?.matcher).toBe('Bash');
    expect(out.find((h) => h.event === 'Stop')?.command).toBe('cleanup.sh');
  });
});

describe('parseMarketplace', () => {
  it('reads the plugin list', () => {
    const raw = JSON.stringify({
      name: 'mp',
      plugins: [{ name: 'super', source: './super', description: 'd' }, { name: 'nosrc' }],
    });
    const out = parseMarketplace(raw, 'mp');
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: 'super', source: './super', description: 'd' });
    expect(out[1]!.source).toBe('nosrc'); // defaults to name
  });
});

// ── Integration: a local marketplace + install + aggregate + allowlist ──────

async function writeSkill(dir: string, name: string, desc: string, body = 'do it'): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`);
}

describe('PluginManager + SkillRegistry', () => {
  let root: string;
  let market: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'fs-plugins-'));
    market = await fs.mkdtemp(join(tmpdir(), 'fs-market-'));
    // Marketplace with one plugin "demo" providing a skill + an MCP server.
    const pluginDir = join(market, 'demo');
    await writeSkill(join(pluginDir, 'skills', 'greeter'), 'greeter', 'Greet the user warmly');
    await fs.mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0', description: 'Demo plugin' }),
    );
    await fs.writeFile(
      join(pluginDir, '.mcp.json'),
      JSON.stringify({ mcpServers: { echo: { command: 'echo', args: ['hi'] } } }),
    );
    await fs.mkdir(join(market, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      join(market, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'testmarket', plugins: [{ name: 'demo', source: './demo' }] }),
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(market, { recursive: true, force: true });
  });

  it('adds a local marketplace, browses, installs, and aggregates components', async () => {
    const pm = new PluginManager({ root });
    await pm.load();

    await pm.addMarketplace(market);
    const browse = await pm.browse();
    expect(browse).toHaveLength(1);
    expect(browse[0]!.name).toBe('demo');
    expect(browse[0]!.installed).toBe(false);

    const installed = await pm.install(browse[0]!.marketplaceId, 'demo');
    expect(installed.name).toBe('demo');
    expect(installed.components.skills).toBe(1);
    expect(installed.components.mcp).toBe(1);

    // Aggregates now expose the skill + MCP config.
    expect(pm.skills().map((s) => s.name)).toContain('greeter');
    expect(pm.mcpConfigs()[0]!.config.id).toBe('plugin-testmarket-demo-echo');

    // Browse now reflects installed state.
    expect((await pm.browse())[0]!.installed).toBe(true);
  });

  it('disabling a plugin removes its components from aggregates', async () => {
    const pm = new PluginManager({ root });
    await pm.load();
    await pm.addMarketplace(market);
    const inst = await pm.install('testmarket', 'demo');

    expect(pm.skills()).toHaveLength(1);
    await pm.setEnabled(inst.id, false);
    expect(pm.skills()).toHaveLength(0);
    expect(pm.mcpConfigs()).toHaveLength(0);

    await pm.setEnabled(inst.id, true);
    expect(pm.skills()).toHaveLength(1);
  });

  it('persists state across reloads', async () => {
    const pm = new PluginManager({ root });
    await pm.load();
    await pm.addMarketplace(market);
    await pm.install('testmarket', 'demo');

    const pm2 = new PluginManager({ root });
    await pm2.load();
    expect(pm2.list().map((p) => p.name)).toContain('demo');
    expect(pm2.skills().map((s) => s.name)).toContain('greeter');
  });

  it('SkillRegistry loads bodies and honors the per-agent allowlist', async () => {
    const pm = new PluginManager({ root });
    await pm.load();
    await pm.addMarketplace(market);
    await pm.install('testmarket', 'demo');

    const reg = new SkillRegistry({
      skills: () => pm.skills(),
      allowlist: (agentId) => pm.getAgentSkills(agentId),
    });

    expect(reg.descriptions('agent-1').map((d) => d.name)).toEqual(['greeter']);
    const body = await reg.load('agent-1', 'greeter');
    expect(body).toContain('do it');
    expect(body).toContain('Skill files directory:');

    // Allowlist excluding greeter hides it from that agent.
    await pm.setAgentSkills('agent-1', []);
    expect(reg.descriptions('agent-1')).toHaveLength(0);
    await expect(reg.load('agent-1', 'greeter')).rejects.toThrow(/Unknown skill/);
    // A different agent with no allowlist still sees it.
    expect(reg.descriptions('agent-2').map((d) => d.name)).toEqual(['greeter']);
  });
});
