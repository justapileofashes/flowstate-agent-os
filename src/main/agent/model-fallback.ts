// Model fallback chain. Local models OOM, cloud models rate-limit or go down.
// Instead of failing the turn, try the next model in a user-defined chain. Pure
// policy: build the ordered try-list and decide whether an error is worth
// failing over. The session runner consumes this; no I/O here.

/**
 * Ordered list of models to attempt: the primary first, then each fallback that
 * is actually available, de-duped. Models not in `available` are dropped so we
 * never try to run something that isn't installed/configured.
 */
export function resolveModelChain(
  primary: string,
  userChain: string[],
  available: string[],
): string[] {
  const have = new Set(available);
  const out: string[] = [];
  const push = (m: string): void => {
    if (m && have.has(m) && !out.includes(m)) out.push(m);
  };
  push(primary);
  for (const m of userChain) push(m);
  // If the primary itself isn't available, the chain may still have valid
  // fallbacks — but if nothing is available, surface the primary so the caller
  // produces a sensible "model not found" error rather than silently no-op'ing.
  return out.length > 0 ? out : [primary];
}

/** Next untried model in the chain, or null when exhausted. */
export function pickNextModel(chain: string[], tried: string[]): string | null {
  const triedSet = new Set(tried);
  return chain.find((m) => !triedSet.has(m)) ?? null;
}

const RETRYABLE = [
  /rate.?limit/i,
  /\b429\b/,
  /\b5\d\d\b/, // 5xx
  /overloaded/i,
  /timeout|timed out|etimedout/i,
  /econnrefused|connection refused|fetch failed|network/i,
  /out of memory|oom|cuda|insufficient memory/i,
  /model .*not found|no such model|unknown model/i,
];

/** Whether an error should trigger failover to the next model. */
export function isRetryableModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return RETRYABLE.some((re) => re.test(msg));
}
