import { describe, it, expect, vi } from 'vitest';
import { extractInlineImages, hasInlineImages } from '@main/agent/inline-images';
import { OllamaProvider } from '@main/agent/ollama-provider';
import { ProviderRouter } from '@main/agent/provider-router';
import { FakeProvider } from '@main/agent/fake-provider';
import type { ChatStreamOpts } from '@main/agent/llm-provider';

const MSG = 'what is this?\n\n![image 1](data:image/png;base64,iVBORw0KGgo=)';

describe('inline images', () => {
  it('splits pasted data-URL images out of message text', () => {
    expect(hasInlineImages(MSG)).toBe(true);
    expect(extractInlineImages(MSG)).toEqual({ text: 'what is this?\n\n[image attached]', images: ['iVBORw0KGgo='] });
    expect(hasInlineImages('plain text')).toBe(false);
  });

  it('Ollama gets them as real images, not base64 text', async () => {
    const fetchMock = vi.fn(
      async (_u: string, _i?: RequestInit) =>
        new Response(JSON.stringify({ message: { content: '' }, done: true }) + '\n', { status: 200 }),
    );
    const p = new OllamaProvider('http://h', fetchMock);
    for await (const _ of p.chatStream({ model: 'llava:7b', messages: [{ role: 'user', content: MSG }], tools: [] })) {
      // drain
    }
    // A turn with images probes /api/show first, so /api/chat is not call 0.
    const chatCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/api/chat'));
    const body = JSON.parse(String(chatCall![1]!.body)) as {
      messages: Array<{ content: string; images?: string[] }>;
    };
    expect(body.messages[0]).toMatchObject({ content: 'what is this?\n\n[image attached]', images: ['iVBORw0KGgo='] });
  });

  it('other providers get a note instead of the base64', async () => {
    const seen: string[] = [];
    class Spy extends FakeProvider {
      // eslint-disable-next-line require-yield -- only records what it was sent
      async *chatStream(opts: ChatStreamOpts): AsyncGenerator<never> {
        seen.push(opts.messages[0]!.content);
      }
    }
    const spy = new Spy([]);
    const router = new ProviderRouter({
      ollama: new FakeProvider([]),
      anthropic: spy,
      openai: spy,
      gemini: spy,
      perplexity: spy,
      groq: spy,
      mistral: spy,
      xai: spy,
      custom: spy,
    });
    for await (const _ of router.chatStream({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: MSG }], tools: [] })) {
      // drain
    }
    expect(seen[0]).not.toContain('base64');
    expect(seen[0]).toContain('image attached');
  });
});
