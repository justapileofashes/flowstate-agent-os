// IPC handlers for flowclaw gateway connections (OpenClaw / Hermes).
//
// Thin glue over the tested service layer: SettingsConnectionStore (persistence
// + token encryption) and FlowclawConnections (id -> right client + unified
// testConnection). The token is write-only across IPC — list/get never return
// it; the renderer shows a masked field and only sends a token when setting one.

import { ipcMain } from 'electron';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import { SecretStore, electronSafeStorageBackend } from '@main/services/secret-store';
import { SettingsConnectionStore } from '@main/services/flowclaw-store';
import {
  FlowclawConnections,
  type ConnectionStore,
  type FlowclawConnection,
} from '@main/agent/flowclaw-connections';
import {
  parseAutomations,
  serializeAutomations,
  createAutomation,
  dueAutomations,
  markRan,
} from '@main/services/flowclaw-automations';

const AUTOMATIONS_KEY = 'flowclaw_automations';

export function registerFlowclawHandlers(deps: {
  settings: SettingsService;
}): void {
  const secrets = new SecretStore(electronSafeStorageBackend());
  const store = new SettingsConnectionStore(deps.settings, secrets);
  const registry = new FlowclawConnections(store);

  const loadAutomations = (): ReturnType<typeof parseAutomations> =>
    parseAutomations(deps.settings.get(AUTOMATIONS_KEY));
  const saveAutomations = (items: ReturnType<typeof parseAutomations>): void =>
    deps.settings.set(AUTOMATIONS_KEY, serializeAutomations(items));

  ipcMain.handle(CHANNELS.FLOWCLAW_LIST, () => ({ connections: store.list() }));

  ipcMain.handle(CHANNELS.FLOWCLAW_SAVE, (_e, raw) => {
    const { connection } = schemas.flowclawSaveRequest.parse(raw);
    store.upsert(connection);
    return { ok: true as const };
  });

  ipcMain.handle(CHANNELS.FLOWCLAW_REMOVE, (_e, raw) => {
    const { id } = schemas.flowclawRemoveRequest.parse(raw);
    store.remove(id);
    return { ok: true as const };
  });

  // Test a (possibly unsaved) connection using the plaintext token from the
  // form — nothing is persisted. Reuses the registry against a transient store
  // holding just this draft connection.
  ipcMain.handle(CHANNELS.FLOWCLAW_TEST, (_e, raw) => {
    const { connection } = schemas.flowclawTestRequest.parse(raw);
    const conn: FlowclawConnection = {
      id: connection.id,
      kind: connection.kind,
      label: connection.label,
      baseUrl: connection.baseUrl,
      enabled: connection.enabled,
      ...(connection.model ? { model: connection.model } : {}),
    };
    const draftToken = connection.token ?? store.getSecret(connection.id);
    const transient: ConnectionStore = {
      list: () => [conn],
      get: (id) => (id === conn.id ? conn : undefined),
      getSecret: (id) => (id === conn.id ? draftToken : ''),
    };
    return new FlowclawConnections(transient).testConnection(conn.id);
  });

  // ---- #1 autonomous task execution ----
  ipcMain.handle(CHANNELS.FLOWCLAW_RUN_TASK, async (_e, raw) => {
    const { connectionId, prompt, model } = schemas.flowclawRunTaskRequest.parse(raw);
    try {
      const text = await registry.runToText(connectionId, prompt, model ? { model } : {});
      return { ok: true as const, text };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- #3 ClawHub skills ----
  ipcMain.handle(CHANNELS.FLOWCLAW_SKILLS_LIST, (_e, raw) => {
    const { connectionId, query } = schemas.flowclawSkillsListRequest.parse(raw);
    return registry.listSkills(connectionId, query);
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_SKILL_INSTALL, (_e, raw) => {
    const { connectionId, skillId } = schemas.flowclawSkillInstallRequest.parse(raw);
    return registry.installSkill(connectionId, skillId);
  });

  // ---- #4 long-term memory ----
  ipcMain.handle(CHANNELS.FLOWCLAW_MEMORY_GET, (_e, raw) => {
    const { connectionId, key } = schemas.flowclawMemoryGetRequest.parse(raw);
    return registry.memoryGet(connectionId, key);
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_MEMORY_SET, (_e, raw) => {
    const { connectionId, key, value } = schemas.flowclawMemorySetRequest.parse(raw);
    return registry.memorySet(connectionId, key, value);
  });

  // ---- #5 cloud file workspace ----
  ipcMain.handle(CHANNELS.FLOWCLAW_FILES_LIST, (_e, raw) => {
    const { connectionId, path } = schemas.flowclawFilesListRequest.parse(raw);
    return registry.listFiles(connectionId, path);
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_FILE_READ, (_e, raw) => {
    const { connectionId, path } = schemas.flowclawFileReadRequest.parse(raw);
    return registry.readFile(connectionId, path);
  });

  // ---- #6 pro-grade search ----
  ipcMain.handle(CHANNELS.FLOWCLAW_SEARCH, (_e, raw) => {
    const { connectionId, query, source } = schemas.flowclawSearchRequest.parse(raw);
    return registry.search(connectionId, query, source);
  });

  // ---- #7 chat-native integrations ----
  ipcMain.handle(CHANNELS.FLOWCLAW_SEND_MESSAGE, (_e, raw) => {
    const { connectionId, channel, text } = schemas.flowclawSendMessageRequest.parse(raw);
    return registry.sendMessage(connectionId, channel, text);
  });

  // ---- #7b messaging-app linking (Telegram/Discord/Slack/…) ----
  ipcMain.handle(CHANNELS.FLOWCLAW_MSG_PROVIDERS, (_e, raw) => {
    const { connectionId } = schemas.flowclawMsgScopeRequest.parse(raw);
    return registry.listMessagingProviders(connectionId);
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_MSG_LIST, (_e, raw) => {
    const { connectionId } = schemas.flowclawMsgScopeRequest.parse(raw);
    return registry.listMessagingConnections(connectionId);
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_MSG_CONNECT, (_e, raw) => {
    const { connectionId, provider, credentials, label } = schemas.flowclawMsgConnectRequest.parse(raw);
    return registry.connectMessaging(connectionId, provider, credentials, label);
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_MSG_DISCONNECT, (_e, raw) => {
    const { connectionId, messagingId } = schemas.flowclawMsgDisconnectRequest.parse(raw);
    return registry.disconnectMessaging(connectionId, messagingId);
  });

  // ---- #2 scheduled automations (cron) ----
  ipcMain.handle(CHANNELS.FLOWCLAW_AUTOMATION_LIST, () => ({ automations: loadAutomations() }));
  ipcMain.handle(CHANNELS.FLOWCLAW_AUTOMATION_CREATE, (_e, raw) => {
    const input = schemas.flowclawAutomationCreateRequest.parse(raw);
    const next = [...loadAutomations(), createAutomation(input)];
    saveAutomations(next);
    return { ok: true as const };
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_AUTOMATION_DELETE, (_e, raw) => {
    const { id } = schemas.flowclawAutomationDeleteRequest.parse(raw);
    saveAutomations(loadAutomations().filter((a) => a.id !== id));
    return { ok: true as const };
  });
  ipcMain.handle(CHANNELS.FLOWCLAW_AUTOMATION_TOGGLE, (_e, raw) => {
    const { id, enabled } = schemas.flowclawAutomationToggleRequest.parse(raw);
    saveAutomations(loadAutomations().map((a) => (a.id === id ? { ...a, enabled } : a)));
    return { ok: true as const };
  });

  // Ticker: fire due automations once a minute, deliver result back into the
  // automation row (lastResult) for the in-app feed. Best-effort; never throws.
  const tick = async (): Promise<void> => {
    const items = loadAutomations();
    const due = dueAutomations(items);
    if (due.length === 0) return;
    for (const a of due) {
      let result: string;
      try {
        result = await registry.runToText(a.connectionId, a.prompt);
      } catch (err) {
        result = `[error] ${err instanceof Error ? err.message : String(err)}`;
      }
      // Re-load each time so concurrent edits aren't clobbered.
      const fresh = loadAutomations().map((x) => (x.id === a.id ? markRan(x, result) : x));
      saveAutomations(fresh);
    }
  };
  setInterval(() => void tick(), 60_000);
}
