// Picks the best installed model for each agent given the host's hardware.
// Runs at startup and whenever the user clicks "auto-assign models" in the
// UI. Uses the curated catalog's scoreCatalog() for hardware-fit ranking,
// then re-ranks by category (code / reasoning / vision / general) and
// tools support.

import type { AgentRow } from '@main/repos/chat-repository';
import type { HardwareInfo } from './hardware-info';
import { CATALOG, scoreCatalog, type ModelFit, type CloudAvailability } from './model-catalog';

export type AgentCategory = 'code' | 'reasoning' | 'vision' | 'general';

interface AvailableModel {
  name: string;
}

const KEYWORD_RULES: Array<{ category: AgentCategory; keywords: readonly string[] }> = [
  { category: 'code', keywords: ['code', 'coder', 'dev', 'develop', 'engineer', 'program', 'refactor', 'review', 'test', 'qa', 'bug', 'cli', 'shell', 'devops', 'docker', 'kubernetes', 'sql', 'database', 'frontend', 'backend', 'mobile', 'regex', 'git'] },
  { category: 'reasoning', keywords: ['reason', 'logic', 'plan', 'strategy', 'analy', 'research', 'think', 'tutor', 'teach', 'math', 'science'] },
  { category: 'vision', keywords: ['vision', 'image', 'screenshot', 'photo', 'visual', 'ocr'] },
];

export function inferCategory(agent: AgentRow): AgentCategory {
  const hay = (
    agent.id +
    ' ' +
    agent.name +
    ' ' +
    agent.description +
    ' ' +
    agent.specialtyTags.join(' ')
  ).toLowerCase();
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw)) return rule.category;
    }
  }
  return 'general';
}

export interface ModelMatch {
  agentId: string;
  previousModel: string;
  pickedModel: string | null;
  reason: string;
}

/**
 * Pick the best installed model for one agent. Returns null when nothing
 * installed fits the agent's category — caller should leave the existing
 * model alone (UI Models page surfaces an install suggestion).
 */
export function pickModelForAgent(
  agent: AgentRow,
  hardware: HardwareInfo,
  installed: Set<string>,
  cloudAvailable: CloudAvailability = { anthropic: false, openai: false, gemini: false, perplexity: false, groq: false, mistral: false, xai: false },
): { modelId: string | null; reason: string } {
  const category = inferCategory(agent);
  const scored = scoreCatalog(hardware, cloudAvailable);

  // Cloud models are "always installed" when their key is set.
  const isAvailable = (m: ModelFit): boolean =>
    (m.model.cloud ? Boolean(cloudAvailable[m.model.cloud]) : installed.has(m.model.id)) &&
    m.fit !== 'no';

  // 1. Try category-matching, runnable
  let candidates: ModelFit[] = scored.filter(
    (s) =>
      isAvailable(s) &&
      s.model.tags.includes(category as 'code' | 'reasoning' | 'vision' | 'general'),
  );

  // 2. Fallback to general if category-specific lookup is empty
  if (candidates.length === 0 && category !== 'general') {
    candidates = scored.filter(
      (s) => isAvailable(s) && s.model.tags.includes('general'),
    );
  }

  // 3. Final fallback — any runnable model
  if (candidates.length === 0) {
    candidates = scored.filter(isAvailable);
  }

  if (candidates.length === 0) {
    return {
      modelId: null,
      reason: 'No installed model fits this hardware. Pull a model from the Models page.',
    };
  }

  // Rank: tools-capable beats not, then by composite score.
  candidates.sort((a, b) => {
    if (a.model.toolsCapable !== b.model.toolsCapable) {
      return a.model.toolsCapable ? -1 : 1;
    }
    return b.score - a.score;
  });

  const best = candidates[0]!;
  const reason =
    `Picked for ${category} use — ${best.model.qualityTier} quality, ${best.estTokPerSec} tok/s ` +
    `(${best.fit.toUpperCase()}). ${best.model.toolsCapable ? 'Tools-capable.' : 'No native tools.'}`;
  return { modelId: best.model.id, reason };
}

/**
 * Pick best models for a batch of agents. Returns one ModelMatch per agent.
 * Only suggests a change if the new pick differs from the current model.
 * If the current model is installed AND matches the inferred category AND
 * is tools-capable when needed, it's preserved (avoid churn).
 */
export function pickModelsForAgents(
  agents: AgentRow[],
  hardware: HardwareInfo,
  installedNames: string[],
  cloudAvailable: CloudAvailability = { anthropic: false, openai: false, gemini: false, perplexity: false, groq: false, mistral: false, xai: false },
): ModelMatch[] {
  const installed = new Set(installedNames);

  // Decide if a given model id is "available" — installed locally OR a
  // cloud model whose API key is set.
  const isCurrentAvailable = (modelId: string): boolean => {
    if (installed.has(modelId)) return true;
    const entry = CATALOG.find((m) => m.id === modelId);
    if (entry?.cloud) return Boolean(cloudAvailable[entry.cloud]);
    return false;
  };

  return agents.map((agent) => {
    const currentEntry = CATALOG.find((m) => m.id === agent.model);
    const inferredCategory = inferCategory(agent);
    if (
      currentEntry &&
      isCurrentAvailable(agent.model) &&
      currentEntry.tags.includes(inferredCategory as 'code' | 'reasoning' | 'vision' | 'general')
    ) {
      return {
        agentId: agent.id,
        previousModel: agent.model,
        pickedModel: agent.model,
        reason: 'Current model already matches agent purpose — kept.',
      };
    }
    const { modelId, reason } = pickModelForAgent(agent, hardware, installed, cloudAvailable);
    return {
      agentId: agent.id,
      previousModel: agent.model,
      pickedModel: modelId,
      reason,
    };
  });
}

/** Convenience: fetch installed models from provider safely. */
export async function fetchInstalledModelNames(
  provider: { listModels(): Promise<AvailableModel[]> },
): Promise<string[]> {
  try {
    const installed = await provider.listModels();
    return installed.map((m) => m.name);
  } catch {
    return [];
  }
}
