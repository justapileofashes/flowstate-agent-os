import { randomUUID } from 'node:crypto';
import { contextWindowFor, estimateTokens } from '@main/services/token-estimate';
import { extractInlineImages } from './inline-images';
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
  /** Ollama reports failures mid-stream as an `{ "error": … }` line. */
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string; size?: number }>;
}

/** Error for a non-OK Ollama response, including its `{ error }` body. */
async function httpError(res: Response, what: string): Promise<Error> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // body unreadable — status alone
  }
  detail = detail.trim().slice(0, 300);
  return new Error(`Ollama ${what} HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
}

const MIN_CTX = 8192;
export const DEFAULT_MAX_CTX = 32768;
const REPLY_RESERVE_TOKENS = 2048;

/**
 * Context window to request from Ollama. Without `options.num_ctx` Ollama
 * uses its 4096-token default and silently drops the start of the prompt —
 * with ~20 tool schemas that is the agent's system prompt. Size the window
 * to the prompt (power of two, at least 8k) but never past the model's own
 * window or `maxCtx`, since every doubling costs VRAM.
 */
export function pickNumCtx(model: string, promptTokens: number, maxCtx = DEFAULT_MAX_CTX): number {
  const need = promptTokens + REPLY_RESERVE_TOKENS;
  let ctx = MIN_CTX;
  while (ctx < need) ctx *= 2;
  const cap = Math.max(MIN_CTX, Math.min(contextWindowFor(model) || maxCtx, maxCtx));
  return Math.min(ctx, cap);
}

export class OllamaProvider implements LLMProvider {
  constructor(
    private readonly host: string,
    private readonly fetchFn: FetchFn = fetch,
    /** Upper bound for num_ctx (Settings → `ollama_max_ctx`). */
    private readonly maxCtx: () => number = () => DEFAULT_MAX_CTX,
  ) {}

  private numCtx(model: string, payload: unknown): number {
    return pickNumCtx(model, estimateTokens(JSON.stringify(payload)), this.maxCtx());
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    // Pasted images arrive as markdown data URLs in the text; vision models
    // need them as base64 `images` instead.
    const split = opts.messages.map((m) => extractInlineImages(m.content));
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages.map((m, i) => ({
        role: m.role,
        content: split[i]!.text,
        ...(split[i]!.images.length > 0 ? { images: split[i]!.images } : {}),
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
    body.options = { num_ctx: this.numCtx(opts.model, [split.map((s) => s.text), body.tools]) };

    const res = await this.fetchFn(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      throw await httpError(res, 'chat');
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
          if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);

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
    body.options = { num_ctx: this.numCtx(opts.model, body.messages) };
    if (opts.format === 'json') body.format = 'json';

    const res = await this.fetchFn(`${this.host}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) throw await httpError(res, 'chat');
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
    if (!res.ok) throw await httpError(res, 'pull');
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
          let chunk: PullProgress & { error?: string };
          try {
            chunk = JSON.parse(line) as PullProgress & { error?: string };
          } catch {
            continue;
          }
          // e.g. {"error":"pull model manifest: file does not exist"} — used
          // to be passed through as "progress" and reported as a success.
          if (chunk.error) throw new Error(chunk.error);
          yield chunk;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
