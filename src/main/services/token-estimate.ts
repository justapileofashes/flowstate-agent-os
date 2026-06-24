// Prompt preflight — a cheap token estimate so the composer can warn "this is
// ~140k tokens, over your model's window" before a send wastes a round-trip.
// Heuristic only (no tokenizer dependency): blends a chars/4 estimate with a
// word-count estimate and takes the larger, which tracks real BPE counts well
// enough for a guardrail. Pure.

/** Rough token count for a string. Empty → 0. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(Math.ceil(chars / 4), Math.ceil(words * 1.3));
}

/**
 * Best-effort context window (in tokens) for a model id, by prefix. Returns 0
 * when unknown so preflight degrades to an 'unknown' verdict rather than a wrong
 * one. Conservative figures — meant for a guardrail, not billing.
 */
export function contextWindowFor(model: string): number {
  const m = model.toLowerCase();
  const table: Array<[string, number]> = [
    ['claude', 200_000],
    ['gpt-5', 256_000],
    ['gpt-4.1', 1_000_000],
    ['gpt-4o', 128_000],
    ['o3', 200_000],
    ['o4', 200_000],
    ['gemini', 1_000_000],
    ['sonar', 128_000],
    ['grok', 128_000],
    ['mistral-large', 128_000],
    ['mistral', 32_000],
    ['codestral', 256_000],
    ['llama-3.3', 128_000],
    ['llama3.3', 128_000],
    ['llama-3.1', 128_000],
    ['llama3.1', 128_000],
    ['llama3', 8_192],
    ['qwen', 32_000],
    ['deepseek', 64_000],
    ['phi', 16_000],
    ['gemma', 8_192],
  ];
  for (const [prefix, win] of table) {
    if (m.startsWith(prefix) || m.includes(prefix)) return win;
  }
  return 0;
}

export interface PreflightInput {
  /** The user's prompt text. */
  text: string;
  /** Extra context already attached (system prompt, @files, history) in chars. */
  contextChars?: number;
  /** Model context window in tokens. 0/undefined = unknown (no verdict). */
  capTokens?: number;
  /** Reserve for the model's reply. Default 1024. */
  replyReserveTokens?: number;
  warnRatio?: number;
}

export interface PreflightVerdict {
  estTokens: number;
  level: 'ok' | 'warn' | 'over' | 'unknown';
  message?: string;
}

export function preflightPrompt(input: PreflightInput): PreflightVerdict {
  const est = estimateTokens(input.text) + Math.ceil((input.contextChars ?? 0) / 4);
  const cap = input.capTokens ?? 0;
  if (!cap || cap <= 0) return { estTokens: est, level: 'unknown' };

  const reserve = input.replyReserveTokens ?? 1024;
  const usable = Math.max(1, cap - reserve);
  const warnRatio = Number.isFinite(input.warnRatio) ? input.warnRatio! : 0.8;

  if (est >= usable) {
    return {
      estTokens: est,
      level: 'over',
      message: `~${est.toLocaleString()} tokens exceeds the ~${usable.toLocaleString()} usable in this model's ${cap.toLocaleString()}-token window. Trim context or pick a larger model.`,
    };
  }
  if (est >= usable * warnRatio) {
    return {
      estTokens: est,
      level: 'warn',
      message: `~${est.toLocaleString()} tokens — getting close to this model's window.`,
    };
  }
  return { estTokens: est, level: 'ok' };
}
