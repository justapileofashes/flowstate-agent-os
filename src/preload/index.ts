import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNELS,
  chatEventChannel,
  chatEventEndChannel,
  ollamaPullProgressChannel,
  ollamaPullEndChannel,
  teamEventChannel,
  teamEventEndChannel,
} from '@shared/ipc-channels';
import type {
  SettingsGetResponse,
  SettingsSetResponse,
  SettingsListResponse,
  OllamaHealthResponse,
  ChatListAgentsResponse,
  ChatListChatsResponse,
  ChatCreateChatResponse,
  ChatGetMessagesResponse,
  ChatSendMessageResponse,
  ChatAbortResponse,
  ChatListModelsResponse,
  ChatCreateAgentRequest,
  ChatCreateAgentResponse,
  ChatUpdateAgentRequest,
  ChatUpdateAgentResponse,
  ChatDeleteAgentResponse,
  ActiveStreamsBroadcast,
  ChatApprovalResponseRequest,
  ChatApprovalResponseResponse,
  ChatRouteResponse,
  AgentsExportPackResponse,
  AgentsImportPackResponse,
  SystemStatsGetResponse,
  ClisDetectResponse,
  ClisGetResponse,
  ChatExportRunResponse,
  SnippetsListResponse,
  SnippetsSaveResponse,
  UserCommandDto,
  UserCommandsListResponse,
  UserCommandsSaveResponse,
  BudgetEvaluateResponse,
  BudgetGetCapsResponse,
  MentionsResolveResponse,
  ProjectContextLoadResponse,
  PromptPreflightResponse,
  EnvDoctorRunResponse,
  PinsListResponse,
  PinsToggleResponse,
  PromptHistoryGetResponse,
  PromptHistoryPushResponse,
  FilesListResponse,
  FilesReadResponse,
  ShellOpenPathResponse,
  ShellOpenVscodeResponse,
  OllamaPullResponse,
  OllamaPullCancelResponse,
  OllamaPullProgress,
  ChatListRecentChatsResponse,
  ChatDeleteChatResponse,
  ChatRenameChatResponse,
  ChatGenerateAgentRequest,
  ChatGenerateAgentResponse,
  HardwareInfoDto,
  ModelsCatalogResponse,
  McpListResponse,
  McpServerDto,
  McpTestResultDto,
  McpStatusBroadcast,
  PluginsListResponse,
  PluginsMarketplacesResponse,
  PluginsBrowseResponse,
  PluginsListSkillsResponse,
  PluginsStatusBroadcast,
  TerminalDataBroadcast,
  TerminalExitBroadcast,
  FlowclawListResponse,
  FlowclawConnectionInputDto,
  FlowclawTestResultDto,
  AgentsAutoAssignResponse,
  BrainStatusDto,
  BrainListEntryDto,
  BrainNoteDto,
  BrainSearchHitDto,
  BrainCategoryDto,
  SnapshotDto,
  AuditEntryDto,
  OllamaStartResponse,
  ChatTeamRunResponse,
  ChatTeamAbortResponse,
  ChatTeamNudgeResponse,
  TeamEventDto,
} from '@shared/ipc-channels';
import type { UsageSummaryResponse, BackupExportResponse, BackupImportResponse } from '@shared/ipc-channels';
import type {
  FlowclawRunTaskResponse,
  FlowclawSkillsListResponse,
  FlowclawMemoryGetResponse,
  FlowclawFilesListResponse,
  FlowclawFileReadResponse,
  FlowclawSearchResponse,
  FlowclawMsgProvidersResponse,
  FlowclawMsgListResponse,
  FlowclawAutomationDto,
} from '@shared/ipc-channels';

const api = {
  settings: {
    get: (key: string): Promise<SettingsGetResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_GET, { key }),
    set: (key: string, value: string): Promise<SettingsSetResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_SET, { key, value }),
    list: (): Promise<SettingsListResponse> =>
      ipcRenderer.invoke(CHANNELS.SETTINGS_LIST, {}),
  },
  ollama: {
    health: (): Promise<OllamaHealthResponse> =>
      ipcRenderer.invoke(CHANNELS.OLLAMA_HEALTH, {}),
    start: (): Promise<OllamaStartResponse> =>
      ipcRenderer.invoke(CHANNELS.OLLAMA_START, {}),
    pull: async (
      model: string,
      onProgress: (p: OllamaPullProgress) => void,
      onEnd: (payload: { ok: boolean; error?: string }) => void,
    ): Promise<{ pullId: string; cancel: () => void }> => {
      const { pullId } = (await ipcRenderer.invoke(CHANNELS.OLLAMA_PULL, { model })) as OllamaPullResponse;
      const evt = ollamaPullProgressChannel(pullId);
      const end = ollamaPullEndChannel(pullId);
      const onEvtRaw = (_e: Electron.IpcRendererEvent, p: OllamaPullProgress) => onProgress(p);
      const onEndRaw = (
        _e: Electron.IpcRendererEvent,
        p: { ok: boolean; error?: string },
      ) => {
        onEnd(p);
        ipcRenderer.removeListener(evt, onEvtRaw);
        ipcRenderer.removeListener(end, onEndRaw);
      };
      ipcRenderer.on(evt, onEvtRaw);
      ipcRenderer.on(end, onEndRaw);
      return {
        pullId,
        cancel: () => {
          void (ipcRenderer.invoke(CHANNELS.OLLAMA_PULL_CANCEL, {
            pullId,
          }) as Promise<OllamaPullCancelResponse>);
        },
      };
    },
    librarySearch: (q: string, limit = 80) =>
      ipcRenderer.invoke(CHANNELS.OLLAMA_LIBRARY_SEARCH, { q, limit }),
    cloudSignin: () => ipcRenderer.invoke(CHANNELS.OLLAMA_CLOUD_SIGNIN, {}),
    cloudStatus: () => ipcRenderer.invoke(CHANNELS.OLLAMA_CLOUD_STATUS, {}),
    cloudSignout: () => ipcRenderer.invoke(CHANNELS.OLLAMA_CLOUD_SIGNOUT, {}),
  },
  chat: {
    listAgents: (): Promise<ChatListAgentsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_AGENTS, {}),
    listChats: (agentId: string): Promise<ChatListChatsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_CHATS, { agentId }),
    listRecentChats: (limit?: number): Promise<ChatListRecentChatsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_RECENT_CHATS, limit ? { limit } : {}),
    deleteChat: (chatId: string): Promise<ChatDeleteChatResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_DELETE_CHAT, { chatId }),
    renameChat: (chatId: string, title: string): Promise<ChatRenameChatResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_RENAME_CHAT, { chatId, title }),
    search: (q: string, limit = 30) =>
      ipcRenderer.invoke(CHANNELS.CHAT_SEARCH, { q, limit }),
    fork: (chatId: string, untilMessageId?: string, title?: string) =>
      ipcRenderer.invoke(CHANNELS.CHAT_FORK, {
        chatId,
        ...(untilMessageId ? { untilMessageId } : {}),
        ...(title ? { title } : {}),
      }),
    generateAgent: (input: ChatGenerateAgentRequest): Promise<ChatGenerateAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_GENERATE_AGENT, input),
    createChat: (agentId: string, title?: string): Promise<ChatCreateChatResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_CREATE_CHAT, { agentId, title }),
    getMessages: (chatId: string): Promise<ChatGetMessagesResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_GET_MESSAGES, { chatId }),
    sendMessage: (chatId: string, text: string): Promise<ChatSendMessageResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_SEND_MESSAGE, { chatId, text }),
    abort: (streamId: string): Promise<ChatAbortResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_ABORT, { streamId }),
    subscribeToStream: (
      streamId: string,
      onEvent: (event: unknown) => void,
      onEnd: (payload: { reason: string }) => void,
    ): (() => void) => {
      const evtChannel = chatEventChannel(streamId);
      const endChannel = chatEventEndChannel(streamId);
      const onEvtRaw = (_e: Electron.IpcRendererEvent, payload: unknown) => {
        onEvent(payload);
      };
      const onEndRaw = (_e: Electron.IpcRendererEvent, payload: { reason: string }) => {
        onEnd(payload);
        ipcRenderer.removeListener(evtChannel, onEvtRaw);
        ipcRenderer.removeListener(endChannel, onEndRaw);
      };
      ipcRenderer.on(evtChannel, onEvtRaw);
      ipcRenderer.on(endChannel, onEndRaw);
      return () => {
        ipcRenderer.removeListener(evtChannel, onEvtRaw);
        ipcRenderer.removeListener(endChannel, onEndRaw);
      };
    },
    listModels: (): Promise<ChatListModelsResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_LIST_MODELS, {}),
    createAgent: (input: ChatCreateAgentRequest): Promise<ChatCreateAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_CREATE_AGENT, input),
    updateAgent: (input: ChatUpdateAgentRequest): Promise<ChatUpdateAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_UPDATE_AGENT, input),
    deleteAgent: (id: string): Promise<ChatDeleteAgentResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_DELETE_AGENT, { id }),
    exportAgentPack: (ids: string[]): Promise<AgentsExportPackResponse> =>
      ipcRenderer.invoke(CHANNELS.AGENTS_EXPORT_PACK, { ids }),
    importAgentPack: (): Promise<AgentsImportPackResponse> =>
      ipcRenderer.invoke(CHANNELS.AGENTS_IMPORT_PACK, {}),
    exportRun: (chatId: string): Promise<ChatExportRunResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_EXPORT_RUN, { chatId }),
    subscribeToActiveStreams: (
      onUpdate: (payload: ActiveStreamsBroadcast) => void,
    ): (() => void) => {
      const channel = CHANNELS.CHAT_ACTIVE_STREAMS;
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: ActiveStreamsBroadcast,
      ) => onUpdate(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    respondToApproval: (
      req: ChatApprovalResponseRequest,
    ): Promise<ChatApprovalResponseResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_APPROVAL_RESPONSE, req),
    route: (text: string): Promise<ChatRouteResponse> =>
      ipcRenderer.invoke(CHANNELS.CHAT_ROUTE, { text }),
    teamRun: async (
      text: string,
      onEvent: (e: TeamEventDto) => void,
      onEnd: () => void,
    ): Promise<{
      runId: string;
      abort: () => void;
      nudge: (taskId: string, text: string, interrupt: boolean) => Promise<boolean>;
    }> => {
      const { runId } = (await ipcRenderer.invoke(CHANNELS.CHAT_TEAM_RUN, { text })) as ChatTeamRunResponse;
      const evtCh = teamEventChannel(runId);
      const endCh = teamEventEndChannel(runId);
      const onEvtRaw = (_e: Electron.IpcRendererEvent, p: TeamEventDto) => onEvent(p);
      const onEndRaw = () => {
        onEnd();
        ipcRenderer.removeListener(evtCh, onEvtRaw);
        ipcRenderer.removeListener(endCh, onEndRaw);
      };
      ipcRenderer.on(evtCh, onEvtRaw);
      ipcRenderer.on(endCh, onEndRaw);
      return {
        runId,
        abort: () => {
          void (ipcRenderer.invoke(CHANNELS.CHAT_TEAM_ABORT, { runId }) as Promise<ChatTeamAbortResponse>);
        },
        nudge: async (taskId: string, text: string, interrupt: boolean): Promise<boolean> => {
          const res = (await ipcRenderer.invoke(CHANNELS.CHAT_TEAM_NUDGE, {
            runId,
            taskId,
            text,
            interrupt,
          })) as ChatTeamNudgeResponse;
          return res.ok;
        },
      };
    },
  },
  models: {
    hardware: (): Promise<HardwareInfoDto> =>
      ipcRenderer.invoke(CHANNELS.MODELS_HARDWARE, {}),
    catalog: (): Promise<ModelsCatalogResponse> =>
      ipcRenderer.invoke(CHANNELS.MODELS_CATALOG, {}),
    autoAssignAgents: (): Promise<AgentsAutoAssignResponse> =>
      ipcRenderer.invoke(CHANNELS.AGENTS_AUTO_ASSIGN_MODELS, {}),
  },
  mcp: {
    list: (): Promise<McpListResponse> => ipcRenderer.invoke(CHANNELS.MCP_LIST, {}),
    save: (servers: McpServerDto[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.MCP_SAVE, { servers }),
    test: (server: McpServerDto): Promise<McpTestResultDto> =>
      ipcRenderer.invoke(CHANNELS.MCP_TEST, { server }),
    subscribeStatus: (cb: (payload: McpStatusBroadcast) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: McpStatusBroadcast): void =>
        cb(payload);
      ipcRenderer.on(CHANNELS.MCP_STATUS, handler);
      return () => ipcRenderer.removeListener(CHANNELS.MCP_STATUS, handler);
    },
  },
  plugins: {
    list: (): Promise<PluginsListResponse> => ipcRenderer.invoke(CHANNELS.PLUGINS_LIST, {}),
    marketplaces: (): Promise<PluginsMarketplacesResponse> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_MARKETPLACES, {}),
    addMarketplace: (source: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_ADD_MARKETPLACE, { source }),
    refreshMarketplace: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_REFRESH_MARKETPLACE, { id }),
    removeMarketplace: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_REMOVE_MARKETPLACE, { id }),
    browse: (query?: string): Promise<PluginsBrowseResponse> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_BROWSE, query ? { query } : {}),
    install: (marketplaceId: string, pluginName: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_INSTALL, { marketplaceId, pluginName }),
    installLocal: (path: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_INSTALL_LOCAL, { path }),
    uninstall: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_UNINSTALL, { id }),
    setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_SET_ENABLED, { id, enabled }),
    setHooksConsent: (id: string, consent: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_SET_HOOKS_CONSENT, { id, consent }),
    listSkills: (): Promise<PluginsListSkillsResponse> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_LIST_SKILLS, {}),
    getAgentSkills: (agentId: string): Promise<{ names: string[] | null }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_GET_AGENT_SKILLS, { agentId }),
    setAgentSkills: (agentId: string, names: string[]): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_SET_AGENT_SKILLS, { agentId, names }),
    importAgents: (id: string): Promise<{ ok: boolean; count: number }> =>
      ipcRenderer.invoke(CHANNELS.PLUGINS_IMPORT_AGENTS, { id }),
    subscribeStatus: (cb: (payload: PluginsStatusBroadcast) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: PluginsStatusBroadcast): void =>
        cb(payload);
      ipcRenderer.on(CHANNELS.PLUGINS_STATUS, handler);
      return () => ipcRenderer.removeListener(CHANNELS.PLUGINS_STATUS, handler);
    },
  },
  terminal: {
    start: (id: string, cwd: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.TERMINAL_START, { id, cwd }),
    input: (id: string, data: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.TERMINAL_INPUT, { id, data }),
    kill: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.TERMINAL_KILL, { id }),
    onData: (cb: (payload: TerminalDataBroadcast) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: TerminalDataBroadcast): void =>
        cb(payload);
      ipcRenderer.on(CHANNELS.TERMINAL_DATA, handler);
      return () => ipcRenderer.removeListener(CHANNELS.TERMINAL_DATA, handler);
    },
    onExit: (cb: (payload: TerminalExitBroadcast) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: TerminalExitBroadcast): void =>
        cb(payload);
      ipcRenderer.on(CHANNELS.TERMINAL_EXIT, handler);
      return () => ipcRenderer.removeListener(CHANNELS.TERMINAL_EXIT, handler);
    },
  },
  flowclaw: {
    list: (): Promise<FlowclawListResponse> => ipcRenderer.invoke(CHANNELS.FLOWCLAW_LIST, {}),
    save: (connection: FlowclawConnectionInputDto): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_SAVE, { connection }),
    test: (connection: FlowclawConnectionInputDto): Promise<FlowclawTestResultDto> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_TEST, { connection }),
    remove: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_REMOVE, { id }),
    runTask: (connectionId: string, prompt: string, model?: string): Promise<FlowclawRunTaskResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_RUN_TASK, { connectionId, prompt, ...(model ? { model } : {}) }),
    listSkills: (connectionId: string, query?: string): Promise<FlowclawSkillsListResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_SKILLS_LIST, { connectionId, ...(query ? { query } : {}) }),
    installSkill: (connectionId: string, skillId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_SKILL_INSTALL, { connectionId, skillId }),
    memoryGet: (connectionId: string, key: string): Promise<FlowclawMemoryGetResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_MEMORY_GET, { connectionId, key }),
    memorySet: (connectionId: string, key: string, value: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_MEMORY_SET, { connectionId, key, value }),
    listFiles: (connectionId: string, path?: string): Promise<FlowclawFilesListResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_FILES_LIST, { connectionId, ...(path ? { path } : {}) }),
    readFile: (connectionId: string, path: string): Promise<FlowclawFileReadResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_FILE_READ, { connectionId, path }),
    search: (connectionId: string, query: string, source?: string): Promise<FlowclawSearchResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_SEARCH, { connectionId, query, ...(source ? { source } : {}) }),
    sendMessage: (connectionId: string, channel: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_SEND_MESSAGE, { connectionId, channel, text }),
    msgProviders: (connectionId: string): Promise<FlowclawMsgProvidersResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_MSG_PROVIDERS, { connectionId }),
    msgList: (connectionId: string): Promise<FlowclawMsgListResponse> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_MSG_LIST, { connectionId }),
    msgConnect: (connectionId: string, provider: string, credentials: Record<string, string>, label?: string): Promise<{ ok: boolean; id?: string }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_MSG_CONNECT, { connectionId, provider, credentials, ...(label ? { label } : {}) }),
    msgDisconnect: (connectionId: string, messagingId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_MSG_DISCONNECT, { connectionId, messagingId }),
    listAutomations: (): Promise<{ automations: FlowclawAutomationDto[] }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_AUTOMATION_LIST, {}),
    createAutomation: (input: { connectionId: string; label: string; prompt: string; intervalMinutes: number; deliverTo?: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_AUTOMATION_CREATE, input),
    deleteAutomation: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_AUTOMATION_DELETE, { id }),
    toggleAutomation: (id: string, enabled: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.FLOWCLAW_AUTOMATION_TOGGLE, { id, enabled }),
  },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, value: boolean): void => cb(value);
      ipcRenderer.on('window:maximized-changed', handler);
      return () => ipcRenderer.removeListener('window:maximized-changed', handler);
    },
    popChat: (chatId: string, agentId?: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.WINDOW_POP_CHAT, agentId ? { chatId, agentId } : { chatId }),
  },
  brain: {
    status: (): Promise<BrainStatusDto> => ipcRenderer.invoke(CHANNELS.BRAIN_STATUS, {}),
    list: (category?: BrainCategoryDto): Promise<BrainListEntryDto[]> =>
      ipcRenderer.invoke(CHANNELS.BRAIN_LIST, category ? { category } : {}),
    read: (relPath: string): Promise<BrainNoteDto> =>
      ipcRenderer.invoke(CHANNELS.BRAIN_READ, { relPath }),
    write: (input: {
      category: 'projects' | 'areas' | 'resources' | 'archive' | 'routines';
      title: string;
      body: string;
      tags?: string[];
      links?: string[];
    }): Promise<{ relPath: string }> => ipcRenderer.invoke(CHANNELS.BRAIN_WRITE, input),
    capture: (text: string, source?: string, tags?: string[]): Promise<{ relPath: string }> =>
      ipcRenderer.invoke(CHANNELS.BRAIN_CAPTURE, {
        text,
        ...(source ? { source } : {}),
        ...(tags ? { tags } : {}),
      }),
    search: (query: string, limit?: number): Promise<BrainSearchHitDto[]> =>
      ipcRenderer.invoke(CHANNELS.BRAIN_SEARCH, { query, ...(limit ? { limit } : {}) }),
    openVault: (): Promise<string> => ipcRenderer.invoke(CHANNELS.BRAIN_OPEN_VAULT, {}),
    setVault: (path: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.BRAIN_SET_VAULT, { path }),
  },
  snapshots: {
    list: (agentId: string): Promise<{ snapshots: SnapshotDto[] }> =>
      ipcRenderer.invoke(CHANNELS.SNAPSHOTS_LIST, { agentId }),
    create: (agentId: string, label: string): Promise<{ snapshot: SnapshotDto }> =>
      ipcRenderer.invoke(CHANNELS.SNAPSHOTS_CREATE, { agentId, label }),
    restore: (agentId: string, snapshotId: string): Promise<{ filesRestored: number }> =>
      ipcRenderer.invoke(CHANNELS.SNAPSHOTS_RESTORE, { agentId, snapshotId }),
    delete: (agentId: string, snapshotId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.SNAPSHOTS_DELETE, { agentId, snapshotId }),
  },
  audit: {
    list: (filter?: {
      agentId?: string;
      chatId?: string;
      limit?: number;
    }): Promise<{ entries: AuditEntryDto[] }> =>
      ipcRenderer.invoke(CHANNELS.AUDIT_LIST, filter ?? {}),
    clear: (agentId?: string): Promise<{ removed: number }> =>
      ipcRenderer.invoke(CHANNELS.AUDIT_CLEAR, agentId ? { agentId } : {}),
  },
  system: {
    stats: (): Promise<SystemStatsGetResponse> =>
      ipcRenderer.invoke(CHANNELS.SYSTEM_STATS_GET, {}),
  },
  clis: {
    detect: (): Promise<ClisDetectResponse> => ipcRenderer.invoke(CHANNELS.CLIS_DETECT, {}),
    get: (): Promise<ClisGetResponse> => ipcRenderer.invoke(CHANNELS.CLIS_GET, {}),
    connect: (ids: string[]): Promise<{ ok: true }> =>
      ipcRenderer.invoke(CHANNELS.CLIS_CONNECT, { ids }),
  },
  backup: {
    export: (): Promise<BackupExportResponse> => ipcRenderer.invoke(CHANNELS.BACKUP_EXPORT, {}),
    import: (): Promise<BackupImportResponse> => ipcRenderer.invoke(CHANNELS.BACKUP_IMPORT, {}),
  },
  devtools: {
    listSnippets: (): Promise<SnippetsListResponse> =>
      ipcRenderer.invoke(CHANNELS.SNIPPETS_LIST, {}),
    saveSnippet: (snippet: {
      id?: string;
      name: string;
      label: string;
      body: string;
    }): Promise<SnippetsSaveResponse> => ipcRenderer.invoke(CHANNELS.SNIPPETS_SAVE, { snippet }),
    deleteSnippet: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.SNIPPETS_DELETE, { id }),
    listCommands: (): Promise<UserCommandsListResponse> =>
      ipcRenderer.invoke(CHANNELS.USER_COMMANDS_LIST, {}),
    saveCommands: (commands: UserCommandDto[]): Promise<UserCommandsSaveResponse> =>
      ipcRenderer.invoke(CHANNELS.USER_COMMANDS_SAVE, { commands }),
    evaluateBudget: (chatId?: string): Promise<BudgetEvaluateResponse> =>
      ipcRenderer.invoke(CHANNELS.BUDGET_EVALUATE, chatId ? { chatId } : {}),
    getBudgetCaps: (): Promise<BudgetGetCapsResponse> =>
      ipcRenderer.invoke(CHANNELS.BUDGET_GET_CAPS, {}),
    setBudgetCaps: (perChatUsd: number, perDayUsd: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.BUDGET_SET_CAPS, { perChatUsd, perDayUsd }),
    resolveMentions: (agentId: string, text: string): Promise<MentionsResolveResponse> =>
      ipcRenderer.invoke(CHANNELS.MENTIONS_RESOLVE, { agentId, text }),
    loadProjectContext: (agentId: string): Promise<ProjectContextLoadResponse> =>
      ipcRenderer.invoke(CHANNELS.PROJECT_CONTEXT_LOAD, { agentId }),
    preflight: (
      text: string,
      contextChars?: number,
      model?: string,
    ): Promise<PromptPreflightResponse> =>
      ipcRenderer.invoke(CHANNELS.PROMPT_PREFLIGHT, { text, contextChars, model }),
    runDoctor: (): Promise<EnvDoctorRunResponse> =>
      ipcRenderer.invoke(CHANNELS.ENV_DOCTOR_RUN, {}),
    listPins: (): Promise<PinsListResponse> => ipcRenderer.invoke(CHANNELS.PINS_LIST, {}),
    togglePin: (chatId: string): Promise<PinsToggleResponse> =>
      ipcRenderer.invoke(CHANNELS.PINS_TOGGLE, { chatId }),
    getHistory: (): Promise<PromptHistoryGetResponse> =>
      ipcRenderer.invoke(CHANNELS.PROMPT_HISTORY_GET, {}),
    pushHistory: (entry: string): Promise<PromptHistoryPushResponse> =>
      ipcRenderer.invoke(CHANNELS.PROMPT_HISTORY_PUSH, { entry }),
  },
  files: {
    list: (workspacePath: string, subPath?: string): Promise<FilesListResponse> =>
      ipcRenderer.invoke(CHANNELS.FILES_LIST, { workspacePath, subPath }),
    read: (workspacePath: string, relPath: string): Promise<FilesReadResponse> =>
      ipcRenderer.invoke(CHANNELS.FILES_READ, { workspacePath, relPath }),
  },
  shellOpen: {
    path: (absolutePath: string): Promise<ShellOpenPathResponse> =>
      ipcRenderer.invoke(CHANNELS.SHELL_OPEN_PATH, { absolutePath }),
    vscode: (absolutePath: string): Promise<ShellOpenVscodeResponse> =>
      ipcRenderer.invoke(CHANNELS.SHELL_OPEN_VSCODE, { absolutePath }),
    url: (url: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(CHANNELS.SHELL_OPEN_URL, { url }),
  },
  cloud: {
    test: (
      provider: 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'groq' | 'mistral' | 'xai',
    ): Promise<{ ok: boolean; models: number; error?: string }> =>
      ipcRenderer.invoke(CHANNELS.CLOUD_TEST_CONNECTION, { provider }),
  },
  usage: {
    record: (row: {
      chatId: string;
      agentId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    }) => ipcRenderer.invoke(CHANNELS.USAGE_RECORD, row),
    list: (chatId?: string) =>
      ipcRenderer.invoke(CHANNELS.USAGE_LIST, chatId ? { chatId } : {}),
    summary: (): Promise<UsageSummaryResponse> =>
      ipcRenderer.invoke(CHANNELS.USAGE_SUMMARY, {}),
  },
  schedules: {
    list: () => ipcRenderer.invoke(CHANNELS.SCHEDULES_LIST, {}),
    create: (row: { agentId: string; prompt: string; intervalMinutes: number }) =>
      ipcRenderer.invoke(CHANNELS.SCHEDULES_CREATE, row),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.SCHEDULES_DELETE, { id }),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.SCHEDULES_TOGGLE, { id, enabled }),
  },
  routines: {
    list: () => ipcRenderer.invoke(CHANNELS.ROUTINES_LIST, {}),
    create: (row: {
      name: string;
      agentId: string;
      prompt: string;
      schedule: import('@shared/ipc-channels').RoutineSchedule;
      target?: import('@shared/ipc-channels').RoutineTarget;
    }) => ipcRenderer.invoke(CHANNELS.ROUTINES_CREATE, row),
    update: (row: {
      id: string;
      name?: string;
      prompt?: string;
      agentId?: string;
      schedule?: import('@shared/ipc-channels').RoutineSchedule;
      target?: import('@shared/ipc-channels').RoutineTarget | null;
    }) => ipcRenderer.invoke(CHANNELS.ROUTINES_UPDATE, row),
    delete: (id: string) => ipcRenderer.invoke(CHANNELS.ROUTINES_DELETE, { id }),
    toggle: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.ROUTINES_TOGGLE, { id, enabled }),
    runNow: (id: string) => ipcRenderer.invoke(CHANNELS.ROUTINES_RUN_NOW, { id }),
  },
  zoom: {
    saveCreds: (creds: { accountId: string; clientId: string; clientSecret: string }) =>
      ipcRenderer.invoke(CHANNELS.ZOOM_SAVE_CREDS, creds),
    test: () => ipcRenderer.invoke(CHANNELS.ZOOM_TEST, {}),
    record: (req: {
      meetingId?: string;
      topic?: string;
      agentId: string;
      connectionId: string;
      model?: string;
    }) => ipcRenderer.invoke(CHANNELS.ZOOM_RECORD, req),
    jobs: () => ipcRenderer.invoke(CHANNELS.ZOOM_JOBS, {}),
    openRecording: (path: string) => ipcRenderer.invoke(CHANNELS.ZOOM_OPEN_RECORDING, { path }),
  },
  capture: {
    start: (req: { title: string; agentId: string; connectionId: string; model?: string }) =>
      ipcRenderer.invoke(CHANNELS.CAPTURE_START, req),
    // Structured clone carries the ArrayBuffer to main intact.
    chunk: (captureId: string, data: ArrayBuffer) =>
      ipcRenderer.invoke(CHANNELS.CAPTURE_CHUNK, { captureId, data }),
    stop: (captureId: string) => ipcRenderer.invoke(CHANNELS.CAPTURE_STOP, { captureId }),
    jobs: () => ipcRenderer.invoke(CHANNELS.CAPTURE_JOBS, {}),
    saveTranscriber: (cfg: {
      mode: 'openai' | 'cli';
      url?: string;
      apiKey?: string;
      model?: string;
      command?: string;
    }) => ipcRenderer.invoke(CHANNELS.CAPTURE_SAVE_TRANSCRIBER, cfg),
    testTranscriber: () => ipcRenderer.invoke(CHANNELS.CAPTURE_TEST_TRANSCRIBER, {}),
  },
  business: {
    rpc: (method: string, params?: unknown) => ipcRenderer.invoke(CHANNELS.BUSINESS_RPC, { method, params: params ?? {} }),
    subscribe: (cb: (event: import('@shared/business/api').BizEvent) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: import('@shared/business/api').BizEvent): void => cb(payload);
      ipcRenderer.on(CHANNELS.BUSINESS_EVENT, handler);
      return () => ipcRenderer.removeListener(CHANNELS.BUSINESS_EVENT, handler);
    },
  },
  stocks: {
    quote: (symbol: string) => ipcRenderer.invoke(CHANNELS.STOCKS_QUOTE, { symbol }),
    history: (symbol: string, range?: string) =>
      ipcRenderer.invoke(CHANNELS.STOCKS_HISTORY, range ? { symbol, range } : { symbol }),
    analyze: (args: {
      symbol: string;
      range?: string;
      account?: number;
      riskPct?: number;
      horizon?: number;
    }) => ipcRenderer.invoke(CHANNELS.STOCKS_ANALYZE, args),
    getWatchlist: () => ipcRenderer.invoke(CHANNELS.STOCKS_WATCHLIST_GET, {}),
    setWatchlist: (symbols: string[]) =>
      ipcRenderer.invoke(CHANNELS.STOCKS_WATCHLIST_SET, { symbols }),
  },
  trading: {
    status: () => ipcRenderer.invoke(CHANNELS.TRADING_STATUS, {}),
    connect: (keyId: string, secret: string, paper: boolean) =>
      ipcRenderer.invoke(CHANNELS.TRADING_CONNECT, { keyId, secret, paper }),
    disconnect: () => ipcRenderer.invoke(CHANNELS.TRADING_DISCONNECT, {}),
    setLiveAck: (ack: boolean) => ipcRenderer.invoke(CHANNELS.TRADING_LIVE_ACK, { ack }),
    account: () => ipcRenderer.invoke(CHANNELS.TRADING_ACCOUNT, {}),
    setGuardrails: (patch: Record<string, number>) =>
      ipcRenderer.invoke(CHANNELS.TRADING_GUARDRAILS_SET, patch),
    setAutopilot: (enabled: boolean) =>
      ipcRenderer.invoke(CHANNELS.TRADING_AUTOPILOT, { enabled }),
    runCycle: () => ipcRenderer.invoke(CHANNELS.TRADING_RUN_CYCLE, {}),
    trades: (limit?: number) =>
      ipcRenderer.invoke(CHANNELS.TRADING_TRADES, limit ? { limit } : {}),
    strategies: () => ipcRenderer.invoke(CHANNELS.TRADING_STRATEGIES, {}),
    setStrategyStatus: (id: string, status: 'active' | 'retired') =>
      ipcRenderer.invoke(CHANNELS.TRADING_STRATEGY_STATUS, { id, status }),
  },
};

contextBridge.exposeInMainWorld('flowstate', api);

export type FlowstateApi = typeof api;
