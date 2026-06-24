import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import {
  AGENT_PACK_EXTENSION,
  parseAgentPack,
  planImports,
  serializeAgents,
} from '@main/services/agent-pack';
import { mkdir } from 'node:fs/promises';

export function registerAgentPackHandlers(deps: {
  repo: ChatRepository;
  workspacesDir: string;
}): void {
  ipcMain.handle(CHANNELS.AGENTS_EXPORT_PACK, async (_e, raw) => {
    const { ids } = schemas.agentsExportPackRequest.parse(raw);
    const agents = ids
      .map((id) => deps.repo.getAgent(id))
      .filter((a): a is NonNullable<typeof a> => a != null)
      .map((a) => ({
        name: a.name,
        description: a.description,
        specialtyTags: a.specialtyTags,
        systemPrompt: a.systemPrompt,
        model: a.model,
        avatarColor: a.avatarColor,
        toolPerms: a.toolPerms,
        approvalPolicy: a.approvalPolicy,
      }));
    if (agents.length === 0) throw new Error('No matching agents to export.');

    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export agents',
      defaultPath: `my-agents.${AGENT_PACK_EXTENSION}`,
      filters: [{ name: 'FlowState agent pack', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const pack = serializeAgents(agents);
    await fs.writeFile(result.filePath, JSON.stringify(pack, null, 2), 'utf8');
    return { ok: true, path: result.filePath, count: agents.length };
  });

  ipcMain.handle(CHANNELS.AGENTS_IMPORT_PACK, async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import agents',
      filters: [{ name: 'FlowState agent pack', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false, canceled: true };

    const pack = parseAgentPack(await fs.readFile(file, 'utf8'));
    const existing = deps.repo.listAgents();
    const plans = planImports(pack.agents, {
      // Workspace dir names already in use — basename of each agent's path.
      slugs: existing.map((a) => basename(a.workspacePath)),
      ids: existing.map((a) => a.id),
    });

    const created = [];
    for (const plan of plans) {
      const wsPath = join(deps.workspacesDir, plan.workspaceSlug);
      await mkdir(wsPath, { recursive: true });
      created.push(
        deps.repo.createAgent({
          id: plan.id,
          name: plan.agent.name,
          description: plan.agent.description,
          specialtyTags: plan.agent.specialtyTags,
          systemPrompt: plan.agent.systemPrompt,
          model: plan.agent.model,
          avatarColor: plan.agent.avatarColor,
          workspacePath: wsPath,
          toolPerms: plan.agent.toolPerms,
          approvalPolicy: plan.agent.approvalPolicy,
        }),
      );
    }
    return { ok: true, agents: created };
  });
}
