// Minimal YAML-frontmatter parser for Claude Code SKILL.md / command / agent
// files. We only need the flat `key: value` subset (name, description, model,
// tools, argument-hint, …) — no nested maps, anchors, or multi-doc. Anything
// fancier is ignored rather than throwing, so a slightly-exotic file still
// yields its name/description.

export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a `---` YAML frontmatter block from the markdown body. */
export function parseFrontmatter(input: string): Frontmatter {
  const text = input.replace(/^﻿/, ''); // strip BOM
  const m = FENCE.exec(text);
  if (!m) return { data: {}, body: text.trim() };

  const data: Record<string, string> = {};
  for (const rawLine of m[1]!.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    // Strip matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: text.slice(m[0].length).trim() };
}

/** Parse a `tools`/`allowed-tools` frontmatter value into a string list.
 *  Accepts `a, b, c` or `[a, b, c]`. */
export function parseListValue(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
}
