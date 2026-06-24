import { describe, it, expect, vi } from 'vitest';
import { OllamaClient } from '@main/services/ollama-client';

describe('OllamaClient.health', () => {
  it('returns reachable=true with version when /api/version succeeds', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ version: '0.4.0' }), { status: 200 }),
    );
    const client = new OllamaClient('http://localhost:11434', fetchMock);
    const result = await client.health();
    expect(result.reachable).toBe(true);
    expect(result.version).toBe('0.4.0');
    expect(result.host).toBe('http://localhost:11434');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/version',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns reachable=false when fetch throws', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = new OllamaClient('http://localhost:11434', fetchMock);
    const result = await client.health();
    expect(result.reachable).toBe(false);
    expect(result.errorMessage).toContain('ECONNREFUSED');
  });

  it('returns reachable=false when status >= 400', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }));
    const client = new OllamaClient('http://localhost:11434', fetchMock);
    const result = await client.health();
    expect(result.reachable).toBe(false);
    expect(result.errorMessage).toContain('500');
  });

  it('aborts after timeout', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const client = new OllamaClient('http://localhost:11434', fetchMock, 50);
    const result = await client.health();
    expect(result.reachable).toBe(false);
    expect(result.errorMessage?.toLowerCase()).toContain('abort');
  });
});
