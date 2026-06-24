// Pinned chats. A dev keeps a handful of long-running sessions they return to;
// pinning floats them to the top of the recent list. Pure: the pin set is a
// settings KV JSON array of chat ids; these helpers toggle membership and
// reorder a chat list so pinned ones lead (original order preserved within each
// group — a stable partition).

export function parsePins(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function serializePins(ids: string[]): string {
  // de-dupe defensively
  return JSON.stringify([...new Set(ids)]);
}

export function isPinned(ids: string[], id: string): boolean {
  return ids.includes(id);
}

/** Add or remove a chat id; returns the new set. */
export function togglePin(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids];
}

/** Stable partition: pinned chats first (input order), then the rest. */
export function orderByPin<T extends { id: string }>(chats: T[], pinned: string[]): T[] {
  const pinSet = new Set(pinned);
  const head: T[] = [];
  const tail: T[] = [];
  for (const c of chats) (pinSet.has(c.id) ? head : tail).push(c);
  return [...head, ...tail];
}
