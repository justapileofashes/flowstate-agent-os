import { describe, it, expect } from 'vitest';
import { CustomOpenAIProvider, normalizeBaseUrl } from '@main/agent/custom-provider';
import { providerKindForModel } from '@main/agent/provider-router';

describe('custom OpenAI-compatible provider', () => {
  it('routes custom/ models to it, before any name heuristics', () => {
    expect(providerKindForModel('custom/gpt-4o-mini')).toBe('custom');
    expect(providerKindForModel('custom/llama-3.1-8b')).toBe('custom');
    expect(providerKindForModel('gpt-4o-mini')).toBe('openai');
  });

  it('normalizes the base URL', () => {
    expect(normalizeBaseUrl(' http://localhost:1234/v1/ ')).toBe('http://localhost:1234');
    expect(normalizeBaseUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('lists server models as custom/<id> and strips the prefix when chatting', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
      if (url.endsWith('/v1/models')) return new Response(JSON.stringify({ data: [{ id: 'qwen2.5-7b-instruct' }] }));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
    }) as unknown as typeof fetch;
    const p = new CustomOpenAIProvider(() => 'http://localhost:1234/v1', () => '', fetchImpl);
    expect(await p.listModels()).toEqual([{ name: 'custom/qwen2.5-7b-instruct' }]);
    await p.chatOnce({ model: 'custom/qwen2.5-7b-instruct', messages: [{ role: 'user', content: 'x' }] });
    const chat = calls.find((c) => c.url.endsWith('/v1/chat/completions'))!;
    expect(chat.url).toBe('http://localhost:1234/v1/chat/completions');
    expect(JSON.parse(chat.body!).model).toBe('qwen2.5-7b-instruct');
  });

  it('is empty and unreachable until configured', async () => {
    const p = new CustomOpenAIProvider(() => '', () => '');
    expect(await p.listModels()).toEqual([]);
    expect(await p.isReachable()).toBe(false);
    await expect(p.chatOnce({ model: 'custom/x', messages: [] })).rejects.toThrow(/Settings/);
  });
});
