// Agent Library — the built-in agents are templates. A fresh install gets a
// small core set; everything else is one click away in the Library instead
// of crowding the dashboard. A seed ledger (settings key) records every
// template ever seeded, so an agent the user deletes stays deleted.
// Pure decisions only; index.ts and the chat IPC do the DB writes.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SeedAgent } from './seed-agents';
import type { ToolGroupId } from '@shared/tool-groups';
import type { ChatRepository, AgentRow } from '@main/repos/chat-repository';

/** Settings key: JSON array of template ids that have been seeded once. */
export const SEED_LEDGER_KEY = 'agent_seed_ledger';

/** Seeded on a fresh install; the rest wait in the Library. */
export const CORE_AGENT_IDS = [
  'agent-code-helper',
  'agent-researcher',
  'agent-writer',
  'agent-ops',
  'agent-data-analyst',
  'agent-planner',
  'agent-tutor',
  'agent-stock-researcher',
] as const;

const BRAIN_TAGS = new Set([
  'research', 'notes', 'synthesis', 'writing', 'planning', 'pm', 'business', 'reports',
  'meetings', 'ideas', 'brainstorm', 'teaching', 'documentation', 'rag',
]);
const DESIGN_TAGS = new Set([
  'vibecoding', 'design', 'frontend', '3d', 'motion', 'animation', 'landing', 'theme',
  'components', 'images', 'canvas',
]);
const MARKET_TAGS = new Set(['stocks', 'trading', 'crypto']);

/** A template's toolset, from its specialty tags: web, skills and connectors
 *  for everyone; brain/design/markets only where the agent's job needs them. */
export function templateGroups(tags: readonly string[]): ToolGroupId[] {
  const groups: ToolGroupId[] = ['web', 'skills', 'mcp'];
  if (tags.some((t) => BRAIN_TAGS.has(t))) groups.push('brain');
  if (tags.some((t) => DESIGN_TAGS.has(t))) groups.push('design');
  if (tags.some((t) => MARKET_TAGS.has(t))) groups.push('markets');
  return groups;
}

export function parseLedger(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export interface SeedPlan {
  /** Template ids to create now. */
  create: string[];
  /** The ledger to store afterwards. */
  ledger: string[];
  /** True once per existing install: the old build seeded every template on
   *  every launch, so run the one-time Library cleanup. */
  upgrade: boolean;
}

export function planSeeding(input: {
  templateIds: readonly string[];
  existingIds: ReadonlySet<string>;
  ledger: string[] | null;
}): SeedPlan {
  const core = CORE_AGENT_IDS.filter((id) => input.templateIds.includes(id));
  if (input.ledger === null) {
    const upgrade = input.templateIds.some((id) => input.existingIds.has(id));
    if (upgrade) {
      // Every template was seeded before; recreate nothing that's missing.
      return { create: [], ledger: [...input.templateIds], upgrade: true };
    }
    const create = core.filter((id) => !input.existingIds.has(id));
    return { create, ledger: [...core], upgrade: false };
  }
  // Steady state: only core templates added by a newer build get seeded.
  const seen = new Set(input.ledger);
  const create = core.filter((id) => !seen.has(id) && !input.existingIds.has(id));
  return { create, ledger: [...input.ledger, ...create], upgrade: false };
}

/** Create an agent from a template, with its toolset and (when given) a
 *  model that is actually installed instead of the template's default. */
export async function createFromTemplate(
  repo: ChatRepository,
  template: SeedAgent,
  workspacesDir: string,
  model?: string,
): Promise<AgentRow> {
  const wsPath = join(workspacesDir, template.workspaceSlug);
  await mkdir(wsPath, { recursive: true }).catch(() => {});
  return repo.createAgent({
    id: template.id,
    name: template.name,
    description: template.description,
    specialtyTags: template.specialtyTags,
    systemPrompt: template.systemPrompt,
    model: model || template.model,
    avatarColor: template.avatarColor,
    workspacePath: wsPath,
    toolPerms: { ...template.toolPerms, groups: templateGroups(template.specialtyTags) },
    approvalPolicy: template.approvalPolicy,
  });
}

export interface AgentLike {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

/** Upgrade cleanup: template agents the user never touched (non-core, still
 *  identical to the template, no chats, no routine) move back to the Library. */
export function cleanupCandidates(input: {
  agents: readonly AgentLike[];
  templates: readonly SeedAgent[];
  chatCounts: ReadonlyMap<string, number>;
  referencedIds: ReadonlySet<string>;
}): string[] {
  const byId = new Map(input.templates.map((t) => [t.id, t]));
  const core = new Set<string>(CORE_AGENT_IDS);
  return input.agents
    .filter((a) => {
      const t = byId.get(a.id);
      if (!t || core.has(a.id)) return false;
      if ((input.chatCounts.get(a.id) ?? 0) > 0 || input.referencedIds.has(a.id)) return false;
      return a.name === t.name && a.description === t.description && a.systemPrompt === t.systemPrompt;
    })
    .map((a) => a.id);
}
