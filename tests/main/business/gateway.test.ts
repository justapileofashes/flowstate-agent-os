import { describe, it, expect } from 'vitest';
import { ModelGateway, parseToolBlocks, toTextProtocol, extractJsonObject, isTransient } from '@main/business/providers/gateway';
import type { UsageEventInput } from '@main/business/db/billing';
import { costFor } from '@main/services/model-pricing';
import type { ModelAlias } from '@shared/business/types';
import { ScriptedLLM } from './fake-llm';

function gw(llm: ScriptedLLM, opts: { models?: Partial<Record<ModelAlias, string>>; fallbacks?: string[]; now?: () => number } = {}) {
  const usage: UsageEventInput[] = [];
  const sleeps: number[] = [];
  const models = { ...opts.models };
  const g = new ModelGateway({
    provider: llm,
    resolveModel: (_c, alias) => models[alias] ?? '',
    fallbackModels: () => opts.fallbacks ?? [],
    onUsage: (e) => usage.push(e),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { g, usage, sleeps, models };
}

const msg = [{ role: 'user' as const, content: 'hi' }];

describe('ModelGateway', () => {
  it('routes by alias; swapping the alias changes the model without code changes', async () => {
    const llm = new ScriptedLLM(() => ({ text: 'ok' }));
    const { g, models } = gw(llm, { models: { planner: 'qwen2.5:7b' } });
    await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    models.planner = 'claude-sonnet-4-5';
    await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    expect(llm.calls.map((c) => c.model)).toEqual(['qwen2.5:7b', 'claude-sonnet-4-5']);
  });

  it('returns usage with exact provider-token cost on every response', async () => {
    const llm = new ScriptedLLM(() => ({ text: 'ok', promptTokens: 12_000, completionTokens: 3_000 }));
    const { g, usage } = gw(llm, { models: { writer: 'claude-sonnet-4-5' } });
    const res = await g.chat({ alias: 'writer', companyId: 'c', messages: msg });
    const expected = costFor('claude-sonnet-4-5', 12_000, 3_000);
    expect(expected).toBeCloseTo(0.081, 6);
    expect(Math.abs(res.usage.costUsd - expected) / expected).toBeLessThan(0.05);
    expect(res.usage.credits).toBeCloseTo(8.1, 4);
    expect(res.usage.estimated).toBe(false);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ ok: true, model: 'claude-sonnet-4-5', provider: 'anthropic', inputTokens: 12_000 });
  });

  it('local models cost $0 but still consume credits (tokens)', async () => {
    const llm = new ScriptedLLM(() => ({ text: 'ok', promptTokens: 6_000, completionTokens: 2_000 }));
    const { g } = gw(llm, { models: { cheap: 'llama3.1:8b' } });
    const res = await g.chat({ alias: 'cheap', companyId: 'c', messages: msg });
    expect(res.usage.costUsd).toBe(0);
    expect(res.usage.credits).toBe(2);
  });

  it('retries transient errors with exponential backoff', async () => {
    let n = 0;
    const llm = new ScriptedLLM(() => (n++ < 2 ? new Error('HTTP 429 rate limit') : { text: 'finally' }));
    const { g, sleeps, usage } = gw(llm, { models: { planner: 'gpt-4o' } });
    const res = await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    expect(res.text).toBe('finally');
    expect(res.attempts).toBe(3);
    expect(sleeps).toEqual([400, 1600]);
    expect(usage.filter((u) => !u.ok)).toHaveLength(2);
  });

  it('fails over transparently when a provider is down, and opens its circuit', async () => {
    const llm = new ScriptedLLM((r) => (r.model.startsWith('claude') ? new Error('503 overloaded') : { text: `from ${r.model}` }));
    let t = 1_000;
    const { g } = gw(llm, { models: { planner: 'claude-sonnet-4-5' }, fallbacks: ['qwen2.5:7b'], now: () => t });
    const first = await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    expect(first.text).toBe('from qwen2.5:7b');
    expect(first.failovers[0]).toContain('claude-sonnet-4-5');
    // 3 consecutive provider failures open the anthropic circuit…
    await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    expect(g.circuitOpen('anthropic')).toBe(true);
    const before = llm.calls.length;
    const skipped = await g.chat({ alias: 'planner', companyId: 'c', messages: msg });
    expect(llm.calls.length - before).toBe(1); // went straight to the fallback
    expect(skipped.failovers[0]).toContain('circuit open');
    // …and half-opens after the cooldown.
    t += 61_000;
    expect(g.circuitOpen('anthropic')).toBe(false);
  });

  it('does not retry non-transient errors on the same model', async () => {
    const llm = new ScriptedLLM(() => new Error('HTTP 401 invalid api key'));
    const { g } = gw(llm, { models: { planner: 'gpt-4o' } });
    await expect(g.chat({ alias: 'planner', companyId: 'c', messages: msg })).rejects.toThrow(/All models failed/);
    expect(llm.calls).toHaveLength(1);
  });

  it('explains when no model is configured', async () => {
    const { g } = gw(new ScriptedLLM(() => ({ text: '' })));
    await expect(g.chat({ alias: 'planner', companyId: 'c', messages: msg })).rejects.toThrow(/No model configured/);
  });

  it('switches models without tool support to the text protocol', async () => {
    const llm = new ScriptedLLM((r) => {
      if (r.toolNames.length) return new Error('registry.ollama.ai/library/gemma:2b does not support tools');
      return { text: 'Let me search.\n```tool\n{"name": "web_search", "args": {"query": "rivals"}}\n```' };
    });
    const { g } = gw(llm, { models: { cheap: 'gemma:2b' } });
    const res = await g.chat({
      alias: 'cheap',
      companyId: 'c',
      messages: [{ role: 'system', content: 'You research.' }, ...msg],
      tools: [{ name: 'web_search', description: 'search', parameters: { type: 'object' } }],
    });
    expect(res.textProtocol).toBe(true);
    expect(res.toolCalls).toEqual([{ id: expect.any(String), name: 'web_search', args: { query: 'rivals' } }]);
    expect(llm.calls[1]!.messages[0]!.content).toContain('## Tools');
    expect(g.health('c', ['cheap'])[0]!.textProtocol).toBe(true);
  });

  it('uses chatOnce(format=json) for local JSON requests', async () => {
    const llm = new ScriptedLLM(() => ({ text: '{"a":1}' }));
    const { g } = gw(llm, { models: { planner: 'qwen2.5:7b' } });
    const res = await g.chat({ alias: 'planner', companyId: 'c', messages: msg, json: true });
    expect(llm.calls[0]).toMatchObject({ kind: 'once', json: true });
    expect(res.usage.estimated).toBe(true);
  });
});

describe('gateway helpers', () => {
  it('parses tool blocks only for offered tools', () => {
    const text = '```tool\n{"name":"a","args":{"x":1}}\n```\n```tool\n{"name":"evil","args":{}}\n```';
    expect(parseToolBlocks(text, new Set(['a'])).map((c) => c.name)).toEqual(['a']);
  });

  it('rewrites tool transcripts for text-protocol models', () => {
    const out = toTextProtocol(
      [
        { role: 'system', content: 'S' },
        { role: 'assistant', content: 'calling', toolCalls: [{ id: '1', name: 'a', args: { x: 1 } }] },
        { role: 'tool', content: 'result', toolName: 'a', toolCallId: '1' },
      ],
      [{ name: 'a', description: 'd', parameters: {} }],
    );
    expect(out[1]!.content).toContain('```tool');
    expect(out[2]).toEqual({ role: 'user', content: '[tool result: a]\nresult' });
  });

  it('extracts the first balanced JSON object from prose and fences', () => {
    expect(extractJsonObject('Sure!\n```json\n{"plan": [{"t": "a}b"}]}\n```')).toEqual({ plan: [{ t: 'a}b' }] });
    expect(extractJsonObject('here {"a": {"b": 2}} trailing }')).toEqual({ a: { b: 2 } });
    expect(extractJsonObject('no json')).toBeNull();
  });

  it('classifies transient errors', () => {
    expect(isTransient(new Error('HTTP 502'))).toBe(true);
    expect(isTransient(new Error('fetch failed'))).toBe(true);
    expect(isTransient(new Error('HTTP 400 bad request'))).toBe(false);
  });
});
