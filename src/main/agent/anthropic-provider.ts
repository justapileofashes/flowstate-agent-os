// Anthropic Messages API streaming client. Direct fetch — no SDK — keeps
// the bundle lean. Supports tool use via the v1/messages tool spec and
// emits ProviderDelta events compatible with AgentRuntime.

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

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string }
  >;
}

function toAnthropicMessages(history: ConversationMessage[]): {
  system: string;
  messages: AnthropicMessage[];
} {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const m of history) {
    if (m.role === 'system') {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      // Each tool result becomes a user turn with a tool_result block.
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolCallId ?? '',
            content: m.content,
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const parts: AnthropicMessage['content'] = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          parts.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
        }
      }
      // Anthropic rejects empty content arrays
      if (parts.length === 0) parts.push({ type: 'text', text: ' ' });
      out.push({ role: 'assistant', content: parts });
      continue;
    }
    if (m.role === 'user') {
      out.push({ role: 'user', content: [{ type: 'text', text: m.content }] });
    }
  }

  return { system: systemParts.join('\n\n'), messages: out };
}

export class AnthropicProvider implements LLMProvider {
  constructor(
    private getKey: () => string,
    private readonly host = 'https://api.anthropic.com',
  ) {}

  private get apiKey(): string {
    return this.getKey();
  }

  async isReachable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.host}/v1/models`, {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LLMProviderModel[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${this.host}/v1/models?limit=100`, {
        headers: this.headers(),
      });
      if (!res.ok) return [];
      const json = (await res.json()) as { data?: Array<{ id: string }> };
      return (json.data ?? []).map((m) => ({ name: m.id }));
    } catch {
      return [];
    }
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    const { system, messages } = toAnthropicMessages(opts.messages);
    // JSON-mode hack: append instruction to system
    const sys = opts.format === 'json' ? `${system}\n\nReturn valid JSON only.` : system;
    const res = await fetch(`${this.host}/v1/messages`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 4096,
        system: sys || undefined,
        messages,
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok) {
      throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text =
      json.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? '';
    return { text };
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not set. Add it in Settings.');
    }
    const { system, messages } = toAnthropicMessages(opts.messages);
    const tools = opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
    const body = {
      model: opts.model,
      max_tokens: 8192,
      system: system || undefined,
      messages,
      stream: true,
      ...(tools.length > 0 ? { tools } : {}),
    };
    const fetchOpts: RequestInit = {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (opts.signal) fetchOpts.signal = opts.signal;
    const res = await fetch(`${this.host}/v1/messages`, fetchOpts);
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${errText}`);
    }

    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    // Tool blocks accumulate input JSON across multiple deltas
    const toolBlocks = new Map<
      number,
      { id: string; name: string; jsonAccum: string }
    >();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE messages separated by blank lines
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Extract data: lines
        const lines = chunk.split('\n');
        let dataLine = '';
        for (const l of lines) {
          if (l.startsWith('data:')) dataLine = l.slice(5).trim();
        }
        if (!dataLine || dataLine === '[DONE]') continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(dataLine) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = parsed['type'] as string | undefined;
        if (type === 'message_start') {
          const usage = (parsed['message'] as Record<string, unknown> | undefined)?.['usage'];
          if (usage && typeof usage === 'object') {
            const u = usage as Record<string, unknown>;
            if (typeof u['input_tokens'] === 'number') promptTokens = u['input_tokens'];
          }
        } else if (type === 'content_block_start') {
          const block = parsed['content_block'] as Record<string, unknown> | undefined;
          if (block?.['type'] === 'tool_use') {
            const index = parsed['index'] as number;
            toolBlocks.set(index, {
              id: String(block['id'] ?? ''),
              name: String(block['name'] ?? ''),
              jsonAccum: '',
            });
          }
        } else if (type === 'content_block_delta') {
          const index = parsed['index'] as number;
          const delta = parsed['delta'] as Record<string, unknown>;
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            yield { type: 'text', text: delta['text'] };
          } else if (delta?.['type'] === 'input_json_delta' && typeof delta['partial_json'] === 'string') {
            const block = toolBlocks.get(index);
            if (block) block.jsonAccum += delta['partial_json'];
          }
        } else if (type === 'content_block_stop') {
          const index = parsed['index'] as number;
          const block = toolBlocks.get(index);
          if (block) {
            let args: unknown = {};
            if (block.jsonAccum.trim().length > 0) {
              try {
                args = JSON.parse(block.jsonAccum);
              } catch {
                args = {};
              }
            }
            yield { type: 'tool-call', id: block.id, name: block.name, args };
            toolBlocks.delete(index);
          }
        } else if (type === 'message_delta') {
          const usage = parsed['usage'] as Record<string, unknown> | undefined;
          if (usage && typeof usage['output_tokens'] === 'number') {
            completionTokens = usage['output_tokens'] as number;
          }
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
    // No-op: cloud models don't pull.
    yield { status: 'Cloud models do not need to be pulled.' };
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
}
