// Pure policy for automatic safety checkpoints. The dispatcher snapshots the
// workspace before destructive tool calls so the user can always roll back.
// Kept pure (no fs/db) so it is trivially unit-testable.

/** Default minimum gap between auto-checkpoints for one agent run. */
export const DEFAULT_CHECKPOINT_GAP_MS = 15_000;

const DESTRUCTIVE = new Set(['delete_file', 'run_shell']);

/**
 * Should we snapshot before this tool call?
 * - delete_file / run_shell: always (they can destroy or mutate the workspace).
 * - write_file: only when overwriting an existing file (a fresh write is reversible
 *   by simply deleting the new file, and snapshotting every write is wasteful).
 */
export function shouldCheckpoint(
  toolName: string,
  opts: { isOverwrite: boolean },
): boolean {
  if (DESTRUCTIVE.has(toolName)) return true;
  if (toolName === 'write_file') return opts.isOverwrite;
  return false;
}

/** Throttle: only checkpoint when enough time has passed since the last one. */
export function dueForCheckpoint(
  lastTs: number,
  now: number,
  minGapMs: number = DEFAULT_CHECKPOINT_GAP_MS,
): boolean {
  if (lastTs <= 0) return true;
  return now - lastTs >= minGapMs;
}

export function checkpointLabel(toolName: string): string {
  return `auto: before ${toolName}`;
}
