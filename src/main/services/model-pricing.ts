// Model price table shared by the chat usage meter and the business-agent
// gateway. USD per 1M tokens, prompt vs completion. Verified as of 2026-05
// against each provider's public pricing page. Local models map to 0 so they
// appear in meters but never inflate the bill.

export const PRICING: Record<string, { prompt: number; completion: number }> = {
  // Anthropic
  'claude-opus-4': { prompt: 15, completion: 75 },
  'claude-opus-4-5': { prompt: 15, completion: 75 },
  'claude-sonnet-4': { prompt: 3, completion: 15 },
  'claude-sonnet-4-5': { prompt: 3, completion: 15 },
  'claude-sonnet-4.5': { prompt: 3, completion: 15 },
  'claude-haiku-4': { prompt: 0.8, completion: 4 },
  // OpenAI
  'gpt-5': { prompt: 5, completion: 15 },
  'gpt-4.1': { prompt: 3, completion: 12 },
  'gpt-4o': { prompt: 2.5, completion: 10 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'o4': { prompt: 15, completion: 60 },
  'o3-mini': { prompt: 1.1, completion: 4.4 },
  'text-embedding-3-small': { prompt: 0.02, completion: 0 },
  'text-embedding-3-large': { prompt: 0.13, completion: 0 },
  // Google
  'gemini-2.5-pro': { prompt: 1.25, completion: 5 },
  'gemini-2.5-flash': { prompt: 0.15, completion: 0.6 },
  'gemini-2.0-flash': { prompt: 0.1, completion: 0.4 },
  // Perplexity
  'sonar-pro': { prompt: 3, completion: 15 },
  'sonar': { prompt: 1, completion: 1 },
  'sonar-reasoning-pro': { prompt: 2, completion: 8 },
  // Groq
  'llama-3.3-70b-versatile': { prompt: 0.59, completion: 0.79 },
  'llama-3.1-8b-instant': { prompt: 0.05, completion: 0.08 },
  'qwen-2.5-32b': { prompt: 0.29, completion: 0.39 },
  'deepseek-r1-distill-llama-70b': { prompt: 0.75, completion: 0.99 },
  // Mistral
  'mistral-large-latest': { prompt: 2, completion: 6 },
  'mistral-small-latest': { prompt: 0.2, completion: 0.6 },
  'codestral-latest': { prompt: 0.3, completion: 0.9 },
  // xAI
  'grok-4': { prompt: 5, completion: 15 },
  'grok-3': { prompt: 3, completion: 15 },
  'grok-3-mini': { prompt: 0.3, completion: 0.5 },
};

// Longest key first, so "gpt-4o-mini-2024…" matches gpt-4o-mini, not gpt-4o.
const PREFIXES = Object.keys(PRICING).sort((a, b) => b.length - a.length);

export function priceFor(model: string): { prompt: number; completion: number } {
  if (PRICING[model]) return PRICING[model]!;
  // Prefix match (e.g. claude-sonnet-4.5-20251002 → claude-sonnet-4.5).
  const lower = model.toLowerCase();
  for (const k of PREFIXES) {
    if (lower.startsWith(k.toLowerCase())) return PRICING[k]!;
  }
  return { prompt: 0, completion: 0 };
}

export function costFor(model: string, prompt: number, completion: number): number {
  const p = priceFor(model);
  return (prompt / 1_000_000) * p.prompt + (completion / 1_000_000) * p.completion;
}

/** True when the model is billed (a cloud model in the table). */
export function isPaidModel(model: string): boolean {
  const p = priceFor(model);
  return p.prompt > 0 || p.completion > 0;
}
