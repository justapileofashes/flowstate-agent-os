// IPC glue for the Business autopilot. Thin over the tested services:
// BusinessStore (profile/memory/state), BusinessSprintRunner (sprint engine +
// approvals), HeadlessRunner (tool-using role-agent execution). First profile
// save bootstraps the three role agents; feed events broadcast to all windows.

import { app, ipcMain, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { CHANNELS, schemas } from '@shared/ipc-channels';
import type { SettingsService } from '@main/services/settings-service';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { LLMProvider } from '@main/agent/llm-provider';
import type { ApprovalGate } from '@main/agent/approval-gate';
import type { McpManager } from '@main/services/mcp-manager';
import type { SecondBrain } from '@main/services/second-brain';
import type { AuditLogger } from '@main/services/audit-logger';
import type { SnapshotService } from '@main/services/snapshot-service';
import { generateAgentId } from '@main/util/agent-id';
import { BusinessStore, type BusinessFeedEvent } from '@main/services/business-store';
import { BusinessSprintRunner } from '@main/services/business-sprint';
import { HeadlessRunner } from '@main/agent/headless-runner';

const ROLE_AGENTS = [
  {
    role: 'strategy' as const,
    name: 'Business · Strategy Chief',
    description: 'Plans the daily business sprint and writes the owner briefing.',
    specialtyTags: ['strategy', 'planning', 'business'],
    avatarColor: '#d97757',
    systemPrompt:
      'You are the strategy chief of a small company run on autopilot. You plan ' +
      'daily goals from the company profile, memory, and yesterday\'s results, ' +
      'and you write concise, honest briefings for the owner. You never execute ' +
      'outward actions yourself — you plan and evaluate.',
  },
  {
    role: 'marketing' as const,
    name: 'Business · Marketing',
    description: 'Drafts content, campaigns, and outreach for the business.',
    specialtyTags: ['marketing', 'copywriting', 'growth'],
    avatarColor: '#5b8def',
    systemPrompt:
      'You are the marketing lead of a small company run on autopilot. You draft ' +
      'posts, emails, campaigns, and outreach. You NEVER send or publish anything ' +
      'yourself — every outward send is emitted as a proposed-action fenced block ' +
      'for the owner to approve.',
  },
  {
    role: 'ops' as const,
    name: 'Business · Ops',
    description: 'Monitors workflows and metrics, flags issues, preps fixes.',
    specialtyTags: ['operations', 'monitoring', 'process'],
    avatarColor: '#6dbf94',
    systemPrompt:
      'You are the operations lead of a small company run on autopilot. You ' +
      'monitor workflows, metrics, and infrastructure, flag issues early, and ' +
      'prepare fixes. Deploys and other outward changes are emitted as ' +
      'proposed-action fenced blocks for the owner to approve, never executed directly.',
  },
];

export function registerBusinessHandlers(deps: {
  settings: SettingsService;
  repo: ChatRepository;
  provider: LLMProvider;
  approvalGate: ApprovalGate;
  workspacesDir: string;
  mcpManager?: McpManager;
  brain?: SecondBrain;
  audit?: AuditLogger;
  snapshots?: SnapshotService;
}): void {
  const store = new BusinessStore(join(app.getPath('userData'), 'business'));
  const headless = new HeadlessRunner({
    provider: deps.provider,
    repo: deps.repo,
    approvalGate: deps.approvalGate,
    ...(deps.mcpManager ? { mcpManager: deps.mcpManager } : {}),
    ...(deps.brain ? { brain: deps.brain } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.snapshots ? { snapshots: deps.snapshots } : {}),
  });
  const emit = (e: BusinessFeedEvent): void => {
    store.pushFeed(e);
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(CHANNELS.BUSINESS_FEED_EVENT, e);
    }
  };
  const runner = new BusinessSprintRunner({
    store,
    llmOnce: ({ agentId, prompt, json }) => headless.once(agentId, prompt, json),
    tasks: headless,
    emit,
  });
  runner.startScheduler();

  async function pickModel(): Promise<string> {
    const fromSettings = deps.settings.get('orchestrator_model');
    if (fromSettings) return fromSettings;
    try {
      const models = await deps.provider.listModels();
      return models[0]?.name ?? '';
    } catch {
      return '';
    }
  }

  async function ensureRoleAgents(): Promise<{
    strategy: string;
    marketing: string;
    ops: string;
  }> {
    const existing = store.loadProfile()?.roleAgentIds;
    if (existing) {
      // keep ids whose agents still exist; recreate any that were deleted
      const alive = new Set(deps.repo.listAgents().map((a) => a.id));
      if (alive.has(existing.strategy) && alive.has(existing.marketing) && alive.has(existing.ops)) {
        return existing;
      }
    }
    const model = await pickModel();
    const ids = { strategy: '', marketing: '', ops: '' };
    for (const spec of ROLE_AGENTS) {
      const id = generateAgentId(spec.name);
      const workspacePath = join(deps.workspacesDir, id);
      await mkdir(workspacePath, { recursive: true });
      const agent = deps.repo.createAgent({
        id,
        name: spec.name,
        description: spec.description,
        specialtyTags: spec.specialtyTags,
        avatarColor: spec.avatarColor,
        systemPrompt: spec.systemPrompt,
        model,
        workspacePath,
        toolPerms: { shell_enabled: false, delete_enabled: false },
        approvalPolicy: 'yolo',
      });
      ids[spec.role] = agent.id;
    }
    return ids;
  }

  ipcMain.handle(CHANNELS.BUSINESS_GET_PROFILE, () => ({ profile: store.loadProfile() }));

  ipcMain.handle(CHANNELS.BUSINESS_SAVE_PROFILE, async (_e, raw) => {
    const args = schemas.businessSaveProfileRequest.parse(raw);
    const existing = store.loadProfile();
    const roleAgentIds = await ensureRoleAgents();
    const profile = {
      name: args.name,
      product: args.product,
      audience: args.audience,
      goals: args.goals,
      links: args.links ?? {},
      roleAgentIds,
      schedule: args.schedule,
      createdAt: existing?.createdAt ?? Date.now(),
    };
    store.saveProfile(profile);
    deps.audit?.checkpoint(
      { agentId: roleAgentIds.strategy },
      { detail: `business profile saved: ${args.name}` },
    );
    return { ok: true as const, profile };
  });

  ipcMain.handle(CHANNELS.BUSINESS_RUN_SPRINT, () => {
    return runner.runSprint();
  });

  ipcMain.handle(CHANNELS.BUSINESS_SPRINTS, () => ({ sprints: store.sprints() }));

  ipcMain.handle(CHANNELS.BUSINESS_ACTIONS, () => ({ actions: store.actions() }));

  function auditDecision(actionId: string, decision: 'approved' | 'rejected'): void {
    const action = store.actions().find((a) => a.id === actionId);
    const profile = store.loadProfile();
    deps.audit?.approval(
      { agentId: profile?.roleAgentIds.strategy ?? 'business' },
      {
        toolName: 'business-action',
        decision,
        detail: action ? `${action.kind}: ${action.title}` : actionId,
      },
    );
  }

  ipcMain.handle(CHANNELS.BUSINESS_APPROVE, async (_e, raw) => {
    const { actionId } = schemas.businessActionIdRequest.parse(raw);
    auditDecision(actionId, 'approved');
    return runner.approve(actionId);
  });

  ipcMain.handle(CHANNELS.BUSINESS_REJECT, async (_e, raw) => {
    const { actionId } = schemas.businessActionIdRequest.parse(raw);
    auditDecision(actionId, 'rejected');
    return runner.reject(actionId);
  });

  ipcMain.handle(CHANNELS.BUSINESS_FEED, (_e, raw) => {
    const args = schemas.businessFeedRequest.parse(raw ?? {});
    const events = store.feed();
    return { events: args.limit ? events.slice(-args.limit) : events };
  });
}
