import { describe, it, expect } from 'vitest';
import {
  isToolsUnsupportedError,
  parseTextToolCalls,
  stripToolBlocks,
  toTextProtocolMessages,
} from '@main/agent/text-tool-calls';
import { OllamaProvider } from '@main/agent/ollama-provider';

const allowed = new Set(['read_file', 'web_search']);

describe('parseTextToolCalls', () => {
  it('reads <tool_call> tags, fenced JSON and a bare JSON reply', () => {
    expect(parseTextToolCalls('<tool_call>{"name":"read_file","arguments":{"path":"a"}}</tool_call>', allowed)).toEqual([
      { name: 'read_file', args: { path: 'a' } },
    ]);
    expect(parseTextToolCalls('Sure.\n```json\n{"name":"web_search","arguments":"{\\"query\\":\\"x\\"}"}\n```', allowed)).toEqual([
      { name: 'web_search', args: { query: 'x' } },
    ]);
    expect(parseTextToolCalls('{"function":{"name":"read_file","arguments":{"path":"b"}}}', allowed)).toEqual([
      { name: 'read_file', args: { path: 'b' } },
    ]);
  });

  it('ignores unknown tools and ordinary prose / JSON answers', () => {
    expect(parseTextToolCalls('<tool_call>{"name":"rm_rf","arguments":{}}</tool_call>', allowed)).toEqual([]);
    expect(parseTextToolCalls('The config is {"a": 1}.', allowed)).toEqual([]);
    expect(parseTextToolCalls('```json\n{"result": 42}\n```', allowed)).toEqual([]);
  });

  it('strips tool blocks from the visible text', () => {
    expect(stripToolBlocks('Let me look.\n<tool_call>{"name":"read_file"}</tool_call>')).toBe('Let me look.');
  });
});

describe('text protocol transcript', () => {
  it('describes tools in the system prompt and replays tool history as turns', () => {
    const out = toTextProtocolMessages(
      [
        { role: 'system', content: 'You help.' },
        { role: 'user', content: 'read a' },
        { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'read_file', args: { path: 'a' } }] },
        { role: 'tool', content: 'hello', toolCallId: '1', toolName: 'read_file' },
      ],
      [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }],
    );
    expect(out[0]!.content).toContain('<tool_call>');
    expect(out[0]!.content).toContain('read_file');
    expect(out[2]).toEqual({ role: 'assistant', content: expect.stringContaining('"name":"read_file"') });
    expect(out[3]).toEqual({ role: 'user', content: 'Tool result (read_file):\nhello' });
  });

  it('recognises Ollama’s "does not support tools" error', () => {
    expect(isToolsUnsupportedError('Ollama chat HTTP 400: registry.ollama.ai/library/gemma:2b does not support tools')).toBe(true);
    expect(isToolsUnsupportedError('model not found')).toBe(false);
  });
});

function ndjson(lines: object[]): Response {
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });
}

describe('OllamaProvider tool fallback', () => {
  const tools = [{ name: 'read_file', description: 'Read', parameters: { type: 'object' } }];

  async function collect(p: OllamaProvider): Promise<Array<{ type: string; [k: string]: unknown }>> {
    const out: Array<{ type: string; [k: string]: unknown }> = [];
    for await (const d of p.chatStream({ model: 'm:2b', messages: [{ role: 'user', content: 'hi' }], tools })) out.push(d as never);
    return out;
  }

  it('turns a JSON-as-text reply into a tool call', async () => {
    const fetchFn = (async () =>
      ndjson([
        { message: { content: '{"name":"read_file","arguments":{"path":"a"}}' }, done: false },
        { message: { content: '' }, done: true },
      ])) as unknown as typeof fetch;
    const out = await collect(new OllamaProvider('http://x', fetchFn));
    expect(out.filter((d) => d.type === 'tool-call')).toEqual([
      expect.objectContaining({ name: 'read_file', args: { path: 'a' } }),
    ]);
  });

  it('retries without the tools param when the model rejects tools, then parses text calls', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      if (body['tools']) return new Response(JSON.stringify({ error: 'm:2b does not support tools' }), { status: 400 });
      return ndjson([
        { message: { content: 'Checking.\n<tool_call>{"name":"read_file","arguments":{"path":"b"}}</tool_call>' }, done: false },
        { message: { content: '' }, done: true },
      ]);
    }) as unknown as typeof fetch;
    const p = new OllamaProvider('http://x', fetchFn);
    const out = await collect(p);
    expect(out).toEqual([
      { type: 'text', text: 'Checking.' },
      expect.objectContaining({ type: 'tool-call', name: 'read_file', args: { path: 'b' } }),
      expect.objectContaining({ type: 'done' }),
    ]);
    // Remembered: the next turn goes straight to the text protocol.
    await collect(p);
    expect(bodies.filter((b) => b['tools']).length).toBe(1);
  });
});
