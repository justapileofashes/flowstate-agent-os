// Any OpenAI-compatible server — LM Studio, llama.cpp `server`, vLLM, Jan,
// LocalAI, a Hermes gateway, OpenRouter… Configured in Settings with a base
// URL and an optional key. Its models appear as `custom/<id>` so routing
// never collides with Ollama or the named cloud providers.

import { OpenAIProvider } from './openai-provider';
import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from './llm-provider';

export const CUSTOM_PREFIX = 'custom/';
export const CUSTOM_BASE_URL_KEY = 'custom_openai_base_url';
export const CUSTOM_API_KEY_KEY = 'custom_openai_api_key';

/** "http://localhost:1234/v1/" → "http://localhost:1234" (OpenAIProvider adds /v1). */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export class CustomOpenAIProvider implements LLMProvider {
  private cached: { url: string; provider: OpenAIProvider } | null = null;

  constructor(
    private readonly getBaseUrl: () => string,
    private readonly getKey: () => string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private inner(): OpenAIProvider | null {
    const url = normalizeBaseUrl(this.getBaseUrl());
    if (!url) return null;
    if (this.cached?.url !== url) {
      this.cached = { url, provider: new OpenAIProvider(this.getKey, url, null, { requireKey: false, fetchImpl: this.fetchImpl }) };
    }
    return this.cached.provider;
  }

  private need(): OpenAIProvider {
    const p = this.inner();
    if (!p) throw new Error('No OpenAI-compatible server set. Add its URL in Settings → Model providers.');
    return p;
  }

  private static strip<T extends { model: string }>(opts: T): T {
    return opts.model.startsWith(CUSTOM_PREFIX) ? { ...opts, model: opts.model.slice(CUSTOM_PREFIX.length) } : opts;
  }

  async isReachable(): Promise<boolean> {
    return (await this.inner()?.isReachable()) ?? false;
  }

  async listModels(): Promise<LLMProviderModel[]> {
    const models = (await this.inner()?.listModels()) ?? [];
    return models.map((m) => ({ ...m, name: CUSTOM_PREFIX + m.name }));
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    return this.need().chatOnce(CustomOpenAIProvider.strip(opts));
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    yield* this.need().chatStream(CustomOpenAIProvider.strip(opts));
  }

  async *pullModel(): AsyncIterable<PullProgress> {
    yield { status: 'Models on an OpenAI-compatible server are managed on that server.' };
  }
}
