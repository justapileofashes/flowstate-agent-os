// Project conventions auto-context. When an agent works in a repo that has an
// AGENTS.md / CLAUDE.md / .cursorrules / README, those encode how the team wants
// code written. This pulls the most authoritative one(s) into a system-prompt
// preamble so the agent follows house style without the dev pasting it each time.
// Pure: selection + formatting. The handler does the directory read.

/** Highest-signal first. Agent-instruction files outrank a general README. */
export const CONVENTION_FILES = ['AGENTS.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules', 'README.md'] as const;

const MAX_TOTAL_CHARS = 8000;
const MAX_FILES = 2;

/** Of the files actually present, return up to MAX_FILES in priority order. */
export function pickConventionFiles(available: string[]): string[] {
  const set = new Set(available);
  const picked: string[] = [];
  for (const name of CONVENTION_FILES) {
    if (set.has(name)) picked.push(name);
    if (picked.length >= MAX_FILES) break;
  }
  return picked;
}

export interface ConventionFile {
  name: string;
  content: string;
}

/**
 * Build a preamble string from the selected files, sharing a total character
 * budget so a giant README can't crowd out everything. Returns '' when empty.
 */
export function buildConventionPreamble(files: ConventionFile[]): string {
  const nonEmpty = files.filter((f) => f.content.trim().length > 0);
  if (nonEmpty.length === 0) return '';

  const budget = Math.floor(MAX_TOTAL_CHARS / nonEmpty.length);
  const parts: string[] = [
    'The agent is working in a project with the following conventions. Follow them unless the user says otherwise.',
    '',
  ];
  for (const f of nonEmpty) {
    const body = f.content.trim();
    const clipped =
      body.length > budget ? body.slice(0, budget) + '\n… [truncated]' : body;
    parts.push(`--- ${f.name} ---`, clipped, '');
  }
  return parts.join('\n').trimEnd();
}
