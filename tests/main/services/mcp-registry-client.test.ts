import { describe, it, expect, vi } from 'vitest';
import { searchMcpRegistry } from '@main/services/mcp-registry-client';

const npm = (name: string, status = 'active') => ({
  server: {
    name,
    version: '1.0.0',
    packages: [{ registryType: 'npm', identifier: `@x/${name.split('/').pop()}`, version: '1.0.0', transport: { type: 'stdio' } }],
  },
  _meta: { 'io.modelcontextprotocol.registry/official': { status, isLatest: true } },
});

describe('searchMcpRegistry', () => {
  it('asks for latest versions, keeps active installable servers once each', async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            servers: [
              npm('a/one'),
              npm('a/one'),
              npm('a/gone', 'deprecated'),
              { server: { name: 'a/nothing-to-run', version: '1' } },
              npm('a/two'),
            ],
          }),
          { status: 200 },
        ),
    );
    const out = await searchMcpRegistry('uniq-query-1', fetchFn as unknown as typeof fetch);
    expect(out.map((e) => e.name)).toEqual(['a/one', 'a/two']);
    const url = String(fetchFn.mock.calls[0]![0]);
    expect(url).toContain('version=latest');
    expect(url).toContain('search=uniq-query-1');
  });

  it('surfaces HTTP errors', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 503 }));
    await expect(searchMcpRegistry('uniq-query-2', fetchFn as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});
