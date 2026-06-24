// Observability surface: live system stats (roadmap 2b) + reproducible run
// export (roadmap 6c).

import { promises as fs } from 'node:fs';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AuditRepository } from '@main/repos/audit-repository';
import { SystemStatsService } from '@main/services/system-stats';
import { buildRunBundle } from '@main/services/run-export';

export function registerObservabilityHandlers(deps: {
  repo: ChatRepository;
  auditRepo: AuditRepository;
}): void {
  const stats = new SystemStatsService();

  ipcMain.handle(CHANNELS.SYSTEM_STATS_GET, async (_e, raw) => {
    schemas.systemStatsGetRequest.parse(raw);
    return await stats.snapshot();
  });

  ipcMain.handle(CHANNELS.CHAT_EXPORT_RUN, async (_e, raw) => {
    const { chatId } = schemas.chatExportRunRequest.parse(raw);
    const chat = deps.repo.getChat(chatId);
    if (!chat) throw new Error(`Unknown chat: ${chatId}`);
    const agent = deps.repo.getAgent(chat.agentId);
    if (!agent) throw new Error(`Unknown agent: ${chat.agentId}`);

    const bundle = buildRunBundle({
      chat: { id: chat.id, title: chat.title, createdAt: chat.createdAt },
      agent: { id: agent.id, name: agent.name, model: agent.model },
      messages: deps.repo.getMessages(chatId),
      audit: deps.auditRepo.list({ chatId, limit: 1000 }),
    });

    const slug = (chat.title || chat.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win!, {
      title: 'Export run',
      defaultPath: `run-${slug || 'chat'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    await fs.writeFile(result.filePath, bundle, 'utf8');
    return { ok: true, path: result.filePath };
  });
}
