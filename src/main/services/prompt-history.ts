// Composer prompt history. Up-arrow in the composer recalls previous prompts —
// a shell-style convenience devs reach for reflexively. Pure: history is a
// settings KV JSON array, most-recent-first, capped. Consecutive duplicates and
// blank entries are dropped so the recall list stays useful.

const DEFAULT_CAP = 50;

export function parseHistory(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function serializeHistory(list: string[]): string {
  return JSON.stringify(list);
}

/**
 * Prepend a new entry (most-recent-first). Blank entries are ignored. If the
 * entry already exists it moves to the front rather than duplicating. Capped.
 */
export function pushHistory(list: string[], entry: string, cap: number = DEFAULT_CAP): string[] {
  const trimmed = entry.trim();
  if (trimmed.length === 0) return list;
  const without = list.filter((e) => e !== trimmed);
  return [trimmed, ...without].slice(0, Math.max(1, cap));
}

/** Recall by index, 0 = most recent. Out-of-range → null. */
export function recallHistory(list: string[], index: number): string | null {
  if (index < 0 || index >= list.length) return null;
  return list[index] ?? null;
}
