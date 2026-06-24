// Agent constitutions — per-agent rules the approval gate enforces before its
// built-in policy. Rules live in `.flowstate/constitution.json` in the agent's
// workspace (same spirit as CLAUDE.md project rules). The evaluator is a pure
// function so it is trivially testable without the database.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export type ConstitutionEffect = 'allow' | 'deny' | 'ask';

export interface ConstitutionRule {
  effect: ConstitutionEffect;
  /** Tool name to match, or '*' / undefined for any tool. */
  tool?: string;
  /** Regex (string form) tested against the tool name + raw arg values. */
  pattern?: string;
  description?: string;
}

const ruleSchema = z.object({
  effect: z.enum(['allow', 'deny', 'ask']),
  tool: z.string().min(1).optional(),
  pattern: z.string().min(1).optional(),
  description: z.string().max(200).optional(),
});

const constitutionSchema = z.array(ruleSchema).max(200);

export const CONSTITUTION_REL_PATH = join('.flowstate', 'constitution.json');

/**
 * Evaluate a constitution against a tool call. First matching rule wins.
 * Returns its effect, or null when no rule matches (caller falls through to the
 * normal approval policy). Never throws — a rule with a bad regex is skipped.
 */
export function evaluateConstitution(
  rules: ConstitutionRule[],
  call: { toolName: string; args: unknown },
): ConstitutionEffect | null {
  const haystack = buildMatchString(call.toolName, call.args);
  for (const rule of rules) {
    if (!toolMatches(rule.tool, call.toolName)) continue;
    if (!patternMatches(rule.pattern, haystack)) continue;
    return rule.effect;
  }
  return null;
}

/** Read + validate the workspace constitution. Returns [] on any problem. */
export async function loadConstitution(workspacePath: string): Promise<ConstitutionRule[]> {
  try {
    const raw = await fs.readFile(join(workspacePath, CONSTITUTION_REL_PATH), 'utf8');
    const parsed = constitutionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function toolMatches(ruleTool: string | undefined, toolName: string): boolean {
  if (!ruleTool || ruleTool === '*') return true;
  return ruleTool === toolName;
}

function patternMatches(pattern: string | undefined, haystack: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, 'i').test(haystack);
  } catch {
    // Malformed regex — skip this rule rather than crashing the run.
    return false;
  }
}

/** Flatten tool name + raw string/number arg values into one searchable string. */
function buildMatchString(toolName: string, args: unknown): string {
  const parts: string[] = [toolName];
  collect(args, parts, 0);
  return parts.join(' ');
}

function collect(value: unknown, out: string[], depth: number): void {
  if (depth > 4 || out.length > 100) return;
  if (typeof value === 'string' || typeof value === 'number') {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    for (const v of value) collect(v, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collect(v, out, depth + 1);
    }
  }
}
