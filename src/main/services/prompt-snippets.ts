// Prompt snippets — a reusable, parameterized prompt library. Devs retype the
// same prompts constantly; a snippet is a named body with {{var}} placeholders
// that expand at send time. Pure: storage is a settings KV holding the JSON the
// serialize/parse helpers produce. The IPC handler owns persistence.

import { z } from 'zod';

export const snippetSchema = z.object({
  id: z.string().min(1),
  /** Trigger typed in the composer, e.g. "bugfix" → :bugfix. Lowercased, no spaces. */
  name: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'name must be lowercase letters, digits, or dashes'),
  label: z.string().min(1).max(80),
  body: z.string().min(1).max(8000),
});
export type Snippet = z.infer<typeof snippetSchema>;

const storeSchema = z.array(snippetSchema);

/** Parse the persisted JSON; returns [] on any malformed input (never throws). */
export function parseSnippets(json: string | null | undefined): Snippet[] {
  if (!json) return [];
  try {
    const parsed = storeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function serializeSnippets(snippets: Snippet[]): string {
  return JSON.stringify(storeSchema.parse(snippets));
}

/** Variable names referenced in a body, in first-seen order, de-duped. */
export function snippetVars(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)(?:\s*\|[^}]*)?\}\}/g)) {
    const name = m[1]!;
    if (BUILTINS.has(name)) continue; // builtins aren't user-supplied
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

const BUILTINS = new Set(['date', 'time', 'datetime']);

function builtinValue(name: string, now: Date): string | null {
  switch (name) {
    case 'date':
      return now.toISOString().slice(0, 10);
    case 'time':
      return now.toISOString().slice(11, 19);
    case 'datetime':
      return now.toISOString().slice(0, 19).replace('T', ' ');
    default:
      return null;
  }
}

/**
 * Expand `{{var}}` and `{{var|fallback}}` placeholders.
 * - user vars take priority, then builtins (date/time/datetime)
 * - `{{x|default text}}` uses the default when x is missing/empty
 * - a placeholder with no value and no default is left untouched, so the user
 *   can see what still needs filling rather than getting silent blanks
 */
export function expandSnippet(
  body: string,
  vars: Record<string, string> = {},
  now: Date = new Date(),
): string {
  return body.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g,
    (whole, name: string, fallback: string | undefined) => {
      const supplied = vars[name];
      if (supplied !== undefined && supplied !== '') return supplied;
      const builtin = builtinValue(name, now);
      if (builtin !== null) return builtin;
      if (fallback !== undefined) return fallback.trim();
      return whole; // leave the placeholder visible
    },
  );
}
