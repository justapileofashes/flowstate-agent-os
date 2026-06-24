// Custom user slash commands. The app ships built-in /plan /review etc; this
// lets a dev define their own (like .claude/commands) — a trigger + a framing
// template where {{input}} is whatever they typed after the command. Pure;
// persisted as a settings KV JSON blob owned by the IPC handler.

import { z } from 'zod';

export const userCommandSchema = z.object({
  /** Trigger including the leading slash, e.g. "/ship". Lowercased. */
  cmd: z
    .string()
    .regex(/^\/[a-z][a-z0-9-]*$/, 'command must look like /name (lowercase)'),
  label: z.string().min(1).max(60),
  hint: z.string().max(120).default(''),
  /** Framing template. {{input}} is replaced with text after the command. */
  template: z.string().min(1).max(8000),
});
export type UserCommand = z.infer<typeof userCommandSchema>;

const storeSchema = z.array(userCommandSchema);

export function parseUserCommands(json: string | null | undefined): UserCommand[] {
  if (!json) return [];
  try {
    const parsed = storeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializeUserCommands(cmds: UserCommand[]): string {
  return JSON.stringify(storeSchema.parse(cmds));
}

/**
 * If `input` starts with one of the user commands, return the framed prompt;
 * otherwise null (so the caller falls through to built-ins / a plain send).
 * Matching is on the first whitespace-delimited token, case-insensitive.
 */
export function applyUserCommand(input: string, cmds: UserCommand[]): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const firstSpace = trimmed.search(/\s/);
  const token = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
  const match = cmds.find((c) => c.cmd.toLowerCase() === token);
  if (!match) return null;
  return match.template.includes('{{input}}')
    ? match.template.replace(/\{\{\s*input\s*\}\}/g, rest)
    : `${match.template}\n\n${rest}`.trimEnd();
}

/** Reject a new command whose trigger collides with a built-in or existing one. */
export function isCommandTaken(cmd: string, reserved: string[], existing: UserCommand[]): boolean {
  const c = cmd.toLowerCase();
  return reserved.map((r) => r.toLowerCase()).includes(c) || existing.some((e) => e.cmd.toLowerCase() === c);
}
