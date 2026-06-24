// Orchestrator — deterministic, no-LLM agent routing.
// Picks the best-fit agent (and optionally a small swarm of helpers) by
// scoring specialty-tag overlap + description-keyword overlap + intent
// verbs against the user text. Pure-JS so routing is ~instant.

import type { LLMProvider } from './llm-provider';

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
}

export interface RoutingDecision {
  agentId: string;
  reasoning: string;
  fallback: boolean;
  /** Up to N agent ids the orchestrator considers relevant to this task.
   *  Always includes the primary agentId. Used by the renderer to deploy
   *  multiple mascots so the user sees the swarm engaged. */
  swarm: string[];
}

const MAX_REASONING_LEN = 200;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Score how relevant an agent is to a user prompt. Higher = better. */
function scoreAgent(agent: AgentSummary, text: string): number {
  const t = text.toLowerCase();
  let score = 0;

  // Specialty tag matches (strong signal).
  for (const tag of agent.specialtyTags) {
    if (tag && t.includes(tag.toLowerCase())) score += 6;
  }

  // Description keywords (weak signal — many short words).
  const desc = (agent.description || '').toLowerCase();
  if (desc.length > 0) {
    const words = desc
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 4)
      .slice(0, 16);
    for (const w of words) {
      if (t.includes(w)) score += 1;
    }
  }

  // Intent verbs / nouns mapped to common agent name patterns.
  const name = agent.name.toLowerCase();
  const buckets: Array<{ re: RegExp; nameRe: RegExp; weight: number }> = [
    { re: /research|news|latest|find out|look up|investigate|trend|recent/, nameRe: /research|search|scraper|finder/, weight: 8 },
    { re: /write|draft|doc|blog|article|copy|essay|summary|summarise|summarize/, nameRe: /writer|doc|copy/, weight: 8 },
    { re: /code|implement|refactor|bug|fix|function|class|method|algorithm/, nameRe: /code|bug|review|coder|programmer/, weight: 8 },
    { re: /test|spec|unit test|integration test|regression/, nameRe: /test/, weight: 8 },
    { re: /design|ui|ux|mockup|landing page|wireframe|figma/, nameRe: /design|component|theme|landing|vibe/, weight: 8 },
    { re: /3d|model a|blender|mesh|sculpt|render a|stl|obj |openscad|low.?poly|voxel/, nameRe: /design|proto|game|builder|3d|model|vibe/, weight: 9 },
    { re: /plan|roadmap|okr|sprint|backlog|milestone/, nameRe: /plan/, weight: 8 },
    { re: /security|auth|token|password|vulnerab/, nameRe: /security|auth/, weight: 8 },
    { re: /sql|database|schema|query|table|index/, nameRe: /sql|database|backend/, weight: 8 },
    { re: /api|endpoint|rest|graphql|webhook/, nameRe: /api|backend|integration|webhook/, weight: 8 },
    { re: /deploy|docker|kubernetes|k8s|ci|cd|pipeline|infrastructure/, nameRe: /devops|deploy|docker|kuber|pipeline|infra|cloud/, weight: 8 },
    { re: /chart|graph|data|analytics|visuali|dashboard|metric/, nameRe: /data|analy|chart/, weight: 8 },
    { re: /workflow|automate|automation|orchestrat/, nameRe: /workflow|chain|automation/, weight: 8 },
    { re: /image|photo|picture|svg|icon/, nameRe: /image|photo|design|icon/, weight: 6 },
    { re: /game|level|sprite|engine/, nameRe: /game|jam/, weight: 8 },
    { re: /accessibility|a11y|wcag|screen reader/, nameRe: /access|a11y/, weight: 9 },
    { re: /seo|meta tag|crawl|sitemap/, nameRe: /seo/, weight: 9 },
    { re: /i18n|localiz|translat|locale/, nameRe: /i18n|localiz|translat/, weight: 9 },
  ];
  for (const b of buckets) {
    if (b.re.test(t) && b.nameRe.test(name)) score += b.weight;
  }

  return score;
}

function fallback(agents: AgentSummary[], reason: string): RoutingDecision {
  return {
    agentId: agents[0]!.id,
    reasoning: truncate(`Auto-routing fell back: ${reason}. Defaulted to first agent.`, MAX_REASONING_LEN),
    fallback: true,
    swarm: [agents[0]!.id],
  };
}

export class Orchestrator {
  constructor(
    // Provider + model kept for backwards-compat; current routing is purely
    // deterministic + LLM-free, so they're unused at runtime.
    _provider: LLMProvider,
    _model: string,
  ) {
    void _provider;
    void _model;
  }

  /** Pick the single best-fit agent + a small swarm (up to 4) of helpers
   *  considered relevant to the same task. No LLM round-trip → routing is
   *  effectively instant. */
  async pickAgent(userText: string, agents: AgentSummary[]): Promise<RoutingDecision> {
    if (agents.length === 0) {
      throw new Error('Orchestrator.pickAgent: agents list is empty');
    }

    const trimmed = userText.trim();
    if (trimmed.length === 0) {
      return fallback(agents, 'empty user text');
    }

    const ranked = agents
      .map((a) => ({ a, s: scoreAgent(a, trimmed) }))
      .sort((x, y) => y.s - x.s);

    const top = ranked[0]!;
    if (top.s === 0) {
      // Nothing matched — quietly use the first agent.
      return {
        agentId: top.a.id,
        reasoning: 'No specific keyword match — using first agent.',
        fallback: true,
        swarm: ranked.slice(0, Math.min(4, agents.length)).map((r) => r.a.id),
      };
    }

    // Build a swarm: include any agent within 60% of the top score, capped
    // at 4 total. This is the "swarm of agents engaged" the renderer uses
    // to deploy multiple mascots.
    const threshold = Math.max(1, Math.floor(top.s * 0.6));
    const swarmIds = ranked
      .filter((r) => r.s >= threshold)
      .slice(0, 4)
      .map((r) => r.a.id);
    if (!swarmIds.includes(top.a.id)) swarmIds.unshift(top.a.id);

    const reasonParts: string[] = [];
    const tagHits = top.a.specialtyTags.filter((t) =>
      trimmed.toLowerCase().includes(t.toLowerCase()),
    );
    if (tagHits.length > 0) reasonParts.push(`matched tags: ${tagHits.join(', ')}`);
    if (swarmIds.length > 1) {
      reasonParts.push(
        `swarm: ${swarmIds
          .slice(1)
          .map((id) => agents.find((a) => a.id === id)?.name)
          .filter(Boolean)
          .join(', ')}`,
      );
    }
    const reasoning =
      reasonParts.length > 0
        ? `Picked ${top.a.name} — ${reasonParts.join(' · ')}.`
        : `Picked ${top.a.name} as best fit.`;

    return {
      agentId: top.a.id,
      reasoning: truncate(reasoning, MAX_REASONING_LEN),
      fallback: false,
      swarm: swarmIds,
    };
  }
}
