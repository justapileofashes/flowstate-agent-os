import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SnapshotService } from '@main/services/snapshot-service';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AuditLogger } from '@main/services/audit-logger';

export function registerSnapshotsHandlers(deps: {
  service: SnapshotService;
  repo: ChatRepository;
  audit?: AuditLogger;
}): void {
  ipcMain.handle(CHANNELS.SNAPSHOTS_LIST, async (_e, raw) => {
    const { agentId } = schemas.snapshotsListRequest.parse(raw);
    return { snapshots: await deps.service.list(agentId) };
  });

  ipcMain.handle(CHANNELS.SNAPSHOTS_CREATE, async (_e, raw) => {
    const { agentId, label } = schemas.snapshotsCreateRequest.parse(raw);
    const agent = deps.repo.getAgent(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const meta = await deps.service.create({
      agentId,
      workspacePath: agent.workspacePath,
      label,
    });
    return { snapshot: meta };
  });

  ipcMain.handle(CHANNELS.SNAPSHOTS_RESTORE, async (_e, raw) => {
    const { agentId, snapshotId } = schemas.snapshotsRestoreRequest.parse(raw);
    const result = await deps.service.restore(agentId, snapshotId);
    deps.audit?.rollback(
      { agentId },
      { detail: `Restored snapshot ${snapshotId} — ${result.filesRestored} files` },
    );
    return result;
  });

  ipcMain.handle(CHANNELS.SNAPSHOTS_DELETE, async (_e, raw) => {
    const { agentId, snapshotId } = schemas.snapshotsDeleteRequest.parse(raw);
    await deps.service.delete(agentId, snapshotId);
    return { ok: true };
  });
}
