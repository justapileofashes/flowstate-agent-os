// OpenAI Chat Completions streaming. Direct fetch — no SDK.

import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from './llm-provider';
import type { ConversationMessage } from './types';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toOpenAIMessages(history: ConversationMessage[]): OpenAIMessage[] {
  return history.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        tool_call_id: m.toolCallId ?? '',
        content: m.content,
      };
    }
    if (m.role === 'assistant') {
      const out: OpenAIMessage = { role: 'assistant', content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        }));
      }
      return out;
    }
    return { role: m.role, content: m.content };
  });
}

/** Extra options for OpenAI-compatible providers (Hermes, Groq, …). */
export interface OpenAIProviderOpts {
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Extra request headers, computed per-call (e.g. a session id). */
  extraHeaders?: () => Record<string, string>;
  /** Whether an API key is mandatory. OpenAI requires it; a local
   *  OpenAI-compatible server (e.g. keyless local Hermes) does not. */
  requireKey?: boolean;
}

export class OpenAIProvider implements LLMProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders?: () => Record<string, string>;
  private readonly requireKey: boolean;

  constructor(
    private getKey: () => string,
    private readonly host = 'https://api.openai.com',
    /** Filter for listModels() — defaults to OpenAI's gpt/o family. Set
     *  to null to return everything (used by OpenAI-compatible providers
     *  like Groq, Mistral, Perplexity, xAI). */
    private readonly modelFilter: RegExp | null = /^(gpt-|o\d|chatgpt-)/i,
    opts: OpenAIProviderOpts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (opts.extraHeaders) this.extraHeaders = opts.extraHeaders;
    this.requireKey = opts.requireKey ?? true;
  }

  private get apiKey(): string {
    return this.getKey();
  }

  async isReachable(): Promise<boolean> {
    if (this.requireKey && !this.apiKey) return false;
    try {
      const res = await this.fetchImpl(`${this.host}/v1/models`, {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LLMProviderModel[]> {
    if (this.requireKey && !this.apiKey) return [];
    try {
      const res = await this.fetchImpl(`${this.host}/v1/models`, { headers: this.headers() });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      const all = (json.data ?? []).map((m) => ({ name: m.id }));
      return this.modelFilter ? all.filter((m) => this.modelFilter!.test(m.name)) : all;
    } catch {
      return [];
    }
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAIMessages(opts.messages),
    };
    if (opts.format === 'json') body['response_format'] = { type: 'json_object' };
    const res = await this.fetchImpl(`${this.host}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    return { text };
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    if (this.requireKey && !this.apiKey) {
      throw new Error('OpenAI API key not set. Add it in Settings.');
    }
    const tools =
      opts.tools.length > 0
        ? opts.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAIMessages(opts.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools) body['tools'] = tools;

    const fetchOpts: RequestInit = {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (opts.signal) fetchOpts.signal = opts.signal;
    const res = await this.fetchImpl(`${this.host}/v1/chat/completions`, fetchOpts);
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${errText}`);
    }

    // Tool calls stream in pieces — assemble by index.
    const toolAccum = new Map<number, { id: string; name: string; argStr: string }>();
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const usage = parsed['usage'] as Record<string, unknown> | undefined;
        if (usage) {
          if (typeof usage['prompt_tokens'] === 'number') promptTokens = usage['prompt_tokens'];
          if (typeof usage['completion_tokens'] === 'number')
            completionTokens = usage['completion_tokens'];
        }
        const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.['delta'] as Record<string, unknown> | undefined;
        if (!delta) continue;
        if (typeof delta['content'] === 'string' && delta['content'].length > 0) {
          yield { type: 'text', text: delta['content'] };
        }
        const tcs = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
        if (tcs) {
          for (const tc of tcs) {
            const index = (tc['index'] as number) ?? 0;
            let entry = toolAccum.get(index);
            if (!entry) {
              entry = { id: String(tc['id'] ?? `tc_${index}`), name: '', argStr: '' };
              toolAccum.set(index, entry);
            }
            if (typeof tc['id'] === 'string') entry.id = tc['id'];
            const fn = tc['function'] as Record<string, unknown> | undefined;
            if (fn) {
              if (typeof fn['name'] === 'string') entry.name = fn['name'];
              if (typeof fn['arguments'] === 'string') entry.argStr += fn['arguments'];
            }
          }
        }
        const finishReason = choices?.[0]?.['finish_reason'];
        if (finishReason === 'tool_calls') {
          for (const entry of toolAccum.values()) {
            let args: unknown = {};
            if (entry.argStr.trim().length > 0) {
              try {
                args = JSON.parse(entry.argStr);
              } catch {
                args = {};
              }
            }
            yield { type: 'tool-call', id: entry.id, name: entry.name, args };
          }
          toolAccum.clear();
        }
      }
    }

    yield {
      type: 'done',
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(completionTokens !== undefined ? { completionTokens } : {}),
    };
  }

  async *pullModel(): AsyncIterable<PullProgress> {
    yield { status: 'Cloud models do not need to be pulled.' };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    // Keyless local OpenAI-compatible servers (e.g. local Hermes) need no auth.
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return { ...h, ...(this.extraHeaders?.() ?? {}) };
  }
}
