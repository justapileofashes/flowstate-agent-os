import type { SettingsService } from '@main/services/settings-service';
import type { OllamaClient } from '@main/services/ollama-client';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';
import type { ApprovalGate } from '@main/agent/approval-gate';
import type { LLMProvider } from '@main/agent/llm-provider';
import type { Orchestrator } from '@main/agent/orchestrator';
import type { Coordinator } from '@main/agent/coordinator';
import type { AgentGenerator } from '@main/agent/agent-generator';
import { registerSettingsHandlers } from './handlers/settings';
import { registerOllamaHandlers } from './handlers/ollama';
import { registerChatHandlers } from './handlers/chat';
import { registerFileHandlers } from './handlers/files';
import { registerModelsHandlers } from './handlers/models';
import { registerMcpHandlers } from './handlers/mcp';
import { registerFlowclawHandlers } from './handlers/flowclaw';
import { registerZoomHandlers } from './handlers/zoom';
import { registerCaptureHandlers } from './handlers/capture';
import { registerBusinessHandlers } from './handlers/business';
import { registerBrainHandlers } from './handlers/brain';
import { registerSnapshotsHandlers } from './handlers/snapshots';
import { registerAuditHandlers } from './handlers/audit';
import { registerCloudHandlers } from './handlers/cloud';
import { registerUsageHandlers } from './handlers/usage';
import { registerScheduleHandlers } from './handlers/schedules';
import { registerRoutineHandlers } from './handlers/routines';
import { registerAgentPackHandlers } from './handlers/agent-pack';
import { registerDevToolsHandlers } from './handlers/dev-tools';
import { registerBackupHandlers } from './handlers/backup';
import { registerObservabilityHandlers } from './handlers/observability';
import { registerClisHandlers } from './handlers/clis';
import { registerStocksHandlers } from './handlers/stocks';
import { registerPluginHandlers } from './handlers/plugins';
import { registerTerminalHandlers } from './handlers/terminal';
import type { McpManager } from '@main/services/mcp-manager';
import type { PluginManager } from '@main/services/plugin-manager';
import type { SecondBrain } from '@main/services/second-brain';
import type { SnapshotService } from '@main/services/snapshot-service';
import type { AuditRepository } from '@main/repos/audit-repository';
import type { AuditLogger } from '@main/services/audit-logger';
import type { Database } from 'better-sqlite3';

export function registerIpcHandlers(deps: {
  settings: SettingsService;
  ollama: OllamaClient;
  repo: ChatRepository;
  manager: AgentSessionManager;
  approvalGate: ApprovalGate;
  provider: LLMProvider;
  orchestrator: Orchestrator;
  coordinator: Coordinator;
  agentGenerator: AgentGenerator;
  mcpManager: McpManager;
  pluginManager: PluginManager;
  brain: SecondBrain;
  snapshots: SnapshotService;
  auditRepo: AuditRepository;
  audit: AuditLogger;
  anthropic: LLMProvider;
  openai: LLMProvider;
  gemini: LLMProvider;
  perplexity: LLMProvider;
  groq: LLMProvider;
  mistral: LLMProvider;
  xai: LLMProvider;
  db: Database;
  workspacesDir: string;
}): void {
  registerSettingsHandlers(deps.settings);
  registerOllamaHandlers(deps.ollama, deps.provider);
  registerChatHandlers({
    repo: deps.repo,
    manager: deps.manager,
    provider: deps.provider,
    orchestrator: deps.orchestrator,
    coordinator: deps.coordinator,
    agentGenerator: deps.agentGenerator,
    workspacesDir: deps.workspacesDir,
  });
  registerFileHandlers();
  registerModelsHandlers(deps.provider, deps.repo, deps.db, deps.settings);
  registerMcpHandlers({ manager: deps.mcpManager, settings: deps.settings });
  registerFlowclawHandlers({ settings: deps.settings });
  registerZoomHandlers({ settings: deps.settings, repo: deps.repo });
  registerCaptureHandlers({ settings: deps.settings, repo: deps.repo });
  registerBusinessHandlers({
    settings: deps.settings,
    repo: deps.repo,
    provider: deps.provider,
    approvalGate: deps.approvalGate,
    workspacesDir: deps.workspacesDir,
    mcpManager: deps.mcpManager,
    brain: deps.brain,
    audit: deps.audit,
    snapshots: deps.snapshots,
  });
  registerBrainHandlers({ brain: deps.brain, settings: deps.settings });
  registerSnapshotsHandlers({ service: deps.snapshots, repo: deps.repo, audit: deps.audit });
  registerAuditHandlers({ repo: deps.auditRepo });
  registerAgentPackHandlers({ repo: deps.repo, workspacesDir: deps.workspacesDir });
  registerObservabilityHandlers({ repo: deps.repo, auditRepo: deps.auditRepo });
  registerUsageHandlers();
  registerClisHandlers({ settings: deps.settings });
  registerStocksHandlers({ settings: deps.settings });
  registerBackupHandlers({ repo: deps.repo, settings: deps.settings, workspacesDir: deps.workspacesDir });
  registerDevToolsHandlers({
    settings: deps.settings,
    repo: deps.repo,
    provider: deps.provider,
    workspacesDir: deps.workspacesDir,
    pluginManager: deps.pluginManager,
  });
  registerPluginHandlers({
    pluginManager: deps.pluginManager,
    mcpManager: deps.mcpManager,
    repo: deps.repo,
    workspacesDir: deps.workspacesDir,
  });
  registerTerminalHandlers();
  registerScheduleHandlers({ repo: deps.repo, manager: deps.manager });
  registerRoutineHandlers({ repo: deps.repo, manager: deps.manager, settings: deps.settings });
  registerCloudHandlers({
    anthropic: deps.anthropic,
    openai: deps.openai,
    gemini: deps.gemini,
    perplexity: deps.perplexity,
    groq: deps.groq,
    mistral: deps.mistral,
    xai: deps.xai,
  });
}
