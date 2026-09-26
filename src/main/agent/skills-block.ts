// The "Available skills" section appended to every agent's system prompt.
// Skill descriptions can be long and a machine can have hundreds of skills
// (Claude Code plugins, ~/.claude/skills, …), which used to crowd the agent's
// own instructions out of a local model's context window. Keep it bounded:
// one line per skill, and names only once even that gets too big.

import { estimateTokens } from '@main/services/token-estimate';

const MAX_DESCRIPTION_CHARS = 100;
/** Above this, list names only; the `skill` tool still loads full instructions. */
export const SKILLS_BLOCK_TOKEN_BUDGET = 1500;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export function buildSkillsBlock(skills: Array<{ name: string; description: string }>): string {
  if (skills.length === 0) return '';
  const header =
    '\n\n## Available skills\nYou have skills you can load on demand. When a task matches one, call the `skill` tool with its name FIRST, then follow the instructions it returns.\n';
  const described = skills
    .map((s) => `- **${s.name}** — ${oneLine(s.description, MAX_DESCRIPTION_CHARS)}`)
    .join('\n');
  if (estimateTokens(described) <= SKILLS_BLOCK_TOKEN_BUDGET) return header + described;
  return `${header}Skill names: ${skills.map((s) => s.name).join(', ')}`;
}
