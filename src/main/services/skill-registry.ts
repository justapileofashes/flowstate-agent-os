// Bridges the plugin manager's enabled skills to the agent runtime: provides
// the description list injected into the system prompt, and loads a skill's
// full SKILL.md body on demand (the `skill` tool). A per-agent allowlist lets a
// user restrict which skills a given agent may use.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter';
import { readSkillDir } from './plugin-scan';
import { findSkillDirs } from './plugin-sources';
import type { SkillEntry } from './plugin-types';

export interface SkillDescription {
  name: string;
  description: string;
}

export interface SkillRegistryDeps {
  /** All currently-enabled skills (plugin + standalone). */
  skills: () => SkillEntry[];
  /** Per-agent allowlist of skill names; null/undefined = all skills. */
  allowlist: (agentId: string) => string[] | null;
}

export class SkillRegistry {
  /** Skills in each agent's workspace `.claude/skills`, per agent id. */
  private readonly workspace = new Map<string, SkillEntry[]>();

  constructor(private readonly deps: SkillRegistryDeps) {}

  /** Re-read an agent's workspace skills (`<workspace>/.claude/skills`, the
   *  Claude Code project convention). Call before building its prompt. */
  async refreshWorkspace(agentId: string, workspacePath: string): Promise<void> {
    const out: SkillEntry[] = [];
    for (const dir of await findSkillDirs(join(workspacePath, '.claude', 'skills'), 2)) {
      const s = await readSkillDir(dir, null, 'Workspace');
      if (s && !out.some((x) => x.name === s.name)) out.push(s);
    }
    this.workspace.set(agentId, out);
  }

  /** Skills an agent may use, as {name, description} for the system prompt. */
  descriptions(agentId: string): SkillDescription[] {
    return this.forAgent(agentId).map((s) => ({ name: s.name, description: s.description }));
  }

  /** Workspace skills (always on, they belong to this agent's project) first,
   *  then global skills filtered by the agent's allowlist. */
  private forAgent(agentId: string): SkillEntry[] {
    const ws = this.workspace.get(agentId) ?? [];
    const all = this.deps.skills();
    const allow = this.deps.allowlist(agentId);
    const set = allow ? new Set(allow) : null;
    const global = all.filter((s) => (!set || set.has(s.name)) && !ws.some((w) => w.name === s.name));
    return [...ws, ...global];
  }

  /** Load a skill's full instructions (frontmatter stripped). Throws with the
   *  list of valid names when the name is unknown for this agent. */
  async load(agentId: string, name: string): Promise<string> {
    const skill = this.forAgent(agentId).find((s) => s.name === name);
    if (!skill) {
      const valid = this.forAgent(agentId)
        .map((s) => s.name)
        .join(', ');
      throw new Error(`Unknown skill "${name}". Available: ${valid || '(none)'}`);
    }
    const raw = await fs.readFile(skill.path, 'utf8');
    const { body } = parseFrontmatter(raw);
    // Tell the agent where bundled files live so a shell-capable agent can read
    // scripts/templates the skill ships with (outside the workspace sandbox).
    return `${body}\n\n---\nSkill files directory: ${skill.dir}`;
  }
}
