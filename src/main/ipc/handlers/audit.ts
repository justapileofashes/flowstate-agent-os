import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { AuditRepository } from '@main/repos/audit-repository';

export function registerAuditHandlers(deps: { repo: AuditRepository }): void {
  ipcMain.handle(CHANNELS.AUDIT_LIST, async (_e, raw) => {
    const f = schemas.auditListRequest.parse(raw ?? {});
    return {
      entries: deps.repo.list({
        ...(f.agentId ? { agentId: f.agentId } : {}),
        ...(f.chatId ? { chatId: f.chatId } : {}),
        ...(f.limit ? { limit: f.limit } : {}),
      }),
    };
  });

  ipcMain.handle(CHANNELS.AUDIT_CLEAR, async (_e, raw) => {
    const f = schemas.auditClearRequest.parse(raw ?? {});
    const removed = deps.repo.clear(f.agentId ? { agentId: f.agentId } : {});
    return { removed };
  });
}
