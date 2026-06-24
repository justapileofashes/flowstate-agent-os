import { randomUUID } from 'node:crypto';
import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from './llm-provider';

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface OllamaToolCallChunk {
  function?: { name?: string; arguments?: unknown };
}

interface OllamaChatChunk {
  message?: {
    role?: string;
    content?: string;
    tool_calls?: OllamaToolCallChunk[];
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; size?: number }>;
}

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly host: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    const body = {
      model: opts.model,
      messages: opts.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCalls
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                function: { name: c.name, arguments: c.args },
              })),
            }
          : {}),
        ...(m.toolName ? { tool_name: m.toolName } : {}),
      })),
      stream: true,
      tools: opts.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
    };

    const res = await this.fetchFn(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      throw new Error(`Ollama chat HTTP ${res.status}`);
    }
    if (!res.body) {
      throw new Error('Ollama chat response had no body');
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;

          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(line) as OllamaChatChunk;
          } catch {
            continue;
          }

          const text = chunk.message?.content ?? '';
          if (text.length > 0) {
            yield { type: 'text', text };
          }
          const tools = chunk.message?.tool_calls;
          if (tools && tools.length > 0) {
            for (const tc of tools) {
              const name = tc.function?.name;
              if (!name) continue;
              const args = tc.function?.arguments;
              yield { type: 'tool-call', name, args, id: randomUUID() };
            }
          }
          if (chunk.done) {
            yield {
              type: 'done',
              ...(chunk.prompt_eval_count !== undefined
                ? { promptTokens: chunk.prompt_eval_count }
                : {}),
              ...(chunk.eval_count !== undefined
                ? { completionTokens: chunk.eval_count }
                : {}),
            };
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    };
    if (opts.format === 'json') body.format = 'json';

    const res = await this.fetchFn(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error(`Ollama chat HTTP ${res.status}`);
    const parsed = (await res.json()) as { message?: { content?: string } };
    return { text: parsed.message?.content ?? '' };
  }

  async listModels(): Promise<LLMProviderModel[]> {
    const res = await this.fetchFn(`${this.host}/api/tags`, { method: 'GET' });
    if (!res.ok) throw new Error(`Ollama tags HTTP ${res.status}`);
    const body = (await res.json()) as OllamaTagsResponse;
    return (body.models ?? []).map((m) => ({ name: m.name, size: m.size }));
  }

  async isReachable(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.host}/api/version`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async *pullModel(name: string, signal?: AbortSignal): AsyncIterable<PullProgress> {
    const res = await this.fetchFn(`${this.host}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true }),
      signal,
    });
    if (!res.ok) throw new Error(`Ollama pull HTTP ${res.status}`);
    if (!res.body) throw new Error('Ollama pull response had no body');

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const chunk = JSON.parse(line) as PullProgress;
            yield chunk;
          } catch {
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
