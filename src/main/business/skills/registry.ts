// Skill registry: the only way an agent reaches a tool. A role sees the
// intersection of (its allowlist) ∩ (channel enabled) ∩ (credential
// connected) ∩ (skill-specific availability), plus MCP tools the owner has
// explicitly granted to that role.

import type { ToolSpec } from '@main/agent/types';
import type { McpManager } from '@main/services/mcp-manager';
import { z } from 'zod';
import type { RoleKey } from '@shared/business/types';
import { roleDef } from '../agent/roles';
import type { Skill, SkillContext } from './types';

export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();
  private readonly byTool = new Map<string, Skill>();

  constructor(private readonly mcp?: Pick<McpManager, 'toolSpecs' | 'callTool'>) {}

  register(skill: Skill): void {
    if (this.skills.has(skill.key)) throw new Error(`duplicate skill ${skill.key}`);
    this.skills.set(skill.key, skill);
    this.byTool.set(skill.toolName, skill);
  }

  get(key: string): Skill | undefined {
    return this.skills.get(key) ?? this.mcpSkill(key.replace(/^mcp:/, ''));
  }

  byToolName(name: string): Skill | undefined {
    return this.byTool.get(name) ?? (name.startsWith('mcp__') ? this.mcpSkill(name) : undefined);
  }

  all(): Skill[] {
    return [...this.skills.values()];
  }

  isAvailable(skill: Skill, ctx: SkillContext): boolean {
    if (skill.channel && !ctx.company.config.channels[skill.channel]) return false;
    if (skill.providers?.length && !skill.providers.some((p) => ctx.credentials.has(p))) return false;
    if (skill.available && !skill.available(ctx)) return false;
    return true;
  }

  /** Skills a role may call right now, in allowlist order. */
  forRole(role: RoleKey, ctx: SkillContext, extraKeys: string[] = []): Skill[] {
    const allowed = [...roleDef(role).skills, ...extraKeys];
    const out: Skill[] = [];
    for (const key of allowed) {
      const s = this.skills.get(key);
      if (s && this.isAvailable(s, ctx) && !out.includes(s)) out.push(s);
    }
    for (const grant of ctx.company.config.mcpGrants) {
      if (!grant.roles.includes(role)) continue;
      const s = this.mcpSkill(grant.tool, grant.category);
      if (s) out.push(s);
    }
    return out;
  }

  /** Whether `skill` is part of what `role` may call (enforced on every call). */
  allowedFor(role: RoleKey, skill: Skill, ctx: SkillContext): boolean {
    return this.forRole(role, ctx).some((s) => s.key === skill.key);
  }

  static toolSpecs(skills: Skill[]): ToolSpec[] {
    return skills.map((s) => ({ name: s.toolName, description: s.description, parameters: s.parameters }));
  }

  // ── MCP → skill adapter ─────────────────────────────────────────────────

  private mcpSkill(tool: string, category: 'read' | 'external_write' = 'external_write'): Skill | undefined {
    if (!this.mcp) return undefined;
    const spec = this.mcp.toolSpecs().find((t) => t.name === tool);
    if (!spec) return undefined;
    const mcp = this.mcp;
    return {
      key: `mcp:${tool}`,
      toolName: tool,
      name: tool.replace(/^mcp__/, '').replace(/__/g, ' · '),
      description: `${spec.description} (MCP tool granted by the owner)`,
      parameters: spec.parameters,
      schema: z.unknown(),
      category,
      risk: category === 'read' ? 'low' : 'medium',
      costCredits: 1,
      rubric: ['Result is relevant to the task', 'No data outside the granted scope was touched'],
      failureConditions: ['MCP server not connected', 'Tool returned an error'],
      preview: (args: unknown) => ({
        title: `MCP ${tool}`,
        summary: JSON.stringify(args ?? {}).slice(0, 400),
      }),
      async execute(_ctx, args) {
        const res = await mcp.callTool(tool, args);
        return {
          ok: !res.isError,
          content: res.content,
          stateChange: category !== 'read',
          empty: !res.content.trim(),
        };
      },
    };
  }
}
