// Google Gemini API (Generative Language). Direct fetch — no SDK.
// Streaming endpoint: v1beta/models/<model>:streamGenerateContent.

import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from './llm-provider';
import type { ConversationMessage, ToolSpec } from './types';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: unknown } }
    | { functionResponse: { name: string; response: unknown } }
  >;
}

function toGemini(history: ConversationMessage[]): {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
} {
  const sys: string[] = [];
  const out: GeminiContent[] = [];

  for (const m of history) {
    if (m.role === 'system') {
      sys.push(m.content);
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: m.toolName ?? 'tool',
              response: safeJson(m.content),
            },
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const parts: GeminiContent['parts'] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolCalls) {
        for (const c of m.toolCalls) {
          parts.push({ functionCall: { name: c.name, args: c.args ?? {} } });
        }
      }
      if (parts.length === 0) parts.push({ text: ' ' });
      out.push({ role: 'model', parts });
      continue;
    }
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    }
  }

  return {
    contents: out,
    ...(sys.length > 0
      ? { systemInstruction: { parts: [{ text: sys.join('\n\n') }] } }
      : {}),
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return { result: s };
  }
}

function toolsToGemini(tools: ToolSpec[]): Array<{ functionDeclarations: unknown[] }> | undefined {
  if (tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export class GeminiProvider implements LLMProvider {
  constructor(
    private getKey: () => string,
    private readonly host = 'https://generativelanguage.googleapis.com',
  ) {}

  private get apiKey(): string {
    return this.getKey();
  }

  async isReachable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const res = await fetch(`${this.host}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<LLMProviderModel[]> {
    if (!this.apiKey) return [];
    try {
      const res = await fetch(`${this.host}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      return (json.models ?? [])
        .map((m) => m.name?.replace(/^models\//, '') ?? '')
        .filter((name) => name.startsWith('gemini-'))
        .map((name) => ({ name }));
    } catch {
      return [];
    }
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    if (!this.apiKey) throw new Error('Gemini API key not set.');
    const body = toGemini(opts.messages);
    const res = await fetch(
      `${this.host}/v1beta/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          ...(opts.format === 'json'
            ? { generationConfig: { responseMimeType: 'application/json' } }
            : {}),
        }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    return { text };
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    if (!this.apiKey) throw new Error('Gemini API key not set. Add it in Settings.');
    const body = toGemini(opts.messages);
    const tools = toolsToGemini(opts.tools);
    const url =
      `${this.host}/v1beta/models/${encodeURIComponent(opts.model)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`;
    const fetchOpts: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...body,
        ...(tools ? { tools } : {}),
      }),
    };
    if (opts.signal) fetchOpts.signal = opts.signal;
    const res = await fetch(url, fetchOpts);
    if (!res.ok || !res.body) {
      throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => '')}`);
    }

    let prompt: number | undefined;
    let completion: number | undefined;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = chunk
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (!data) continue;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const candidates = parsed['candidates'] as Array<Record<string, unknown>> | undefined;
        const usage = parsed['usageMetadata'] as Record<string, unknown> | undefined;
        if (usage) {
          if (typeof usage['promptTokenCount'] === 'number') prompt = usage['promptTokenCount'];
          if (typeof usage['candidatesTokenCount'] === 'number') {
            completion = usage['candidatesTokenCount'];
          }
        }
        const cand = candidates?.[0];
        const parts = (cand?.['content'] as { parts?: Array<Record<string, unknown>> } | undefined)
          ?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (typeof part['text'] === 'string' && part['text'].length > 0) {
            yield { type: 'text', text: part['text'] };
          } else if (part['functionCall']) {
            const fc = part['functionCall'] as { name: string; args: unknown };
            yield {
              type: 'tool-call',
              id: `gem_${Math.random().toString(36).slice(2, 10)}`,
              name: fc.name,
              args: fc.args ?? {},
            };
          }
        }
      }
    }

    yield {
      type: 'done',
      ...(prompt !== undefined ? { promptTokens: prompt } : {}),
      ...(completion !== undefined ? { completionTokens: completion } : {}),
    };
  }

  async *pullModel(): AsyncIterable<PullProgress> {
    yield { status: 'Cloud models do not need to be pulled.' };
  }
}
