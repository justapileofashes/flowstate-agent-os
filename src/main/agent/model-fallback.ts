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
  // fallbacks — but if nothing in it is, run on whatever is installed rather
  // than 404'ing every turn. With nothing installed at all substituteModel
  // hands the primary back, so the caller still reports "model not found".
  return out.length > 0 ? out : [substituteModel(primary, available)];
}

/** Ordered preference when a wanted model is missing and its family is too. */
const SUBSTITUTE_PREFIXES = [
  'qwen2.5-coder:',
  'qwen2.5:',
  'qwen3-coder:',
  'qwen3:',
  'llama3.3:',
  'llama3.1:',
  'mistral-nemo:',
  'mistral-small:',
];

/**
 * Map a wanted model onto one that is actually installed. Agent rows persist a
 * model name forever — seeded agents ship asking for qwen2.5-coder:14b, and a
 * team run whose synthesizer wants a model nobody pulled dies at the last step
 * with a 404. Prefer another size of the same family, then the ladder, then
 * anything. An empty `installed` means we could not ask Ollama: leave the name
 * alone so the caller reports a clear "model not found" instead of a guess.
 */
export function substituteModel(want: string, installed: string[]): string {
  if (installed.length === 0 || installed.includes(want)) return want;
  const family = want.split(':')[0];
  const sameFamily = family ? installed.find((m) => m.startsWith(family + ':')) : undefined;
  return (
    sameFamily ??
    SUBSTITUTE_PREFIXES.map((p) => installed.find((m) => m.startsWith(p))).find(Boolean) ??
    installed[0]!
  );
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
