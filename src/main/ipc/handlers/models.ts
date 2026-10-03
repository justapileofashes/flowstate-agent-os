import { ipcMain } from 'electron';
import { CHANNELS, schemas, type AgentTemplateDto } from '@shared/ipc-channels';
import { SEED_AGENTS } from '@main/seed-agents';
import { createFromTemplate, templateGroups } from '@main/agent-library';
import { detectHardware } from '@main/services/hardware-info';
import { scoreCatalog, recommend, CATALOG } from '@main/services/model-catalog';
import {
  pickModelsForAgents,
  fetchInstalledModelNames,
} from '@main/services/agent-model-matcher';
import type { LLMProvider } from '@main/agent/llm-provider';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { SettingsService } from '@main/services/settings-service';
import type { Database } from 'better-sqlite3';

export function registerModelsHandlers(
  provider: LLMProvider,
  repo: ChatRepository,
  db: Database,
  settings: SettingsService,
): void {
  const readCloudAvailable = (): {
    anthropic: boolean;
    openai: boolean;
    gemini: boolean;
    perplexity: boolean;
    groq: boolean;
    mistral: boolean;
    xai: boolean;
  } => ({
    anthropic: Boolean(settings.get('anthropic_api_key')),
    openai: Boolean(settings.get('openai_api_key')),
    gemini: Boolean(settings.get('gemini_api_key')),
    perplexity: Boolean(settings.get('perplexity_api_key')),
    groq: Boolean(settings.get('groq_api_key')),
    mistral: Boolean(settings.get('mistral_api_key')),
    xai: Boolean(settings.get('xai_api_key')),
  });

  ipcMain.handle(CHANNELS.MODELS_HARDWARE, async () => {
    return detectHardware();
  });

  ipcMain.handle(CHANNELS.MODELS_CATALOG, async () => {
    const hw = await detectHardware();
    const cloudAvailable = readCloudAvailable();
    const scored = scoreCatalog(hw, cloudAvailable);
    const recs = recommend(scored);

    let installed: Set<string>;
    try {
      const list = await provider.listModels();
      installed = new Set(list.map((m) => m.name));
    } catch {
      installed = new Set();
    }

    return {
      hardware: hw,
      catalog: scored.map((s) => ({
        ...s,
        installed: installed.has(s.model.id),
      })),
      recommendations: {
        balanced: recs.balanced ? recs.balanced.model.id : null,
        code: recs.code ? recs.code.model.id : null,
        fast: recs.fast ? recs.fast.model.id : null,
        top: recs.top.map((r) => r.model.id),
      },
      totalCount: CATALOG.length,
    };
  });

  ipcMain.handle(CHANNELS.AGENTS_AUTO_ASSIGN_MODELS, async () => {
    const hardware = await detectHardware();
    const installed = await fetchInstalledModelNames(provider);
    const cloudAvailable = readCloudAvailable();
    const agents = repo.listAgents();
    const matches = pickModelsForAgents(agents, hardware, installed, cloudAvailable);
    const now = Date.now();
    const out = matches.map((m) => {
      const agentName = agents.find((a) => a.id === m.agentId)?.name ?? m.agentId;
      const changed = Boolean(m.pickedModel && m.pickedModel !== m.previousModel);
      if (changed && m.pickedModel) {
        db.prepare('UPDATE agents SET model = ?, updated_at = ? WHERE id = ?').run(
          m.pickedModel,
          now,
          m.agentId,
        );
      }
      return {
        agentId: m.agentId,
        agentName,
        previousModel: m.previousModel,
        pickedModel: m.pickedModel,
        changed,
        reason: m.reason,
      };
    });
    return { matches: out };
  });

  // Agent Library: every built-in template, flagged when it's already added.
  ipcMain.handle(CHANNELS.AGENTS_LIBRARY_LIST, (): { templates: AgentTemplateDto[] } => {
    const have = new Set(repo.listAgents().map((a) => a.id));
    return {
      templates: SEED_AGENTS.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        specialtyTags: t.specialtyTags,
        avatarColor: t.avatarColor,
        groups: templateGroups(t.specialtyTags),
        added: have.has(t.id),
      })),
    };
  });

  ipcMain.handle(CHANNELS.AGENTS_LIBRARY_ADD, async (_e, raw) => {
    const { id } = schemas.agentsLibraryAddRequest.parse(raw);
    const template = SEED_AGENTS.find((t) => t.id === id);
    if (!template) throw new Error(`unknown template ${id}`);
    const existing = repo.getAgent(id);
    if (existing) return { agent: existing };
    const created = await createFromTemplate(repo, template, settings.get('workspaces_dir') ?? '');
    // Swap the template's default for a model this machine has, like startup auto-assign.
    try {
      const [hardware, installed] = await Promise.all([detectHardware(), fetchInstalledModelNames(provider)]);
      const [m] = pickModelsForAgents([created], hardware, installed, readCloudAvailable());
      if (m?.pickedModel && m.pickedModel !== created.model) {
        db.prepare('UPDATE agents SET model = ?, updated_at = ? WHERE id = ?').run(m.pickedModel, Date.now(), id);
      }
    } catch {
      // Ollama offline — keep the template's default model
    }
    return { agent: repo.getAgent(id)! };
  });
}
