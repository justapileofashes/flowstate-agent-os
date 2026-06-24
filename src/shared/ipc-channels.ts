import { z } from 'zod';

export const CHANNELS = {
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_LIST: 'settings:list',
  OLLAMA_HEALTH: 'ollama:health',
  CHAT_LIST_AGENTS: 'chat:list-agents',
  CHAT_LIST_CHATS: 'chat:list-chats',
  CHAT_CREATE_CHAT: 'chat:create-chat',
  CHAT_GET_MESSAGES: 'chat:get-messages',
  CHAT_SEND_MESSAGE: 'chat:send-message',
  CHAT_ABORT: 'chat:abort',
  CHAT_CREATE_AGENT: 'chat:create-agent',
  CHAT_UPDATE_AGENT: 'chat:update-agent',
  CHAT_DELETE_AGENT: 'chat:delete-agent',
  CHAT_LIST_MODELS: 'chat:list-models',
  CHAT_ACTIVE_STREAMS: 'chat:active-streams',
  CHAT_APPROVAL_RESPONSE: 'chat:approval-response',
  CHAT_ROUTE: 'chat:route',
  FILES_LIST: 'files:list',
  FILES_READ: 'files:read',
  SHELL_OPEN_PATH: 'shell:open-path',
  SHELL_OPEN_VSCODE: 'shell:open-vscode',
  SHELL_OPEN_URL: 'shell:open-url',
  CLOUD_TEST_CONNECTION: 'cloud:test-connection',
  OLLAMA_PULL: 'ollama:pull',
  OLLAMA_PULL_CANCEL: 'ollama:pull-cancel',
  CHAT_TEAM_RUN: 'chat:team-run',
  CHAT_TEAM_ABORT: 'chat:team-abort',
  CHAT_TEAM_NUDGE: 'chat:team-nudge',
  CHAT_LIST_RECENT_CHATS: 'chat:list-recent-chats',
  CHAT_DELETE_CHAT: 'chat:delete-chat',
  CHAT_RENAME_CHAT: 'chat:rename-chat',
  CHAT_GENERATE_AGENT: 'chat:generate-agent',
  MODELS_HARDWARE: 'models:hardware',
  MODELS_CATALOG: 'models:catalog',
  MCP_LIST: 'mcp:list',
  MCP_SAVE: 'mcp:save',
  MCP_TEST: 'mcp:test',
  MCP_STATUS: 'mcp:status',
  FLOWCLAW_LIST: 'flowclaw:list',
  FLOWCLAW_SAVE: 'flowclaw:save',
  FLOWCLAW_TEST: 'flowclaw:test',
  FLOWCLAW_REMOVE: 'flowclaw:remove',
  ZOOM_SAVE_CREDS: 'zoom:save-creds',
  ZOOM_TEST: 'zoom:test',
  ZOOM_RECORD: 'zoom:record',
  ZOOM_JOBS: 'zoom:jobs',
  ZOOM_OPEN_RECORDING: 'zoom:open-recording',
  CAPTURE_START: 'capture:start',
  CAPTURE_CHUNK: 'capture:chunk',
  CAPTURE_STOP: 'capture:stop',
  CAPTURE_JOBS: 'capture:jobs',
  CAPTURE_SAVE_TRANSCRIBER: 'capture:save-transcriber',
  CAPTURE_TEST_TRANSCRIBER: 'capture:test-transcriber',
  BUSINESS_GET_PROFILE: 'business:get-profile',
  BUSINESS_SAVE_PROFILE: 'business:save-profile',
  BUSINESS_RUN_SPRINT: 'business:run-sprint',
  BUSINESS_SPRINTS: 'business:sprints',
  BUSINESS_ACTIONS: 'business:actions',
  BUSINESS_APPROVE: 'business:approve',
  BUSINESS_REJECT: 'business:reject',
  BUSINESS_FEED: 'business:feed',
  BUSINESS_FEED_EVENT: 'business:feed-event', // broadcast main → renderer
  AGENTS_AUTO_ASSIGN_MODELS: 'agents:auto-assign-models',
  BRAIN_STATUS: 'brain:status',
  BRAIN_LIST: 'brain:list',
  BRAIN_READ: 'brain:read',
  BRAIN_WRITE: 'brain:write',
  BRAIN_CAPTURE: 'brain:capture',
  BRAIN_SEARCH: 'brain:search',
  BRAIN_OPEN_VAULT: 'brain:open-vault',
  BRAIN_SET_VAULT: 'brain:set-vault',
  SNAPSHOTS_LIST: 'snapshots:list',
  SNAPSHOTS_CREATE: 'snapshots:create',
  SNAPSHOTS_RESTORE: 'snapshots:restore',
  SNAPSHOTS_DELETE: 'snapshots:delete',
  AUDIT_LIST: 'audit:list',
  AUDIT_CLEAR: 'audit:clear',
  OLLAMA_START: 'ollama:start',
  OLLAMA_LIBRARY_SEARCH: 'ollama:library-search',
  OLLAMA_CLOUD_SIGNIN: 'ollama:cloud-signin',
  OLLAMA_CLOUD_STATUS: 'ollama:cloud-status',
  OLLAMA_CLOUD_SIGNOUT: 'ollama:cloud-signout',
  CHAT_SEARCH: 'chat:search',
  CHAT_FORK: 'chat:fork',
  USAGE_RECORD: 'usage:record',
  USAGE_LIST: 'usage:list',
  SCHEDULES_LIST: 'schedules:list',
  SCHEDULES_CREATE: 'schedules:create',
  SCHEDULES_DELETE: 'schedules:delete',
  SCHEDULES_TOGGLE: 'schedules:toggle',
  ROUTINES_LIST: 'routines:list',
  ROUTINES_CREATE: 'routines:create',
  ROUTINES_UPDATE: 'routines:update',
  ROUTINES_DELETE: 'routines:delete',
  ROUTINES_TOGGLE: 'routines:toggle',
  ROUTINES_RUN_NOW: 'routines:run-now',
  WINDOW_POP_CHAT: 'window:pop-chat',
  AGENTS_EXPORT_PACK: 'agents:export-pack',
  AGENTS_IMPORT_PACK: 'agents:import-pack',
  SYSTEM_STATS_GET: 'system:stats-get',
  CHAT_EXPORT_RUN: 'chat:export-run',
  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_SAVE: 'snippets:save',
  SNIPPETS_DELETE: 'snippets:delete',
  USER_COMMANDS_LIST: 'user-commands:list',
  USER_COMMANDS_SAVE: 'user-commands:save',
  BUDGET_EVALUATE: 'budget:evaluate',
  BUDGET_GET_CAPS: 'budget:get-caps',
  BUDGET_SET_CAPS: 'budget:set-caps',
  MENTIONS_RESOLVE: 'mentions:resolve',
  PROJECT_CONTEXT_LOAD: 'project-context:load',
  PROMPT_PREFLIGHT: 'prompt:preflight',
  ENV_DOCTOR_RUN: 'env-doctor:run',
  PINS_LIST: 'pins:list',
  PINS_TOGGLE: 'pins:toggle',
  PROMPT_HISTORY_GET: 'prompt-history:get',
  PROMPT_HISTORY_PUSH: 'prompt-history:push',
  USAGE_SUMMARY: 'usage:summary',
  CLIS_DETECT: 'clis:detect',
  CLIS_GET: 'clis:get',
  CLIS_CONNECT: 'clis:connect',
  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',
  FLOWCLAW_RUN_TASK: 'flowclaw:run-task',
  FLOWCLAW_SKILLS_LIST: 'flowclaw:skills-list',
  FLOWCLAW_SKILL_INSTALL: 'flowclaw:skill-install',
  FLOWCLAW_MEMORY_GET: 'flowclaw:memory-get',
  FLOWCLAW_MEMORY_SET: 'flowclaw:memory-set',
  FLOWCLAW_FILES_LIST: 'flowclaw:files-list',
  FLOWCLAW_FILE_READ: 'flowclaw:file-read',
  FLOWCLAW_SEARCH: 'flowclaw:search',
  FLOWCLAW_SEND_MESSAGE: 'flowclaw:send-message',
  FLOWCLAW_MSG_PROVIDERS: 'flowclaw:messaging-providers',
  FLOWCLAW_MSG_LIST: 'flowclaw:messaging-list',
  FLOWCLAW_MSG_CONNECT: 'flowclaw:messaging-connect',
  FLOWCLAW_MSG_DISCONNECT: 'flowclaw:messaging-disconnect',
  FLOWCLAW_AUTOMATION_LIST: 'flowclaw:automation-list',
  FLOWCLAW_AUTOMATION_CREATE: 'flowclaw:automation-create',
  FLOWCLAW_AUTOMATION_DELETE: 'flowclaw:automation-delete',
  FLOWCLAW_AUTOMATION_TOGGLE: 'flowclaw:automation-toggle',
  STOCKS_QUOTE: 'stocks:quote',
  STOCKS_HISTORY: 'stocks:history',
  STOCKS_ANALYZE: 'stocks:analyze',
  STOCKS_WATCHLIST_GET: 'stocks:watchlist-get',
  STOCKS_WATCHLIST_SET: 'stocks:watchlist-set',
  PLUGINS_LIST: 'plugins:list',
  PLUGINS_STATUS: 'plugins:status',
  PLUGINS_MARKETPLACES: 'plugins:marketplaces',
  PLUGINS_ADD_MARKETPLACE: 'plugins:add-marketplace',
  PLUGINS_REFRESH_MARKETPLACE: 'plugins:refresh-marketplace',
  PLUGINS_REMOVE_MARKETPLACE: 'plugins:remove-marketplace',
  PLUGINS_BROWSE: 'plugins:browse',
  PLUGINS_INSTALL: 'plugins:install',
  PLUGINS_INSTALL_LOCAL: 'plugins:install-local',
  PLUGINS_UNINSTALL: 'plugins:uninstall',
  PLUGINS_SET_ENABLED: 'plugins:set-enabled',
  PLUGINS_SET_HOOKS_CONSENT: 'plugins:set-hooks-consent',
  PLUGINS_LIST_SKILLS: 'plugins:list-skills',
  PLUGINS_SET_AGENT_SKILLS: 'plugins:set-agent-skills',
  PLUGINS_GET_AGENT_SKILLS: 'plugins:get-agent-skills',
  PLUGINS_IMPORT_AGENTS: 'plugins:import-agents',
  TERMINAL_START: 'terminal:start',
  TERMINAL_INPUT: 'terminal:input',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',
} as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export function chatEventChannel(streamId: string): string {
  return `chat:event:${streamId}`;
}

export function chatEventEndChannel(streamId: string): string {
  return `chat:event:${streamId}:end`;
}

const messageDtoSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCalls: z
    .array(z.object({ id: z.string(), name: z.string(), args: z.unknown() }))
    .optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  createdAt: z.number(),
});

const toolPermsSchema = z.object({
  shell_enabled: z.boolean(),
  delete_enabled: z.boolean(),
});

const approvalPolicySchema = z.enum(['cautious', 'trusting', 'yolo']);

const agentDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  specialtyTags: z.array(z.string()),
  avatarColor: z.string(),
  systemPrompt: z.string(),
  model: z.string(),
  workspacePath: z.string(),
  toolPerms: toolPermsSchema,
  approvalPolicy: approvalPolicySchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});

const chatDtoSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Routines — friendly recurring schedule. `interval` = every N minutes;
// `cron` = standard 5-field expression; the rest derive from time/dayOfWeek.
const routineScheduleSchema = z.object({
  frequency: z.enum(['hourly', 'daily', 'weekdays', 'weekly', 'interval', 'cron']),
  time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(), // "HH:MM" 24h, local
  dayOfWeek: z.number().int().min(0).max(6).optional(), // 0=Sun..6=Sat
  intervalMinutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
  cron: z.string().min(1).max(120).optional(),
});

// Where a routine runs. Absent = the local agent (default, existing behavior).
// `flowclaw` routes the run to a configured gateway connection (Hermes/OpenClaw).
const routineTargetSchema = z.object({
  kind: z.literal('flowclaw'),
  connectionId: z.string().min(1),
  model: z.string().optional(),
});

const routineSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentId: z.string(),
  prompt: z.string(),
  schedule: routineScheduleSchema,
  target: routineTargetSchema.optional(),
  enabled: z.boolean(),
  nextRunAt: z.number(),
  lastRunAt: z.number().nullable(),
  lastChatId: z.string().nullable(),
  runCount: z.number().int(),
});

export const schemas = {
  settingsGetRequest: z.object({
    key: z.string().min(1),
  }),
  settingsGetResponse: z.object({
    value: z.string().nullable(),
  }),
  settingsSetRequest: z.object({
    key: z.string().min(1),
    value: z.string(),
  }),
  settingsSetResponse: z.object({
    ok: z.literal(true),
  }),
  settingsListRequest: z.object({}),
  settingsListResponse: z.object({
    items: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  ollamaHealthRequest: z.object({}),
  ollamaHealthResponse: z.object({
    reachable: z.boolean(),
    version: z.string().optional(),
    host: z.string(),
    errorMessage: z.string().optional(),
  }),

  chatListAgentsRequest: z.object({}),
  chatListAgentsResponse: z.object({ agents: z.array(agentDtoSchema) }),

  chatListChatsRequest: z.object({ agentId: z.string().min(1) }),
  chatListChatsResponse: z.object({ chats: z.array(chatDtoSchema) }),

  chatCreateChatRequest: z.object({
    agentId: z.string().min(1),
    title: z.string().optional(),
  }),
  chatCreateChatResponse: z.object({ chat: chatDtoSchema }),

  chatGetMessagesRequest: z.object({ chatId: z.string().min(1) }),
  chatGetMessagesResponse: z.object({ messages: z.array(messageDtoSchema) }),

  chatSendMessageRequest: z.object({
    chatId: z.string().min(1),
    text: z.string().min(1),
  }),
  chatSendMessageResponse: z.object({ streamId: z.string() }),

  chatAbortRequest: z.object({ streamId: z.string().min(1) }),
  chatAbortResponse: z.object({ ok: z.boolean() }),

  chatCreateAgentRequest: z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(200),
    specialtyTags: z.array(z.string()).max(10),
    systemPrompt: z.string().min(1).max(4000),
    model: z.string().min(1),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    toolPerms: toolPermsSchema,
    approvalPolicy: approvalPolicySchema,
  }),
  chatCreateAgentResponse: z.object({ agent: agentDtoSchema }),

  chatUpdateAgentRequest: z.object({
    id: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    description: z.string().max(200),
    specialtyTags: z.array(z.string()).max(10),
    systemPrompt: z.string().min(1).max(4000),
    model: z.string().min(1),
    avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    toolPerms: toolPermsSchema,
    approvalPolicy: approvalPolicySchema,
  }),
  chatUpdateAgentResponse: z.object({ agent: agentDtoSchema }),

  chatDeleteAgentRequest: z.object({ id: z.string().min(1) }),
  chatDeleteAgentResponse: z.object({ ok: z.boolean() }),

  chatListModelsRequest: z.object({}),
  chatListModelsResponse: z.object({
    models: z.array(z.object({ name: z.string(), size: z.number().optional() })),
  }),

  chatApprovalResponseRequest: z.object({
    streamId: z.string().min(1),
    toolCallId: z.string().min(1),
    decision: z.enum(['allow-once', 'allow-rest', 'deny']),
    reason: z.string().optional(),
  }),
  chatApprovalResponseResponse: z.object({ ok: z.boolean() }),

  chatRouteRequest: z.object({ text: z.string().min(1) }),
  chatRouteResponse: z.object({
    agentId: z.string(),
    chatId: z.string(),
    reasoning: z.string(),
    fallback: z.boolean(),
    swarm: z.array(z.string()).default([]),
    /** True when the route kicked off a parallel team run under this
     *  chat. Renderer must NOT auto-send (backend already persisted the
     *  user prompt + is running the coordinator); it should poll the
     *  chat for new messages until run-end. */
    team: z.boolean().default(false),
  }),

  filesListRequest: z.object({
    workspacePath: z.string().min(1),
    subPath: z.string().optional(),
  }),
  filesListResponse: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(['file', 'dir', 'other']),
      }),
    ),
  }),
  filesReadRequest: z.object({
    workspacePath: z.string().min(1),
    relPath: z.string().min(1),
  }),
  filesReadResponse: z.object({
    content: z.string(),
    truncated: z.boolean(),
    sizeBytes: z.number(),
  }),
  shellOpenPathRequest: z.object({ absolutePath: z.string().min(1) }),
  shellOpenPathResponse: z.object({ ok: z.boolean(), error: z.string().optional() }),
  shellOpenVscodeRequest: z.object({ absolutePath: z.string().min(1) }),
  shellOpenVscodeResponse: z.object({ ok: z.boolean() }),
  shellOpenUrlRequest: z.object({ url: z.string().url() }),
  shellOpenUrlResponse: z.object({ ok: z.boolean() }),
  cloudTestConnectionRequest: z.object({
    provider: z.enum(['anthropic', 'openai', 'gemini', 'perplexity', 'groq', 'mistral', 'xai']),
  }),
  cloudTestConnectionResponse: z.object({
    ok: z.boolean(),
    models: z.number().int().nonnegative(),
    error: z.string().optional(),
  }),

  ollamaPullRequest: z.object({ model: z.string().min(1) }),
  ollamaPullResponse: z.object({ pullId: z.string() }),
  ollamaPullCancelRequest: z.object({ pullId: z.string() }),
  ollamaPullCancelResponse: z.object({ ok: z.boolean() }),

  chatTeamRunRequest: z.object({ text: z.string().min(1) }),
  chatTeamRunResponse: z.object({ runId: z.string() }),
  chatTeamAbortRequest: z.object({ runId: z.string().min(1) }),
  chatTeamAbortResponse: z.object({ ok: z.boolean() }),

  chatTeamNudgeRequest: z.object({
    runId: z.string().min(1),
    taskId: z.string().min(1),
    text: z.string().trim().min(1).max(2000),
    interrupt: z.boolean(),
  }),
  chatTeamNudgeResponse: z.object({ ok: z.boolean() }),

  chatListRecentChatsRequest: z.object({ limit: z.number().int().positive().max(200).optional() }),
  chatListRecentChatsResponse: z.object({
    chats: z.array(
      chatDtoSchema.extend({
        agentName: z.string(),
        agentColor: z.string(),
      }),
    ),
  }),

  ollamaStartRequest: z.object({}),
  ollamaStartResponse: z.object({
    ok: z.boolean(),
    mode: z.enum(['tray', 'serve']),
    error: z.string().optional(),
  }),

  ollamaCloudSigninRequest: z.object({}),
  ollamaCloudSigninResponse: z.object({
    ok: z.boolean(),
    output: z.string().default(''),
    error: z.string().optional(),
  }),
  ollamaCloudStatusRequest: z.object({}),
  ollamaCloudStatusResponse: z.object({
    signedIn: z.boolean(),
    user: z.string().default(''),
    error: z.string().optional(),
  }),
  ollamaCloudSignoutRequest: z.object({}),
  ollamaCloudSignoutResponse: z.object({ ok: z.boolean(), error: z.string().optional() }),

  chatSearchRequest: z.object({
    q: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  chatSearchResponse: z.object({
    hits: z.array(
      z.object({
        chatId: z.string(),
        chatTitle: z.string(),
        agentId: z.string(),
        agentName: z.string(),
        role: z.string(),
        snippet: z.string(),
        createdAt: z.number(),
      }),
    ),
  }),

  chatForkRequest: z.object({
    chatId: z.string(),
    untilMessageId: z.string().optional(),
    title: z.string().optional(),
  }),
  chatForkResponse: z.object({
    chatId: z.string(),
    agentId: z.string(),
  }),

  usageRecordRequest: z.object({
    chatId: z.string(),
    agentId: z.string(),
    model: z.string(),
    promptTokens: z.number().int().min(0),
    completionTokens: z.number().int().min(0),
  }),
  usageRecordResponse: z.object({ ok: z.boolean() }),
  usageListRequest: z.object({
    chatId: z.string().optional(),
  }),
  schedulesListRequest: z.object({}),
  schedulesListResponse: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        agentId: z.string(),
        prompt: z.string(),
        intervalMinutes: z.number().int().min(1),
        enabled: z.boolean(),
        nextRunAt: z.number(),
        lastRunAt: z.number().nullable(),
      }),
    ),
  }),
  schedulesCreateRequest: z.object({
    agentId: z.string(),
    prompt: z.string().min(1),
    intervalMinutes: z.number().int().min(1).max(60 * 24 * 30),
  }),
  schedulesCreateResponse: z.object({ id: z.string() }),
  schedulesDeleteRequest: z.object({ id: z.string() }),
  schedulesDeleteResponse: z.object({ ok: z.boolean() }),
  schedulesToggleRequest: z.object({ id: z.string(), enabled: z.boolean() }),
  schedulesToggleResponse: z.object({ ok: z.boolean() }),

  // ── Routines — cron-style scheduled agent runs (Claude-Code-style) ──────
  routinesListRequest: z.object({}),
  routinesListResponse: z.object({ items: z.array(routineSchema) }),
  routinesCreateRequest: z.object({
    name: z.string().min(1).max(120),
    agentId: z.string(),
    prompt: z.string().min(1),
    schedule: routineScheduleSchema,
    target: routineTargetSchema.optional(),
  }),
  routinesCreateResponse: z.object({ id: z.string(), nextRunAt: z.number() }),
  routinesUpdateRequest: z.object({
    id: z.string(),
    name: z.string().min(1).max(120).optional(),
    prompt: z.string().min(1).optional(),
    agentId: z.string().optional(),
    schedule: routineScheduleSchema.optional(),
    target: routineTargetSchema.nullable().optional(), // null clears -> local agent
  }),
  routinesUpdateResponse: z.object({ ok: z.boolean(), nextRunAt: z.number().optional() }),
  routinesDeleteRequest: z.object({ id: z.string() }),
  routinesDeleteResponse: z.object({ ok: z.boolean() }),
  routinesToggleRequest: z.object({ id: z.string(), enabled: z.boolean() }),
  routinesToggleResponse: z.object({ ok: z.boolean(), nextRunAt: z.number().optional() }),
  routinesRunNowRequest: z.object({ id: z.string() }),
  routinesRunNowResponse: z.object({ ok: z.boolean(), chatId: z.string().optional() }),

  usageListResponse: z.object({
    rows: z.array(
      z.object({
        chatId: z.string(),
        agentId: z.string(),
        model: z.string(),
        promptTokens: z.number(),
        completionTokens: z.number(),
        costUsd: z.number(),
        at: z.number(),
      }),
    ),
    totalUsd: z.number(),
  }),

  ollamaLibrarySearchRequest: z.object({
    q: z.string().default(''),
    limit: z.number().int().min(1).max(200).default(80),
  }),
  ollamaLibrarySearchResponse: z.object({
    models: z.array(
      z.object({
        name: z.string(),
        description: z.string().default(''),
        pullCount: z.string().default(''),
        tagCount: z.number().int().default(0),
        sizes: z.array(z.string()).default([]),
        capabilities: z.array(z.string()).default([]),
        updatedAt: z.string().default(''),
      }),
    ),
    fetchedAt: z.number(),
    error: z.string().optional(),
  }),

  chatDeleteChatRequest: z.object({ chatId: z.string().min(1) }),
  chatDeleteChatResponse: z.object({ ok: z.boolean() }),

  chatRenameChatRequest: z.object({
    chatId: z.string().min(1),
    title: z.string().trim().min(1).max(120),
  }),
  chatRenameChatResponse: z.object({ ok: z.boolean() }),

  chatGenerateAgentRequest: z.object({
    name: z.string().trim().max(60).optional(),
    use: z.string().trim().min(3).max(500),
  }),
  chatGenerateAgentResponse: z.object({ agent: agentDtoSchema }),

  mcpServerSchema: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,30}$/i),
    name: z.string().trim().min(1).max(60),
    command: z.string().trim().min(1).max(500),
    args: z.array(z.string()).max(40),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
  }),
  mcpListRequest: z.object({}),
  mcpSaveRequest: z.object({
    servers: z.array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,30}$/i),
        name: z.string().trim().min(1).max(60),
        command: z.string().trim().min(1).max(500),
        args: z.array(z.string()).max(40),
        env: z.record(z.string()).optional(),
        cwd: z.string().optional(),
      }),
    ),
  }),
  mcpSaveResponse: z.object({ ok: z.boolean() }),
  mcpTestRequest: z.object({
    server: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,30}$/i),
      name: z.string().trim().min(1).max(60),
      command: z.string().trim().min(1).max(500),
      args: z.array(z.string()).max(40),
      env: z.record(z.string()).optional(),
      cwd: z.string().optional(),
    }),
  }),

  pluginsAddMarketplaceRequest: z.object({ source: z.string().trim().min(1).max(500) }),
  pluginsMarketplaceIdRequest: z.object({ id: z.string().trim().min(1).max(60) }),
  pluginsBrowseRequest: z.object({ query: z.string().max(120).optional() }),
  pluginsInstallRequest: z.object({
    marketplaceId: z.string().trim().min(1).max(60),
    pluginName: z.string().trim().min(1).max(120),
  }),
  pluginsInstallLocalRequest: z.object({ path: z.string().trim().min(1).max(1000) }),
  pluginsIdRequest: z.object({ id: z.string().trim().min(1).max(80) }),
  pluginsSetEnabledRequest: z.object({
    id: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
  }),
  pluginsSetHooksConsentRequest: z.object({
    id: z.string().trim().min(1).max(80),
    consent: z.boolean(),
  }),
  pluginsSetAgentSkillsRequest: z.object({
    agentId: z.string().trim().min(1).max(80),
    names: z.array(z.string().max(80)).max(200),
  }),
  pluginsGetAgentSkillsRequest: z.object({ agentId: z.string().trim().min(1).max(80) }),

  terminalStartRequest: z.object({
    id: z.string().trim().min(1).max(80),
    cwd: z.string().trim().min(1).max(1000),
  }),
  terminalInputRequest: z.object({
    id: z.string().trim().min(1).max(80),
    data: z.string().max(10000),
  }),
  terminalKillRequest: z.object({ id: z.string().trim().min(1).max(80) }),

  flowclawConnectionInput: z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/i),
    kind: z.enum(['hermes', 'openclaw']),
    label: z.string().trim().min(1).max(60),
    baseUrl: z.string().trim().min(1).max(300),
    model: z.string().trim().max(120).optional(),
    enabled: z.boolean(),
    // Plaintext token only on write (encrypted at rest by the store); omitted on
    // edit means "keep the existing token".
    token: z.string().max(2000).optional(),
  }),
  flowclawListRequest: z.object({}),
  flowclawSaveRequest: z.object({
    connection: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/i),
      kind: z.enum(['hermes', 'openclaw']),
      label: z.string().trim().min(1).max(60),
      baseUrl: z.string().trim().min(1).max(300),
      model: z.string().trim().max(120).optional(),
      enabled: z.boolean(),
      token: z.string().max(2000).optional(),
    }),
  }),
  flowclawTestRequest: z.object({
    connection: z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/i),
      kind: z.enum(['hermes', 'openclaw']),
      label: z.string().trim().min(1).max(60),
      baseUrl: z.string().trim().min(1).max(300),
      model: z.string().trim().max(120).optional(),
      enabled: z.boolean(),
      token: z.string().max(2000).optional(),
    }),
  }),
  flowclawRemoveRequest: z.object({ id: z.string() }),

  zoomSaveCredsRequest: z.object({
    accountId: z.string().trim().min(1).max(120),
    clientId: z.string().trim().min(1).max(120),
    clientSecret: z.string().trim().min(1).max(300),
  }),
  zoomTestRequest: z.object({}),
  zoomRecordRequest: z
    .object({
      meetingId: z.string().trim().min(1).max(40).optional(),
      topic: z.string().trim().min(1).max(200).optional(),
      agentId: z.string().min(1),
      connectionId: z.string().min(1),
      model: z.string().trim().max(120).optional(),
    })
    .refine((v) => !!v.meetingId || !!v.topic, {
      message: 'meetingId or topic is required',
    }),
  zoomJobsRequest: z.object({}),
  zoomOpenRecordingRequest: z.object({ path: z.string().min(1).max(500) }),

  captureStartRequest: z.object({
    title: z.string().trim().min(1).max(200),
    agentId: z.string().min(1),
    connectionId: z.string().min(1),
    model: z.string().trim().max(120).optional(),
  }),
  // capture:chunk is NOT zod-validated — binary payload over structured clone;
  // the handler checks the shape itself.
  captureStopRequest: z.object({ captureId: z.string().min(1) }),
  captureSaveTranscriberRequest: z.object({
    mode: z.enum(['openai', 'cli']),
    url: z.string().trim().max(500).optional(),
    apiKey: z.string().trim().max(500).optional(),
    model: z.string().trim().max(120).optional(),
    command: z.string().trim().max(1000).optional(),
  }),

  businessSaveProfileRequest: z.object({
    name: z.string().trim().min(1).max(120),
    product: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(500),
    goals: z.array(z.string().trim().min(1).max(300)).min(1).max(10),
    links: z
      .object({
        site: z.string().trim().max(300).optional(),
        repo: z.string().trim().max(300).optional(),
      })
      .optional(),
    schedule: z.object({
      enabled: z.boolean(),
      time: z.string().regex(/^\d{2}:\d{2}$/),
    }),
  }),
  businessActionIdRequest: z.object({ actionId: z.string().min(1) }),
  businessFeedRequest: z.object({
    limit: z.number().int().positive().max(500).optional(),
  }),

  agentsAutoAssignRequest: z.object({}),
  agentsAutoAssignResponse: z.object({
    matches: z.array(
      z.object({
        agentId: z.string(),
        agentName: z.string(),
        previousModel: z.string(),
        pickedModel: z.string().nullable(),
        changed: z.boolean(),
        reason: z.string(),
      }),
    ),
  }),

  brainCategory: z.enum(['inbox', 'projects', 'areas', 'resources', 'archive', 'daily', 'routines']),
  brainListRequest: z.object({
    category: z
      .enum(['inbox', 'projects', 'areas', 'resources', 'archive', 'daily', 'routines'])
      .optional(),
  }),
  brainReadRequest: z.object({ relPath: z.string().min(1).max(500) }),
  brainWriteRequest: z.object({
    category: z.enum(['projects', 'areas', 'resources', 'archive', 'routines']),
    title: z.string().trim().min(1).max(120),
    body: z.string().max(50000),
    tags: z.array(z.string().max(40)).max(20).optional(),
    links: z.array(z.string().max(120)).max(40).optional(),
  }),
  brainCaptureRequest: z.object({
    text: z.string().trim().min(1).max(2000),
    source: z.string().max(60).optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
  }),
  brainSearchRequest: z.object({
    query: z.string().trim().min(1).max(200),
    limit: z.number().int().positive().max(100).optional(),
  }),
  brainSetVaultRequest: z.object({ path: z.string().trim().min(1).max(500) }),

  snapshotsListRequest: z.object({ agentId: z.string().min(1) }),
  snapshotsCreateRequest: z.object({
    agentId: z.string().min(1),
    label: z.string().trim().min(1).max(120),
  }),
  snapshotsRestoreRequest: z.object({
    agentId: z.string().min(1),
    snapshotId: z.string().min(1),
  }),
  snapshotsDeleteRequest: z.object({
    agentId: z.string().min(1),
    snapshotId: z.string().min(1),
  }),

  auditListRequest: z.object({
    agentId: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(1000).optional(),
  }),
  auditClearRequest: z.object({
    agentId: z.string().min(1).optional(),
  }),

  agentsExportPackRequest: z.object({
    ids: z.array(z.string().min(1)).min(1).max(200),
  }),
  agentsExportPackResponse: z.object({
    ok: z.boolean(),
    canceled: z.boolean().optional(),
    path: z.string().optional(),
    count: z.number().int().optional(),
  }),
  agentsImportPackRequest: z.object({}),
  agentsImportPackResponse: z.object({
    ok: z.boolean(),
    canceled: z.boolean().optional(),
    agents: z.array(agentDtoSchema).optional(),
  }),

  systemStatsGetRequest: z.object({}),
  systemStatsGetResponse: z.object({
    at: z.number(),
    cpuPct: z.number(),
    ramUsedMB: z.number(),
    ramTotalMB: z.number(),
    gpu: z
      .object({
        name: z.string(),
        utilPct: z.number(),
        vramUsedMB: z.number(),
        vramTotalMB: z.number(),
      })
      .nullable(),
  }),

  chatExportRunRequest: z.object({ chatId: z.string().min(1) }),
  chatExportRunResponse: z.object({
    ok: z.boolean(),
    canceled: z.boolean().optional(),
    path: z.string().optional(),
  }),

  // --- Prompt snippets ---
  snippetDto: z.object({
    id: z.string(),
    name: z.string(),
    label: z.string(),
    body: z.string(),
  }),
  snippetsListResponse: z.object({
    snippets: z.array(z.object({ id: z.string(), name: z.string(), label: z.string(), body: z.string() })),
  }),
  snippetsSaveRequest: z.object({
    snippet: z.object({
      id: z.string().optional(),
      name: z.string(),
      label: z.string(),
      body: z.string(),
    }),
  }),
  snippetsSaveResponse: z.object({ ok: z.boolean(), error: z.string().optional() }),
  snippetsDeleteRequest: z.object({ id: z.string().min(1) }),
  snippetsDeleteResponse: z.object({ ok: z.boolean() }),

  // --- User slash commands ---
  userCommandDto: z.object({
    cmd: z.string(),
    label: z.string(),
    hint: z.string(),
    template: z.string(),
  }),
  userCommandsListResponse: z.object({
    commands: z.array(z.object({ cmd: z.string(), label: z.string(), hint: z.string(), template: z.string() })),
  }),
  userCommandsSaveRequest: z.object({
    commands: z.array(z.object({ cmd: z.string(), label: z.string(), hint: z.string().optional(), template: z.string() })),
  }),
  userCommandsSaveResponse: z.object({ ok: z.boolean(), error: z.string().optional() }),

  // --- Budget guard ---
  budgetEvaluateRequest: z.object({ chatId: z.string().optional() }),
  budgetEvaluateResponse: z.object({
    level: z.enum(['ok', 'warn', 'block']),
    scope: z.enum(['chat', 'day']).optional(),
    message: z.string().optional(),
  }),
  budgetGetCapsResponse: z.object({
    perChatUsd: z.number(),
    perDayUsd: z.number(),
  }),
  budgetSetCapsRequest: z.object({
    perChatUsd: z.number().min(0),
    perDayUsd: z.number().min(0),
  }),
  budgetSetCapsResponse: z.object({ ok: z.boolean() }),

  // --- @file mentions ---
  mentionsResolveRequest: z.object({ agentId: z.string().min(1), text: z.string() }),
  mentionsResolveResponse: z.object({
    paths: z.array(z.string()),
    contextBlock: z.string(),
  }),

  // --- Project conventions auto-context ---
  projectContextLoadRequest: z.object({ agentId: z.string().min(1) }),
  projectContextLoadResponse: z.object({
    files: z.array(z.string()),
    preamble: z.string(),
  }),

  // --- Token preflight ---
  promptPreflightRequest: z.object({
    text: z.string(),
    contextChars: z.number().optional(),
    model: z.string().optional(),
  }),
  promptPreflightResponse: z.object({
    estTokens: z.number(),
    level: z.enum(['ok', 'warn', 'over', 'unknown']),
    message: z.string().optional(),
  }),

  // --- Environment doctor ---
  envDoctorRunResponse: z.object({
    overall: z.enum(['pass', 'warn', 'fail']),
    checks: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        status: z.enum(['pass', 'warn', 'fail']),
        detail: z.string(),
        hint: z.string().optional(),
      }),
    ),
  }),

  // --- Pinned chats ---
  pinsListResponse: z.object({ pinned: z.array(z.string()) }),
  pinsToggleRequest: z.object({ chatId: z.string().min(1) }),
  pinsToggleResponse: z.object({ pinned: z.array(z.string()) }),

  // --- Composer prompt history ---
  promptHistoryGetResponse: z.object({ history: z.array(z.string()) }),
  promptHistoryPushRequest: z.object({ entry: z.string() }),
  promptHistoryPushResponse: z.object({ history: z.array(z.string()) }),

  // --- Flowclaw gateway capabilities ---
  flowclawRunTaskRequest: z.object({ connectionId: z.string().min(1), prompt: z.string().min(1), model: z.string().optional() }),
  flowclawRunTaskResponse: z.object({ ok: z.boolean(), text: z.string().optional(), error: z.string().optional() }),
  flowclawSkillsListRequest: z.object({ connectionId: z.string().min(1), query: z.string().optional() }),
  flowclawSkillsListResponse: z.object({
    skills: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), installed: z.boolean().optional() })),
  }),
  flowclawSkillInstallRequest: z.object({ connectionId: z.string().min(1), skillId: z.string().min(1) }),
  flowclawMemoryGetRequest: z.object({ connectionId: z.string().min(1), key: z.string().min(1) }),
  flowclawMemoryGetResponse: z.object({ value: z.string().nullable() }),
  flowclawMemorySetRequest: z.object({ connectionId: z.string().min(1), key: z.string().min(1), value: z.string() }),
  flowclawFilesListRequest: z.object({ connectionId: z.string().min(1), path: z.string().optional() }),
  flowclawFilesListResponse: z.object({
    files: z.array(z.object({ path: z.string(), size: z.number().optional(), kind: z.string().optional() })),
  }),
  flowclawFileReadRequest: z.object({ connectionId: z.string().min(1), path: z.string().min(1) }),
  flowclawFileReadResponse: z.object({ content: z.string() }),
  flowclawSearchRequest: z.object({ connectionId: z.string().min(1), query: z.string().min(1), source: z.string().optional() }),
  flowclawSearchResponse: z.object({
    results: z.array(z.object({ title: z.string().optional(), url: z.string().optional(), snippet: z.string().optional() })),
  }),
  flowclawSendMessageRequest: z.object({ connectionId: z.string().min(1), channel: z.string().min(1), text: z.string().min(1) }),
  // ---- messaging-app linking ----
  flowclawMsgScopeRequest: z.object({ connectionId: z.string().min(1) }),
  flowclawMsgProvidersResponse: z.object({
    providers: z.array(z.object({
      id: z.string(), name: z.string(),
      credentialFields: z.array(z.object({ key: z.string(), label: z.string(), secret: z.boolean().optional() })).optional(),
    })),
  }),
  flowclawMsgListResponse: z.object({
    connections: z.array(z.object({
      id: z.string(), provider: z.string(), label: z.string().optional(),
      status: z.enum(['connected', 'connecting', 'error', 'disabled']).optional(),
      error: z.string().optional(),
      channels: z.array(z.object({ id: z.string(), name: z.string().optional() })).optional(),
    })),
  }),
  flowclawMsgConnectRequest: z.object({
    connectionId: z.string().min(1), provider: z.string().min(1),
    credentials: z.record(z.string(), z.string()), label: z.string().optional(),
  }),
  flowclawMsgDisconnectRequest: z.object({ connectionId: z.string().min(1), messagingId: z.string().min(1) }),
  flowclawAutomationDto: z.object({
    id: z.string(), connectionId: z.string(), label: z.string(), prompt: z.string(),
    intervalMinutes: z.number(), enabled: z.boolean(), deliverTo: z.string(),
    createdAt: z.number(), nextRunAt: z.number(), lastRunAt: z.number().nullable(), lastResult: z.string().nullable(),
  }),
  flowclawAutomationListResponse: z.object({ automations: z.array(z.any()) }),
  flowclawAutomationCreateRequest: z.object({
    connectionId: z.string().min(1), label: z.string().min(1), prompt: z.string().min(1),
    intervalMinutes: z.number().int().min(1), deliverTo: z.string().optional(),
  }),
  flowclawAutomationDeleteRequest: z.object({ id: z.string().min(1) }),
  flowclawAutomationToggleRequest: z.object({ id: z.string().min(1), enabled: z.boolean() }),

  backupExportResponse: z.object({
    ok: z.boolean(),
    canceled: z.boolean().optional(),
    path: z.string().optional(),
    agentCount: z.number().optional(),
  }),
  backupImportResponse: z.object({
    ok: z.boolean(),
    canceled: z.boolean().optional(),
    agentsAdded: z.number().optional(),
    settingsRestored: z.number().optional(),
  }),

  usageSummaryResponse: z.object({
    totalUsd: z.number(),
    totalCalls: z.number(),
    totalTokens: z.number(),
    byAgent: z.array(z.object({ agentId: z.string(), costUsd: z.number(), calls: z.number(), tokens: z.number() })),
    byModel: z.array(z.object({ model: z.string(), costUsd: z.number(), calls: z.number() })),
    byDay: z.array(z.object({ day: z.string(), costUsd: z.number() })),
  }),

  stocksRange: z.enum(['1m', '3m', '6m', '1y', '2y', '5y', 'max']),
  stocksSymbolRequest: z.object({
    symbol: z.string().trim().min(1).max(20),
    range: z.enum(['1m', '3m', '6m', '1y', '2y', '5y', 'max']).optional(),
  }),
  stocksAnalyzeRequest: z.object({
    symbol: z.string().trim().min(1).max(20),
    range: z.enum(['1m', '3m', '6m', '1y', '2y', '5y', 'max']).optional(),
    account: z.number().positive().max(1_000_000_000).optional(),
    riskPct: z.number().positive().max(100).optional(),
    horizon: z.number().int().positive().max(120).optional(),
  }),
  stocksWatchlistSetRequest: z.object({
    symbols: z.array(z.string().trim().min(1).max(20)).max(100),
  }),
  clisConnectRequest: z.object({
    ids: z.array(z.string().trim().min(1).max(64)).max(200),
  }),
};

export type StocksRange = z.infer<typeof schemas.stocksRange>;
export interface StockBarDto {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface StockQuoteResponse {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  asOf: string;
}
export interface StockHistoryResponse {
  symbol: string;
  range: StocksRange;
  bars: StockBarDto[];
}
export interface StockFactorDto {
  key: string;
  score: number;
  weight: number;
  note: string;
}
export interface StockPatternDto {
  kind: string;
  label: string;
  bias: string;
  confidence: number;
}
export interface StockAnalysisResponse {
  symbol: string;
  range: StocksRange;
  asOf: string;
  price: number;
  direction: 'buy' | 'hold' | 'sell';
  confidence: number;
  factors: StockFactorDto[];
  entry: number;
  stoploss: number;
  takeProfit: number[];
  rewardRisk: number;
  positionShares?: number;
  rsi: number | null;
  macdHistogram: number | null;
  patterns: StockPatternDto[];
  chartHtml: string;
}
export interface StockWatchlistResponse {
  symbols: string[];
}

export interface DetectedCliDto {
  id: string;
  name: string;
  command: string;
  category: string;
  description: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  docsUrl: string | null;
}

export interface ClisDetectResponse {
  clis: DetectedCliDto[];
}

export interface ClisGetResponse {
  connected: string[];
  onboardingSeen: boolean;
  /** User home dir — default working directory when launching a coding CLI. */
  homeDir: string;
}

export interface SnapshotDto {
  id: string;
  agentId: string;
  workspacePath: string;
  label: string;
  createdAt: number;
  fileCount: number;
  bytes: number;
}

export type AuditEventType = 'tool_call' | 'approval' | 'rollback' | 'checkpoint';

export interface AuditEntryDto {
  id: string;
  ts: number;
  agentId: string;
  chatId: string | null;
  streamId: string | null;
  eventType: AuditEventType;
  toolName: string | null;
  decision: string | null;
  ok: boolean | null;
  durationMs: number | null;
  argSummary: string | null;
  detail: string | null;
}

export function teamEventChannel(runId: string): string {
  return `chat:team-event:${runId}`;
}
export function teamEventEndChannel(runId: string): string {
  return `chat:team-event:${runId}:end`;
}

export interface TeamPlanTaskDto {
  id: string;
  agentId: string;
  agentName: string;
  agentColor: string;
  instruction: string;
}
export interface TeamPlanDto {
  summary: string;
  tasks: TeamPlanTaskDto[];
  synthesizerAgentId: string;
  synthesizerAgentName: string;
  synthesizerAgentColor: string;
}
export type TeamEventDto =
  | { type: 'plan'; runId: string; plan: TeamPlanDto }
  | { type: 'task-start'; taskId: string }
  | { type: 'task-iteration'; taskId: string; iteration: number }
  | { type: 'task-text'; taskId: string; delta: string }
  | { type: 'task-tool'; taskId: string; toolName: string }
  | { type: 'task-nudge-applied'; taskId: string; nudge: string; interrupted: boolean }
  | { type: 'task-done'; taskId: string; output: string; ok: boolean; error?: string }
  | { type: 'synthesis-start'; agentId: string }
  | { type: 'synthesis-text'; delta: string }
  | {
      type: 'run-end';
      reason: 'ok' | 'aborted' | 'error';
      error?: string;
      chatId?: string;
      agentId?: string;
    };

export function ollamaPullProgressChannel(pullId: string): string {
  return `ollama:pull-progress:${pullId}`;
}

export function ollamaPullEndChannel(pullId: string): string {
  return `ollama:pull-progress:${pullId}:end`;
}

export type SettingsGetRequest = z.infer<typeof schemas.settingsGetRequest>;
export type SettingsGetResponse = z.infer<typeof schemas.settingsGetResponse>;
export type SettingsSetRequest = z.infer<typeof schemas.settingsSetRequest>;
export type SettingsSetResponse = z.infer<typeof schemas.settingsSetResponse>;
export type SettingsListResponse = z.infer<typeof schemas.settingsListResponse>;
export type OllamaHealthResponse = z.infer<typeof schemas.ollamaHealthResponse>;

export type ChatListAgentsResponse = z.infer<typeof schemas.chatListAgentsResponse>;
export type ChatListChatsRequest = z.infer<typeof schemas.chatListChatsRequest>;
export type ChatListChatsResponse = z.infer<typeof schemas.chatListChatsResponse>;
export type ChatCreateChatRequest = z.infer<typeof schemas.chatCreateChatRequest>;
export type ChatCreateChatResponse = z.infer<typeof schemas.chatCreateChatResponse>;
export type ChatGetMessagesRequest = z.infer<typeof schemas.chatGetMessagesRequest>;
export type ChatGetMessagesResponse = z.infer<typeof schemas.chatGetMessagesResponse>;
export type ChatSendMessageRequest = z.infer<typeof schemas.chatSendMessageRequest>;
export type ChatSendMessageResponse = z.infer<typeof schemas.chatSendMessageResponse>;
export type ChatAbortRequest = z.infer<typeof schemas.chatAbortRequest>;
export type ChatAbortResponse = z.infer<typeof schemas.chatAbortResponse>;

export type ChatCreateAgentRequest = z.infer<typeof schemas.chatCreateAgentRequest>;
export type ChatCreateAgentResponse = z.infer<typeof schemas.chatCreateAgentResponse>;
export type ChatUpdateAgentRequest = z.infer<typeof schemas.chatUpdateAgentRequest>;
export type ChatUpdateAgentResponse = z.infer<typeof schemas.chatUpdateAgentResponse>;
export type ChatDeleteAgentRequest = z.infer<typeof schemas.chatDeleteAgentRequest>;
export type ChatDeleteAgentResponse = z.infer<typeof schemas.chatDeleteAgentResponse>;
export type ChatListModelsResponse = z.infer<typeof schemas.chatListModelsResponse>;
export type ChatApprovalResponseRequest = z.infer<typeof schemas.chatApprovalResponseRequest>;
export type ChatApprovalResponseResponse = z.infer<typeof schemas.chatApprovalResponseResponse>;
export type ChatRouteRequest = z.infer<typeof schemas.chatRouteRequest>;
export type ChatRouteResponse = z.infer<typeof schemas.chatRouteResponse>;
export type AgentsExportPackRequest = z.infer<typeof schemas.agentsExportPackRequest>;
export type AgentsExportPackResponse = z.infer<typeof schemas.agentsExportPackResponse>;
export type AgentsImportPackResponse = z.infer<typeof schemas.agentsImportPackResponse>;
export type SystemStatsGetResponse = z.infer<typeof schemas.systemStatsGetResponse>;
export type ChatExportRunResponse = z.infer<typeof schemas.chatExportRunResponse>;
export type SnippetDto = z.infer<typeof schemas.snippetDto>;
export type SnippetsListResponse = z.infer<typeof schemas.snippetsListResponse>;
export type SnippetsSaveResponse = z.infer<typeof schemas.snippetsSaveResponse>;
export type UserCommandDto = z.infer<typeof schemas.userCommandDto>;
export type UserCommandsListResponse = z.infer<typeof schemas.userCommandsListResponse>;
export type UserCommandsSaveResponse = z.infer<typeof schemas.userCommandsSaveResponse>;
export type BudgetEvaluateResponse = z.infer<typeof schemas.budgetEvaluateResponse>;
export type BudgetGetCapsResponse = z.infer<typeof schemas.budgetGetCapsResponse>;
export type MentionsResolveResponse = z.infer<typeof schemas.mentionsResolveResponse>;
export type ProjectContextLoadResponse = z.infer<typeof schemas.projectContextLoadResponse>;
export type PromptPreflightResponse = z.infer<typeof schemas.promptPreflightResponse>;
export type EnvDoctorRunResponse = z.infer<typeof schemas.envDoctorRunResponse>;
export type PinsListResponse = z.infer<typeof schemas.pinsListResponse>;
export type PinsToggleResponse = z.infer<typeof schemas.pinsToggleResponse>;
export type PromptHistoryGetResponse = z.infer<typeof schemas.promptHistoryGetResponse>;
export type PromptHistoryPushResponse = z.infer<typeof schemas.promptHistoryPushResponse>;
export type UsageSummaryResponse = z.infer<typeof schemas.usageSummaryResponse>;
export type BackupExportResponse = z.infer<typeof schemas.backupExportResponse>;
export type BackupImportResponse = z.infer<typeof schemas.backupImportResponse>;
export type FlowclawRunTaskResponse = z.infer<typeof schemas.flowclawRunTaskResponse>;
export type FlowclawSkillsListResponse = z.infer<typeof schemas.flowclawSkillsListResponse>;
export type FlowclawMemoryGetResponse = z.infer<typeof schemas.flowclawMemoryGetResponse>;
export type FlowclawFilesListResponse = z.infer<typeof schemas.flowclawFilesListResponse>;
export type FlowclawFileReadResponse = z.infer<typeof schemas.flowclawFileReadResponse>;
export type FlowclawSearchResponse = z.infer<typeof schemas.flowclawSearchResponse>;
export type FlowclawMsgProvidersResponse = z.infer<typeof schemas.flowclawMsgProvidersResponse>;
export type FlowclawMsgListResponse = z.infer<typeof schemas.flowclawMsgListResponse>;
export type FlowclawAutomationDto = z.infer<typeof schemas.flowclawAutomationDto>;
export type FilesListRequest = z.infer<typeof schemas.filesListRequest>;
export type FilesListResponse = z.infer<typeof schemas.filesListResponse>;
export type FilesReadRequest = z.infer<typeof schemas.filesReadRequest>;
export type FilesReadResponse = z.infer<typeof schemas.filesReadResponse>;
export type ShellOpenPathResponse = z.infer<typeof schemas.shellOpenPathResponse>;
export type ShellOpenVscodeResponse = z.infer<typeof schemas.shellOpenVscodeResponse>;
export type OllamaPullResponse = z.infer<typeof schemas.ollamaPullResponse>;
export type OllamaPullCancelResponse = z.infer<typeof schemas.ollamaPullCancelResponse>;
export type ChatTeamRunResponse = z.infer<typeof schemas.chatTeamRunResponse>;
export type ChatTeamAbortResponse = z.infer<typeof schemas.chatTeamAbortResponse>;
export type ChatTeamNudgeRequest = z.infer<typeof schemas.chatTeamNudgeRequest>;
export type ChatTeamNudgeResponse = z.infer<typeof schemas.chatTeamNudgeResponse>;
export type ChatListRecentChatsResponse = z.infer<typeof schemas.chatListRecentChatsResponse>;
export type OllamaStartResponse = z.infer<typeof schemas.ollamaStartResponse>;
export type OllamaLibrarySearchRequest = z.infer<typeof schemas.ollamaLibrarySearchRequest>;
export type OllamaLibrarySearchResponse = z.infer<typeof schemas.ollamaLibrarySearchResponse>;
export type OllamaCloudSigninResponse = z.infer<typeof schemas.ollamaCloudSigninResponse>;
export type OllamaCloudStatusResponse = z.infer<typeof schemas.ollamaCloudStatusResponse>;
export type OllamaCloudSignoutResponse = z.infer<typeof schemas.ollamaCloudSignoutResponse>;
export type ChatSearchRequest = z.infer<typeof schemas.chatSearchRequest>;
export type ChatSearchResponse = z.infer<typeof schemas.chatSearchResponse>;
export type ChatForkRequest = z.infer<typeof schemas.chatForkRequest>;
export type ChatForkResponse = z.infer<typeof schemas.chatForkResponse>;
export type UsageRecordRequest = z.infer<typeof schemas.usageRecordRequest>;
export type UsageRecordResponse = z.infer<typeof schemas.usageRecordResponse>;
export type UsageListRequest = z.infer<typeof schemas.usageListRequest>;
export type UsageListResponse = z.infer<typeof schemas.usageListResponse>;
export type SchedulesListResponse = z.infer<typeof schemas.schedulesListResponse>;
export type SchedulesCreateRequest = z.infer<typeof schemas.schedulesCreateRequest>;
export type SchedulesCreateResponse = z.infer<typeof schemas.schedulesCreateResponse>;
export type SchedulesDeleteResponse = z.infer<typeof schemas.schedulesDeleteResponse>;
export type SchedulesToggleResponse = z.infer<typeof schemas.schedulesToggleResponse>;
export type RoutineSchedule = z.infer<typeof routineScheduleSchema>;
export type RoutineTarget = z.infer<typeof routineTargetSchema>;
export type RoutineDto = z.infer<typeof routineSchema>;
export type RoutinesListResponse = z.infer<typeof schemas.routinesListResponse>;
export type RoutinesCreateRequest = z.infer<typeof schemas.routinesCreateRequest>;
export type RoutinesCreateResponse = z.infer<typeof schemas.routinesCreateResponse>;
export type RoutinesUpdateRequest = z.infer<typeof schemas.routinesUpdateRequest>;
export type RoutinesUpdateResponse = z.infer<typeof schemas.routinesUpdateResponse>;
export type RoutinesDeleteResponse = z.infer<typeof schemas.routinesDeleteResponse>;
export type RoutinesToggleResponse = z.infer<typeof schemas.routinesToggleResponse>;
export type RoutinesRunNowResponse = z.infer<typeof schemas.routinesRunNowResponse>;
export type ChatDeleteChatResponse = z.infer<typeof schemas.chatDeleteChatResponse>;
export type ChatRenameChatResponse = z.infer<typeof schemas.chatRenameChatResponse>;
export type ChatGenerateAgentRequest = z.infer<typeof schemas.chatGenerateAgentRequest>;
export type ChatGenerateAgentResponse = z.infer<typeof schemas.chatGenerateAgentResponse>;

export interface OllamaPullProgress {
  status: string;
  total?: number;
  completed?: number;
  digest?: string;
}

export interface ActiveStreamEntry {
  streamId: string;
  agentId: string;
  chatId: string;
}

export interface ActiveStreamsBroadcast {
  active: ActiveStreamEntry[];
}

export interface HardwareInfoDto {
  platform: string;
  cpuModel: string;
  cpuCount: number;
  ramGB: number;
  gpus: Array<{ name: string; vramMB: number; vendor: string; driverVersion?: string }>;
  primaryVramGB: number;
  /** Inference-speed multiplier vs the reference GPU (1.0 = RTX 4070 Ti Super). */
  perfFactor: number;
  /** Full CPU spec read live from the OS (Windows). */
  cpu?: {
    model: string;
    physicalCores: number;
    logicalCores: number;
    maxClockMHz: number;
    l2CacheKB: number;
    l3CacheKB: number;
  };
  /** Installed RAM sticks read live from the OS (Windows). */
  ramModules?: Array<{
    capacityGB: number;
    speedMHz: number;
    type: string;
    manufacturer: string;
    partNumber: string;
    slot: string;
  }>;
  detectionNotes: string[];
}

export interface CatalogModelDto {
  model: {
    id: string;
    name: string;
    sizeGB: number;
    quality: 1 | 2 | 3 | 4 | 5;
    qualityTier: 'basic' | 'good' | 'great' | 'flagship';
    estTokPerSecGpu: number;
    toolsCapable: boolean;
    tags: Array<'general' | 'code' | 'reasoning' | 'vision' | 'small'>;
    description: string;
  };
  fit: 'gpu' | 'partial' | 'cpu' | 'no';
  estTokPerSec: number;
  score: number;
  reason: string;
  installed: boolean;
}

export interface McpServerDto {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpServerStatusDto {
  id: string;
  name: string;
  command: string;
  args: string[];
  state: 'idle' | 'starting' | 'ready' | 'error' | 'exited';
  toolCount: number;
  lastError: string | null;
}

export interface McpListResponse {
  servers: McpServerDto[];
  status: McpServerStatusDto[];
}

// ── Plugins / skills ───────────────────────────────────────────────────────
export interface PluginDto {
  id: string;
  name: string;
  version: string;
  description: string;
  origin: 'marketplace' | 'local' | 'claude-home';
  marketplaceId?: string;
  enabled: boolean;
  hooksConsent: boolean;
  readOnly: boolean;
  components: { skills: number; commands: number; agents: number; mcp: number; hooks: number };
}

export interface PluginMarketplaceDto {
  id: string;
  name: string;
  source: string;
  addedAt: number;
}

export interface PluginMarketplacePluginDto {
  marketplaceId: string;
  name: string;
  description: string;
  source: string;
  installed: boolean;
}

export interface PluginSkillDto {
  name: string;
  description: string;
  pluginId: string | null;
}

export interface PluginsListResponse {
  plugins: PluginDto[];
}
export interface PluginsMarketplacesResponse {
  marketplaces: PluginMarketplaceDto[];
}
export interface PluginsBrowseResponse {
  plugins: PluginMarketplacePluginDto[];
}
export interface PluginsListSkillsResponse {
  skills: PluginSkillDto[];
}
export interface PluginsStatusBroadcast {
  plugins: PluginDto[];
}

// ── Terminal ───────────────────────────────────────────────────────────────
export interface TerminalDataBroadcast {
  id: string;
  chunk: string;
}
export interface TerminalExitBroadcast {
  id: string;
  code: number | null;
}

/** Result of a transient connection test — spawn, initialize, list tools,
 *  tear down. Never persisted. */
export interface McpTestResultDto {
  ok: boolean;
  toolCount: number;
  tools: string[];
  error: string | null;
}

export interface McpStatusBroadcast {
  status: McpServerStatusDto[];
}

/** A flowclaw gateway connection as exposed to the renderer — never includes
 *  the auth token (write-only; encrypted at rest in the main process). */
export interface FlowclawConnectionDto {
  id: string;
  kind: 'hermes' | 'openclaw';
  label: string;
  baseUrl: string;
  model?: string;
  enabled: boolean;
}

/** Connection form payload from the renderer — may carry a plaintext token on
 *  create/edit. An omitted token on edit preserves the existing one. */
export interface FlowclawConnectionInputDto extends FlowclawConnectionDto {
  token?: string;
}

export interface FlowclawListResponse {
  connections: FlowclawConnectionDto[];
}

/** Result of a transient connection probe (reachability + auth). Not persisted. */
export interface FlowclawTestResultDto {
  ok: boolean;
  status?: number;
  error?: string;
}

// ── Zoom meeting recorder ────────────────────────────────────────────────────

export type ZoomJobStatusDto =
  | 'armed'
  | 'waiting'
  | 'downloading'
  | 'summarizing'
  | 'done'
  | 'error';

export interface ZoomJobDto {
  id: string;
  meetingId: string;
  topic: string;
  agentId: string;
  connectionId: string;
  model?: string;
  status: ZoomJobStatusDto;
  chatId?: string;
  recordingFiles?: string[];
  shareUrl?: string;
  joinUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type ZoomRecordRequest = z.infer<typeof schemas.zoomRecordRequest>;
export interface ZoomRecordResponse {
  jobId: string;
  joinUrl?: string;
  error?: string;
}
export interface ZoomJobsResponse {
  jobs: ZoomJobDto[];
}

// ── System-audio capture (webinar recorder) ─────────────────────────────────

export type CaptureJobStatusDto =
  | 'recording'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'error';

export interface CaptureJobDto {
  id: string;
  title: string;
  agentId: string;
  connectionId: string;
  model?: string;
  status: CaptureJobStatusDto;
  audioPath: string;
  bytes: number;
  chatId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type CaptureStartRequest = z.infer<typeof schemas.captureStartRequest>;
export interface CaptureStartResponse {
  captureId: string;
}
export interface CaptureJobsResponse {
  jobs: CaptureJobDto[];
}

// ── Business autopilot ───────────────────────────────────────────────────────

export interface BusinessProfileDto {
  name: string;
  product: string;
  audience: string;
  goals: string[];
  links: { site?: string; repo?: string };
  roleAgentIds: { strategy: string; marketing: string; ops: string };
  schedule: { enabled: boolean; time: string };
  createdAt: number;
}

export interface BusinessSprintTaskDto {
  id: string;
  role: 'marketing' | 'ops';
  instruction: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
  error?: string;
}

export interface BusinessSprintDto {
  id: string;
  status: 'planning' | 'running' | 'wrapping' | 'done' | 'error';
  goals: string[];
  tasks: BusinessSprintTaskDto[];
  briefing?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ProposedActionDto {
  id: string;
  sprintId: string;
  role: 'strategy' | 'marketing' | 'ops';
  kind: 'email' | 'post' | 'code' | 'other';
  title: string;
  body: string;
  status: 'proposed' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BusinessFeedEventDto {
  id: string;
  ts: number;
  sprintId?: string;
  role?: string;
  kind:
    | 'sprint-start'
    | 'phase'
    | 'task-start'
    | 'task-tool'
    | 'task-done'
    | 'action-proposed'
    | 'action-executed'
    | 'action-failed'
    | 'briefing'
    | 'sprint-end'
    | 'error';
  text: string;
}

export type BusinessSaveProfileRequest = z.infer<typeof schemas.businessSaveProfileRequest>;
export interface BusinessGetProfileResponse {
  profile: BusinessProfileDto | null;
}
export interface BusinessSaveProfileResponse {
  ok: boolean;
  profile: BusinessProfileDto;
}
export interface BusinessRunSprintResponse {
  sprintId?: string;
  error?: string;
}
export interface BusinessSprintsResponse {
  sprints: BusinessSprintDto[];
}
export interface BusinessActionsResponse {
  actions: ProposedActionDto[];
}
export interface BusinessFeedResponse {
  events: BusinessFeedEventDto[];
}

export interface AgentAutoAssignMatchDto {
  agentId: string;
  agentName: string;
  previousModel: string;
  pickedModel: string | null;
  changed: boolean;
  reason: string;
}

export interface AgentsAutoAssignResponse {
  matches: AgentAutoAssignMatchDto[];
}

export type BrainCategoryDto =
  | 'inbox'
  | 'projects'
  | 'areas'
  | 'resources'
  | 'archive'
  | 'daily'
  | 'routines';

export interface BrainNoteDto {
  relPath: string;
  title: string;
  category: BrainCategoryDto | 'other';
  tags: string[];
  links: string[];
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrainListEntryDto {
  relPath: string;
  title: string;
  category: BrainCategoryDto | 'other';
  tags: string[];
  updatedAt: number;
}

export interface BrainStatusDto {
  vaultPath: string;
  initialized: boolean;
  counts: Record<BrainCategoryDto, number>;
  totalNotes: number;
}

export interface BrainSearchHitDto extends BrainListEntryDto {
  snippet: string;
}

export interface ModelsCatalogResponse {
  hardware: HardwareInfoDto;
  catalog: CatalogModelDto[];
  recommendations: {
    balanced: string | null;
    code: string | null;
    fast: string | null;
    top: string[];
  };
  totalCount: number;
}
