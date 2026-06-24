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
  ChatListRecentChatsResponse,
  OllamaStartResponse,
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
  AgentsExportPackResponse,
  AgentsImportPackResponse,
  SystemStatsGetResponse,
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
  BrainStatusDto,
  BrainListEntryDto,
  BrainNoteDto,
  BrainSearchHitDto,
  BrainCategoryDto,
  SnapshotDto,
  AuditEntryDto,
  TeamEventDto,
} from '@shared/ipc-channels';

interface FlowstateApi {
  settings: {
    get: (key: string) => Promise<SettingsGetResponse>;
    set: (key: string, value: string) => Promise<SettingsSetResponse>;
    list: () => Promise<SettingsListResponse>;
  };
  ollama: {
    health: () => Promise<OllamaHealthResponse>;
    start: () => Promise<OllamaStartResponse>;
    pull: (
      model: string,
      onProgress: (p: {
        status: string;
        total?: number;
        completed?: number;
        digest?: string;
      }) => void,
      onEnd: (payload: { ok: boolean; error?: string }) => void,
    ) => Promise<{ pullId: string; cancel: () => void }>;
    librarySearch: (
      q: string,
      limit?: number,
    ) => Promise<import('@shared/ipc-channels').OllamaLibrarySearchResponse>;
    cloudSignin: () => Promise<import('@shared/ipc-channels').OllamaCloudSigninResponse>;
    cloudStatus: () => Promise<import('@shared/ipc-channels').OllamaCloudStatusResponse>;
    cloudSignout: () => Promise<import('@shared/ipc-channels').OllamaCloudSignoutResponse>;
  };
  chat: {
    listAgents: () => Promise<ChatListAgentsResponse>;
    listChats: (agentId: string) => Promise<ChatListChatsResponse>;
    listRecentChats: (limit?: number) => Promise<ChatListRecentChatsResponse>;
    deleteChat: (chatId: string) => Promise<{ ok: boolean }>;
    renameChat: (chatId: string, title: string) => Promise<{ ok: boolean }>;
    search: (
      q: string,
      limit?: number,
    ) => Promise<import('@shared/ipc-channels').ChatSearchResponse>;
    fork: (
      chatId: string,
      untilMessageId?: string,
      title?: string,
    ) => Promise<import('@shared/ipc-channels').ChatForkResponse>;
    generateAgent: (input: {
      name?: string;
      use: string;
    }) => Promise<{ agent: import('@shared/chat-types').AgentDto }>;
    createChat: (agentId: string, title?: string) => Promise<ChatCreateChatResponse>;
    getMessages: (chatId: string) => Promise<ChatGetMessagesResponse>;
    sendMessage: (chatId: string, text: string) => Promise<ChatSendMessageResponse>;
    abort: (streamId: string) => Promise<ChatAbortResponse>;
    subscribeToStream: (
      streamId: string,
      onEvent: (event: unknown) => void,
      onEnd: (payload: { reason: string }) => void,
    ) => () => void;
    listModels: () => Promise<ChatListModelsResponse>;
    createAgent: (input: ChatCreateAgentRequest) => Promise<ChatCreateAgentResponse>;
    updateAgent: (input: ChatUpdateAgentRequest) => Promise<ChatUpdateAgentResponse>;
    deleteAgent: (id: string) => Promise<ChatDeleteAgentResponse>;
    exportAgentPack: (ids: string[]) => Promise<AgentsExportPackResponse>;
    importAgentPack: () => Promise<AgentsImportPackResponse>;
    exportRun: (chatId: string) => Promise<ChatExportRunResponse>;
    subscribeToActiveStreams: (
      onUpdate: (payload: ActiveStreamsBroadcast) => void,
    ) => () => void;
    respondToApproval: (req: {
      streamId: string;
      toolCallId: string;
      decision: 'allow-once' | 'allow-rest' | 'deny';
      reason?: string;
    }) => Promise<{ ok: boolean }>;
    route: (text: string) => Promise<{
      agentId: string;
      chatId: string;
      reasoning: string;
      fallback: boolean;
      swarm: string[];
      team: boolean;
    }>;
    teamRun: (
      text: string,
      onEvent: (e: TeamEventDto) => void,
      onEnd: () => void,
    ) => Promise<{
      runId: string;
      abort: () => void;
      nudge: (taskId: string, text: string, interrupt: boolean) => Promise<boolean>;
    }>;
  };
  models: {
    hardware: () => Promise<HardwareInfoDto>;
    catalog: () => Promise<ModelsCatalogResponse>;
    autoAssignAgents: () => Promise<AgentsAutoAssignResponse>;
  };
  mcp: {
    list: () => Promise<McpListResponse>;
    save: (servers: McpServerDto[]) => Promise<{ ok: boolean }>;
    test: (server: McpServerDto) => Promise<McpTestResultDto>;
    subscribeStatus: (cb: (payload: McpStatusBroadcast) => void) => () => void;
  };
  plugins: {
    list: () => Promise<PluginsListResponse>;
    marketplaces: () => Promise<PluginsMarketplacesResponse>;
    addMarketplace: (source: string) => Promise<{ ok: boolean }>;
    refreshMarketplace: (id: string) => Promise<{ ok: boolean }>;
    removeMarketplace: (id: string) => Promise<{ ok: boolean }>;
    browse: (query?: string) => Promise<PluginsBrowseResponse>;
    install: (marketplaceId: string, pluginName: string) => Promise<{ ok: boolean }>;
    installLocal: (path: string) => Promise<{ ok: boolean }>;
    uninstall: (id: string) => Promise<{ ok: boolean }>;
    setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean }>;
    setHooksConsent: (id: string, consent: boolean) => Promise<{ ok: boolean }>;
    listSkills: () => Promise<PluginsListSkillsResponse>;
    getAgentSkills: (agentId: string) => Promise<{ names: string[] | null }>;
    setAgentSkills: (agentId: string, names: string[]) => Promise<{ ok: boolean }>;
    importAgents: (id: string) => Promise<{ ok: boolean; count: number }>;
    subscribeStatus: (cb: (payload: PluginsStatusBroadcast) => void) => () => void;
  };
  terminal: {
    start: (id: string, cwd: string) => Promise<{ ok: boolean }>;
    input: (id: string, data: string) => Promise<{ ok: boolean }>;
    kill: (id: string) => Promise<{ ok: boolean }>;
    onData: (cb: (payload: TerminalDataBroadcast) => void) => () => void;
    onExit: (cb: (payload: TerminalExitBroadcast) => void) => () => void;
  };
  flowclaw: {
    list: () => Promise<FlowclawListResponse>;
    save: (connection: FlowclawConnectionInputDto) => Promise<{ ok: boolean }>;
    test: (connection: FlowclawConnectionInputDto) => Promise<FlowclawTestResultDto>;
    remove: (id: string) => Promise<{ ok: boolean }>;
    runTask: (connectionId: string, prompt: string, model?: string) => Promise<import('@shared/ipc-channels').FlowclawRunTaskResponse>;
    listSkills: (connectionId: string, query?: string) => Promise<import('@shared/ipc-channels').FlowclawSkillsListResponse>;
    installSkill: (connectionId: string, skillId: string) => Promise<{ ok: boolean }>;
    memoryGet: (connectionId: string, key: string) => Promise<import('@shared/ipc-channels').FlowclawMemoryGetResponse>;
    memorySet: (connectionId: string, key: string, value: string) => Promise<{ ok: boolean }>;
    listFiles: (connectionId: string, path?: string) => Promise<import('@shared/ipc-channels').FlowclawFilesListResponse>;
    readFile: (connectionId: string, path: string) => Promise<import('@shared/ipc-channels').FlowclawFileReadResponse>;
    search: (connectionId: string, query: string, source?: string) => Promise<import('@shared/ipc-channels').FlowclawSearchResponse>;
    sendMessage: (connectionId: string, channel: string, text: string) => Promise<{ ok: boolean }>;
    msgProviders: (connectionId: string) => Promise<import('@shared/ipc-channels').FlowclawMsgProvidersResponse>;
    msgList: (connectionId: string) => Promise<import('@shared/ipc-channels').FlowclawMsgListResponse>;
    msgConnect: (connectionId: string, provider: string, credentials: Record<string, string>, label?: string) => Promise<{ ok: boolean; id?: string }>;
    msgDisconnect: (connectionId: string, messagingId: string) => Promise<{ ok: boolean }>;
    listAutomations: () => Promise<{ automations: import('@shared/ipc-channels').FlowclawAutomationDto[] }>;
    createAutomation: (input: { connectionId: string; label: string; prompt: string; intervalMinutes: number; deliverTo?: string }) => Promise<{ ok: boolean }>;
    deleteAutomation: (id: string) => Promise<{ ok: boolean }>;
    toggleAutomation: (id: string, enabled: boolean) => Promise<{ ok: boolean }>;
  };
  brain: {
    status: () => Promise<BrainStatusDto>;
    list: (category?: BrainCategoryDto) => Promise<BrainListEntryDto[]>;
    read: (relPath: string) => Promise<BrainNoteDto>;
    write: (input: {
      category: 'projects' | 'areas' | 'resources' | 'archive' | 'routines';
      title: string;
      body: string;
      tags?: string[];
      links?: string[];
    }) => Promise<{ relPath: string }>;
    capture: (text: string, source?: string, tags?: string[]) => Promise<{ relPath: string }>;
    search: (query: string, limit?: number) => Promise<BrainSearchHitDto[]>;
    openVault: () => Promise<string>;
    setVault: (path: string) => Promise<{ ok: boolean }>;
  };
  snapshots: {
    list: (agentId: string) => Promise<{ snapshots: SnapshotDto[] }>;
    create: (agentId: string, label: string) => Promise<{ snapshot: SnapshotDto }>;
    restore: (agentId: string, snapshotId: string) => Promise<{ filesRestored: number }>;
    delete: (agentId: string, snapshotId: string) => Promise<{ ok: boolean }>;
  };
  system: {
    stats: () => Promise<SystemStatsGetResponse>;
  };
  backup: {
    export: () => Promise<import('@shared/ipc-channels').BackupExportResponse>;
    import: () => Promise<import('@shared/ipc-channels').BackupImportResponse>;
  };
  devtools: {
    listSnippets: () => Promise<SnippetsListResponse>;
    saveSnippet: (snippet: {
      id?: string;
      name: string;
      label: string;
      body: string;
    }) => Promise<SnippetsSaveResponse>;
    deleteSnippet: (id: string) => Promise<{ ok: boolean }>;
    listCommands: () => Promise<UserCommandsListResponse>;
    saveCommands: (commands: UserCommandDto[]) => Promise<UserCommandsSaveResponse>;
    evaluateBudget: (chatId?: string) => Promise<BudgetEvaluateResponse>;
    getBudgetCaps: () => Promise<BudgetGetCapsResponse>;
    setBudgetCaps: (perChatUsd: number, perDayUsd: number) => Promise<{ ok: boolean }>;
    resolveMentions: (agentId: string, text: string) => Promise<MentionsResolveResponse>;
    loadProjectContext: (agentId: string) => Promise<ProjectContextLoadResponse>;
    preflight: (
      text: string,
      contextChars?: number,
      model?: string,
    ) => Promise<PromptPreflightResponse>;
    runDoctor: () => Promise<EnvDoctorRunResponse>;
    listPins: () => Promise<PinsListResponse>;
    togglePin: (chatId: string) => Promise<PinsToggleResponse>;
    getHistory: () => Promise<PromptHistoryGetResponse>;
    pushHistory: (entry: string) => Promise<PromptHistoryPushResponse>;
  };
  audit: {
    list: (filter?: {
      agentId?: string;
      chatId?: string;
      limit?: number;
    }) => Promise<{ entries: AuditEntryDto[] }>;
    clear: (agentId?: string) => Promise<{ removed: number }>;
  };
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;
    popChat: (chatId: string, agentId?: string) => Promise<{ ok: boolean }>;
  };
  files: {
    list: (
      workspacePath: string,
      subPath?: string,
    ) => Promise<{ entries: Array<{ name: string; kind: 'file' | 'dir' | 'other' }> }>;
    read: (
      workspacePath: string,
      relPath: string,
    ) => Promise<{ content: string; truncated: boolean; sizeBytes: number }>;
  };
  shellOpen: {
    path: (absolutePath: string) => Promise<{ ok: boolean; error?: string }>;
    vscode: (absolutePath: string) => Promise<{ ok: boolean }>;
    url: (url: string) => Promise<{ ok: boolean }>;
  };
  cloud: {
    test: (
      provider: 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'groq' | 'mistral' | 'xai',
    ) => Promise<{ ok: boolean; models: number; error?: string }>;
  };
  usage: {
    record: (row: {
      chatId: string;
      agentId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    }) => Promise<{ ok: boolean }>;
    list: (
      chatId?: string,
    ) => Promise<import('@shared/ipc-channels').UsageListResponse>;
    summary: () => Promise<import('@shared/ipc-channels').UsageSummaryResponse>;
  };
  schedules: {
    list: () => Promise<import('@shared/ipc-channels').SchedulesListResponse>;
    create: (row: {
      agentId: string;
      prompt: string;
      intervalMinutes: number;
    }) => Promise<import('@shared/ipc-channels').SchedulesCreateResponse>;
    delete: (id: string) => Promise<import('@shared/ipc-channels').SchedulesDeleteResponse>;
    toggle: (id: string, enabled: boolean) =>
      Promise<import('@shared/ipc-channels').SchedulesToggleResponse>;
  };
  routines: {
    list: () => Promise<import('@shared/ipc-channels').RoutinesListResponse>;
    create: (row: {
      name: string;
      agentId: string;
      prompt: string;
      schedule: import('@shared/ipc-channels').RoutineSchedule;
      target?: import('@shared/ipc-channels').RoutineTarget;
    }) => Promise<import('@shared/ipc-channels').RoutinesCreateResponse>;
    update: (row: {
      id: string;
      name?: string;
      prompt?: string;
      agentId?: string;
      schedule?: import('@shared/ipc-channels').RoutineSchedule;
      target?: import('@shared/ipc-channels').RoutineTarget | null;
    }) => Promise<import('@shared/ipc-channels').RoutinesUpdateResponse>;
    delete: (id: string) => Promise<import('@shared/ipc-channels').RoutinesDeleteResponse>;
    toggle: (id: string, enabled: boolean) =>
      Promise<import('@shared/ipc-channels').RoutinesToggleResponse>;
    runNow: (id: string) => Promise<import('@shared/ipc-channels').RoutinesRunNowResponse>;
  };
  zoom: {
    saveCreds: (creds: {
      accountId: string;
      clientId: string;
      clientSecret: string;
    }) => Promise<{ ok: boolean }>;
    test: () => Promise<{ ok: boolean; error?: string }>;
    record: (req: {
      meetingId?: string;
      topic?: string;
      agentId: string;
      connectionId: string;
      model?: string;
    }) => Promise<import('@shared/ipc-channels').ZoomRecordResponse>;
    jobs: () => Promise<import('@shared/ipc-channels').ZoomJobsResponse>;
    openRecording: (path: string) => Promise<{ ok: boolean }>;
  };
  capture: {
    start: (req: {
      title: string;
      agentId: string;
      connectionId: string;
      model?: string;
    }) => Promise<import('@shared/ipc-channels').CaptureStartResponse>;
    chunk: (captureId: string, data: ArrayBuffer) => Promise<{ ok: boolean }>;
    stop: (captureId: string) => Promise<{ ok: boolean }>;
    jobs: () => Promise<import('@shared/ipc-channels').CaptureJobsResponse>;
    saveTranscriber: (cfg: {
      mode: 'openai' | 'cli';
      url?: string;
      apiKey?: string;
      model?: string;
      command?: string;
    }) => Promise<{ ok: boolean }>;
    testTranscriber: () => Promise<{ ok: boolean; error?: string }>;
  };
  business: {
    getProfile: () => Promise<import('@shared/ipc-channels').BusinessGetProfileResponse>;
    saveProfile: (profile: {
      name: string;
      product: string;
      audience: string;
      goals: string[];
      links?: { site?: string; repo?: string };
      schedule: { enabled: boolean; time: string };
    }) => Promise<import('@shared/ipc-channels').BusinessSaveProfileResponse>;
    runSprint: () => Promise<import('@shared/ipc-channels').BusinessRunSprintResponse>;
    sprints: () => Promise<import('@shared/ipc-channels').BusinessSprintsResponse>;
    actions: () => Promise<import('@shared/ipc-channels').BusinessActionsResponse>;
    approve: (actionId: string) => Promise<{ ok: boolean; error?: string }>;
    reject: (actionId: string) => Promise<{ ok: boolean; error?: string }>;
    feed: (limit?: number) => Promise<import('@shared/ipc-channels').BusinessFeedResponse>;
    subscribeFeed: (
      cb: (event: import('@shared/ipc-channels').BusinessFeedEventDto) => void,
    ) => () => void;
  };
  stocks: {
    quote: (symbol: string) => Promise<import('@shared/ipc-channels').StockQuoteResponse>;
    history: (
      symbol: string,
      range?: import('@shared/ipc-channels').StocksRange,
    ) => Promise<import('@shared/ipc-channels').StockHistoryResponse>;
    analyze: (args: {
      symbol: string;
      range?: import('@shared/ipc-channels').StocksRange;
      account?: number;
      riskPct?: number;
      horizon?: number;
    }) => Promise<import('@shared/ipc-channels').StockAnalysisResponse>;
    getWatchlist: () => Promise<import('@shared/ipc-channels').StockWatchlistResponse>;
    setWatchlist: (
      symbols: string[],
    ) => Promise<import('@shared/ipc-channels').StockWatchlistResponse>;
  };
}

declare global {
  interface Window {
    flowstate: FlowstateApi;
  }
}

export const ipc: FlowstateApi = window.flowstate;
