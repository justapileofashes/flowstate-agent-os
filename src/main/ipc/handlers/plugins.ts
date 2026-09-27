import { ipcMain } from 'electron';
import { broadcast } from '@main/util/broadcast';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type {
  PluginDto,
  PluginInstallFromResponse,
  PluginMarketplaceDto,
  PluginMarketplacePluginDto,
  PluginSkillDto,
  PluginSkillSourceDto,
} from '@shared/ipc-channels';
import type { PluginManager } from '@main/services/plugin-manager';
import type { McpManager } from '@main/services/mcp-manager';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { InstalledPlugin } from '@main/services/plugin-types';
import type { LLMProvider } from '@main/agent/llm-provider';
import { providerKindForModel } from '@main/agent/provider-router';

function toDto(p: InstalledPlugin): PluginDto {
  return {
    id: p.id,
    name: p.name,
    version: p.version,
    description: p.description,
    origin: p.origin.kind,
    ...(p.origin.kind === 'marketplace' ? { marketplaceId: p.origin.marketplaceId } : {}),
    ...(p.origin.kind !== 'marketplace' && p.origin.source ? { originSource: p.origin.source } : {}),
    enabled: p.enabled,
    hooksConsent: p.hooksConsent,
    readOnly: p.readOnly,
    components: p.components,
  };
}

function toMarketplaceDto(m: {
  id: string;
  name: string;
  source: string;
  addedAt: number;
}): PluginMarketplaceDto {
  return { id: m.id, name: m.name, source: m.source, addedAt: m.addedAt };
}

export function registerPluginHandlers(deps: {
  pluginManager: PluginManager;
  mcpManager: McpManager;
  repo: ChatRepository;
  workspacesDir: string;
  provider?: LLMProvider;
}): void {
  const { pluginManager, mcpManager, repo, workspacesDir } = deps;

  /**
   * Claude Code agent files name their model by alias ("sonnet", "opus",
   * "haiku", "inherit") or leave it out. Copied as-is those were routed to
   * Ollama and 404'd, so use a real installed model instead.
   */
  async function resolveAgentModel(declared: string | undefined): Promise<string> {
    const m = (declared ?? '').trim();
    if (m && !/^(sonnet|opus|haiku|inherit|default)$/i.test(m)) return m;
    const installed = deps.provider ? await deps.provider.listModels().catch(() => []) : [];
    const local = installed.map((x) => x.name).find((n) => providerKindForModel(n) === 'ollama');
    return local ?? repo.getAgent('agent-code-helper')?.model ?? 'qwen2.5-coder:14b';
  }

  // Push plugin-contributed MCP servers into the manager's plugin layer.
  const syncMcp = (): void => {
    void mcpManager.setPluginServers(pluginManager.mcpConfigs().map((m) => m.config));
  };
  syncMcp();

  // Re-sync MCP + broadcast plugin status whenever the plugin set changes.
  pluginManager.on('status', (plugins: InstalledPlugin[]) => {
    syncMcp();
    broadcast(CHANNELS.PLUGINS_STATUS, { plugins: plugins.map(toDto) });
  });

  ipcMain.handle(CHANNELS.PLUGINS_LIST, () => ({ plugins: pluginManager.list().map(toDto) }));

  ipcMain.handle(CHANNELS.PLUGINS_MARKETPLACES, () => ({
    marketplaces: pluginManager.listMarketplaces().map(toMarketplaceDto),
  }));

  ipcMain.handle(CHANNELS.PLUGINS_ADD_MARKETPLACE, async (_e, raw) => {
    const { source } = schemas.pluginsAddMarketplaceRequest.parse(raw);
    await pluginManager.addMarketplace(source);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_REFRESH_MARKETPLACE, async (_e, raw) => {
    const { id } = schemas.pluginsMarketplaceIdRequest.parse(raw);
    await pluginManager.refreshMarketplace(id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_REMOVE_MARKETPLACE, async (_e, raw) => {
    const { id } = schemas.pluginsMarketplaceIdRequest.parse(raw);
    await pluginManager.removeMarketplace(id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_BROWSE, async (_e, raw) => {
    const { query } = schemas.pluginsBrowseRequest.parse(raw);
    const plugins: PluginMarketplacePluginDto[] = await pluginManager.browse(query);
    return { plugins };
  });

  ipcMain.handle(CHANNELS.PLUGINS_INSTALL, async (_e, raw) => {
    const { marketplaceId, pluginName } = schemas.pluginsInstallRequest.parse(raw);
    const installed = await pluginManager.install(marketplaceId, pluginName);
    return { ok: true, plugin: toDto(installed) };
  });

  ipcMain.handle(CHANNELS.PLUGINS_INSTALL_LOCAL, async (_e, raw) => {
    const { path } = schemas.pluginsInstallLocalRequest.parse(raw);
    const installed = await pluginManager.installLocal(path);
    return { ok: true, plugin: toDto(installed) };
  });

  // One box: owner/repo, git URL, folder, or .zip/.plugin/.skill file.
  ipcMain.handle(CHANNELS.PLUGINS_INSTALL_FROM, async (_e, raw): Promise<PluginInstallFromResponse> => {
    const { source } = schemas.pluginsInstallFromRequest.parse(raw);
    try {
      const r = await pluginManager.installFrom(source);
      return { ok: true, ...r };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(CHANNELS.PLUGINS_SKILL_SOURCES, (): { sources: PluginSkillSourceDto[] } => ({
    sources: pluginManager.listSkillSources(),
  }));

  ipcMain.handle(CHANNELS.PLUGINS_SET_SKILL_SOURCE, async (_e, raw) => {
    const { id, enabled } = schemas.pluginsSetSkillSourceRequest.parse(raw);
    await pluginManager.setSkillSourceEnabled(id, enabled);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_UNINSTALL, async (_e, raw) => {
    const { id } = schemas.pluginsIdRequest.parse(raw);
    await pluginManager.uninstall(id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_SET_ENABLED, async (_e, raw) => {
    const { id, enabled } = schemas.pluginsSetEnabledRequest.parse(raw);
    await pluginManager.setEnabled(id, enabled);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_SET_HOOKS_CONSENT, async (_e, raw) => {
    const { id, consent } = schemas.pluginsSetHooksConsentRequest.parse(raw);
    await pluginManager.setHooksConsent(id, consent);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.PLUGINS_LIST_SKILLS, () => {
    const skills: PluginSkillDto[] = pluginManager
      .skills()
      .map((s) => ({
        name: s.name,
        description: s.description,
        pluginId: s.pluginId,
        ...(s.source ? { source: s.source } : {}),
      }));
    return { skills };
  });

  ipcMain.handle(CHANNELS.PLUGINS_GET_AGENT_SKILLS, (_e, raw) => {
    const { agentId } = schemas.pluginsGetAgentSkillsRequest.parse(raw);
    return { names: pluginManager.getAgentSkills(agentId) };
  });

  ipcMain.handle(CHANNELS.PLUGINS_SET_AGENT_SKILLS, async (_e, raw) => {
    const { agentId, names } = schemas.pluginsSetAgentSkillsRequest.parse(raw);
    await pluginManager.setAgentSkills(agentId, names);
    return { ok: true };
  });

  // Import a plugin's bundled agents (`agents/*.md`) into the agent roster.
  ipcMain.handle(CHANNELS.PLUGINS_IMPORT_AGENTS, async (_e, raw) => {
    const { id } = schemas.pluginsIdRequest.parse(raw);
    const defs = pluginManager.agents().filter((a) => a.pluginId === id);
    const existing = new Set(repo.listAgents().map((a) => a.name.toLowerCase()));
    let count = 0;
    for (const def of defs) {
      if (existing.has(def.name.toLowerCase())) continue;
      const tools = def.tools.map((t) => t.toLowerCase());
      const slug = `plugin-${id}-${def.name}`.replace(/[^a-z0-9-_]+/gi, '-').slice(0, 60);
      const wsPath = join(workspacesDir, slug);
      await mkdir(wsPath, { recursive: true });
      repo.createAgent({
        id: `agent-${slug}-${Date.now().toString(36)}`,
        name: def.name,
        description: def.description || `Imported from plugin ${id}`,
        specialtyTags: [],
        systemPrompt: def.body,
        model: await resolveAgentModel(def.model),
        avatarColor: '#a09a8e',
        workspacePath: wsPath,
        toolPerms: {
          shell_enabled: tools.some((t) => t.includes('bash') || t.includes('shell')),
          delete_enabled: tools.some((t) => t.includes('delete')),
        },
        approvalPolicy: 'cautious',
      });
      existing.add(def.name.toLowerCase());
      count += 1;
    }
    return { ok: true, count };
  });
}
