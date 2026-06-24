// Full-setup backup IPC: export agents + non-secret settings to a portable
// JSON file, and restore from one. Reuses the agent-pack import planner for
// collision-safe agent creation; secrets are never written or restored.

import { promises as fs } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { CHANNELS } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { SettingsService } from '@main/services/settings-service';
import { planImports } from '@main/services/agent-pack';
import { buildBackup, parseBackup, BACKUP_EXTENSION } from '@main/services/backup';

export function registerBackupHandlers(deps: {
  repo: ChatRepository;
  settings: SettingsService;
  workspacesDir: string;
}): void {
  ipcMain.handle(CHANNELS.BACKUP_EXPORT, async () => {
    const agents = deps.repo.listAgents().map((a) => ({
      name: a.name,
      description: a.description,
      specialtyTags: a.specialtyTags,
      systemPrompt: a.systemPrompt,
      model: a.model,
      avatarColor: a.avatarColor,
      toolPerms: a.toolPerms,
      approvalPolicy: a.approvalPolicy,
    }));
    const backup = buildBackup(agents, deps.settings.list());

    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export full backup',
      defaultPath: `flowstate.${BACKUP_EXTENSION}`,
      filters: [{ name: 'FlowState backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    return { ok: true, path: result.filePath, agentCount: backup.agents.length };
  });

  ipcMain.handle(CHANNELS.BACKUP_IMPORT, async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(win!, {
      title: 'Restore from backup',
      filters: [{ name: 'FlowState backup', extensions: ['json'] }],
      properties: ['openFile'],
    });
    const file = result.filePaths[0];
    if (result.canceled || !file) return { ok: false, canceled: true };

    const backup = parseBackup(await fs.readFile(file, 'utf8'));

    // Agents: collision-safe via the shared planner (slug/id dedup, shell→cautious).
    const existing = deps.repo.listAgents();
    const plans = planImports(backup.agents, {
      slugs: existing.map((a) => basename(a.workspacePath)),
      ids: existing.map((a) => a.id),
    });
    for (const plan of plans) {
      const wsPath = join(deps.workspacesDir, plan.workspaceSlug);
      await mkdir(wsPath, { recursive: true });
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
      });
    }

    // Settings: parseBackup already stripped secrets/machine-local keys.
    let settingsRestored = 0;
    for (const [key, value] of Object.entries(backup.settings)) {
      deps.settings.set(key, value);
      settingsRestored++;
    }

    return { ok: true, agentsAdded: plans.length, settingsRestored };
  });
}
