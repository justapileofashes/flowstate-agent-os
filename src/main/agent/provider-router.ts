// Picks the right provider based on the model's catalog entry, falling
// back to model-name prefix detection if the model is not in the catalog.

import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from './llm-provider';
import { CATALOG } from '@main/services/model-catalog';

export type ProviderKind =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'perplexity'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'ollama';

export function providerKindForModel(model: string): ProviderKind {
  const entry = CATALOG.find((m) => m.id === model);
  if (entry?.cloud) return entry.cloud;

  const lower = model.toLowerCase();
  if (lower.startsWith('claude-') || lower.startsWith('claude.')) return 'anthropic';
  if (lower.startsWith('gemini-')) return 'gemini';
  if (lower.startsWith('sonar') || lower.startsWith('pplx')) return 'perplexity';
  if (lower.startsWith('grok-')) return 'xai';
  if (lower.startsWith('codestral') || /^mistral-(large|small|medium|nemo|tiny|7b)/.test(lower)) {
    return 'mistral';
  }
  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('chatgpt-') ||
    /^o\d/.test(lower)
  ) {
    return 'openai';
  }
  return 'ollama';
}

export interface ProviderRouterOpts {
  ollama: LLMProvider;
  anthropic: LLMProvider;
  openai: LLMProvider;
  gemini: LLMProvider;
  perplexity: LLMProvider;
  groq: LLMProvider;
  mistral: LLMProvider;
  xai: LLMProvider;
}

export class ProviderRouter implements LLMProvider {
  constructor(private readonly providers: ProviderRouterOpts) {}

  private pick(model: string): LLMProvider {
    const kind = providerKindForModel(model);
    return this.providers[kind];
  }

  chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    return this.pick(opts.model).chatStream(opts);
  }

  chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    return this.pick(opts.model).chatOnce(opts);
  }

  async listModels(): Promise<LLMProviderModel[]> {
    const lists = await Promise.all(
      (Object.values(this.providers) as LLMProvider[]).map((p) =>
        p.listModels().catch(() => []),
      ),
    );
    return lists.flat();
  }

  isReachable(): Promise<boolean> {
    return this.providers.ollama.isReachable();
  }

  pullModel(name: string, signal?: AbortSignal): AsyncIterable<PullProgress> {
    return this.pick(name).pullModel(name, signal);
  }
}
