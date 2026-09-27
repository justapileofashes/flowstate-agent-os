import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  BUILTIN_PROVIDER_LABEL,
  braveSearch,
  hitsFromMcpText,
  mcpSearchArgs,
  readWebSearchConfig,
  tavilySearch,
  webSearch,
} from '@main/services/web-search';
import { parseWebSearchOutput } from '@shared/web-search-result';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

// The built-in chain's last resort (Wikipedia) — lets fallback tests run offline.
function stubBuiltin(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => {
    if (url.includes('wikipedia.org')) {
      return json({ query: { search: [{ title: 'Wiki hit', snippet: '<b>x</b>', pageid: 7 }] } });
    }
    return new Response('blocked', { status: 403 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readWebSearchConfig', () => {
  it('defaults to built-in and trims values', () => {
    expect(readWebSearchConfig(() => null)).toEqual({ provider: 'builtin' });
    const store: Record<string, string> = {
      web_search_provider: 'brave',
      brave_search_api_key: '  BSA-1 ',
      web_search_mcp_tool: '',
    };
    expect(readWebSearchConfig((k) => store[k])).toEqual({ provider: 'brave', braveKey: 'BSA-1' });
    expect(readWebSearchConfig((k) => (k === 'web_search_provider' ? 'bogus' : null)).provider).toBe('builtin');
  });
});

describe('braveSearch', () => {
  it('sends the subscription token and maps web results', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ web: { results: [{ title: 'A <strong>b</strong>', url: 'https://a.test', description: 'd &amp; e' }, { title: 'no url' }] } }),
    );
    const hits = await braveSearch('KEY', 'q w', 5, fetchFn as unknown as typeof fetch);
    expect(hits).toEqual([{ url: 'https://a.test', title: 'A b', snippet: 'd & e' }]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toContain('q=q%20w');
    expect(url).toContain('count=5');
    expect((init!.headers as Record<string, string>)['X-Subscription-Token']).toBe('KEY');
  });

  it('explains auth failures', async () => {
    const fetchFn = vi.fn(async () => new Response('bad token', { status: 401 }));
    await expect(braveSearch('KEY', 'q', 3, fetchFn as unknown as typeof fetch)).rejects.toThrow(
      /Brave Search returned HTTP 401 \(check the API key\)/,
    );
  });
});

describe('tavilySearch', () => {
  it('posts the query with a bearer key and maps results', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ results: [{ title: 'T', url: 'https://t.test', content: 'c' }] }),
    );
    const hits = await tavilySearch('tvly-1', 'hello', 4, fetchFn as unknown as typeof fetch);
    expect(hits).toEqual([{ url: 'https://t.test', title: 'T', snippet: 'c' }]);
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init!.headers as Record<string, string>)['Authorization']).toBe('Bearer tvly-1');
    expect(JSON.parse(String(init!.body))).toMatchObject({ query: 'hello', max_results: 4 });
  });
});

describe('mcpSearchArgs', () => {
  it('maps onto common search tool schemas', () => {
    // Firecrawl firecrawl_search
    expect(mcpSearchArgs({ properties: { query: { type: 'string' }, limit: { type: 'number' } } }, 'x', 5)).toEqual({ query: 'x', limit: 5 });
    // Brave MCP brave_web_search
    expect(mcpSearchArgs({ properties: { query: { type: 'string' }, count: { type: 'integer' } } }, 'x', 3)).toEqual({ query: 'x', count: 3 });
    // Exa web_search_exa
    expect(mcpSearchArgs({ properties: { query: {}, numResults: { type: 'number' } } }, 'x', 2)).toEqual({ query: 'x', numResults: 2 });
    // Unknown names: first required string property.
    expect(mcpSearchArgs({ properties: { topic: { type: 'string' }, depth: { type: 'number' } }, required: ['topic'] }, 'x', 2)).toEqual({ topic: 'x' });
    // No schema at all.
    expect(mcpSearchArgs(undefined, 'x', 2)).toEqual({ query: 'x' });
  });
});

describe('hitsFromMcpText', () => {
  it('reads hit lists in the usual wrappers', () => {
    expect(hitsFromMcpText(JSON.stringify([{ url: 'https://a', title: 'A', description: 'd' }]), 5)).toEqual([
      { url: 'https://a', title: 'A', snippet: 'd' },
    ]);
    expect(hitsFromMcpText(JSON.stringify({ data: { web: [{ link: 'https://b', name: 'B' }] } }), 5)).toEqual([
      { url: 'https://b', title: 'B', snippet: '' },
    ]);
    expect(hitsFromMcpText('Title: A\nURL: https://a', 5)).toEqual([]);
  });
});

describe('webSearch', () => {
  it('uses the configured provider and names it', async () => {
    const fetchFn = vi.fn(async () => json({ web: { results: [{ title: 'A', url: 'https://a' }] } }));
    const res = await webSearch('q', 3, {
      config: () => ({ provider: 'brave', braveKey: 'K' }),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.provider).toBe('Brave Search');
    expect(res.hits).toHaveLength(1);
    expect(res.note).toBeUndefined();
  });

  it('falls back to the built-in chain with a note when the provider fails', async () => {
    stubBuiltin();
    const res = await webSearch('q', 3, {
      config: () => ({ provider: 'tavily', tavilyKey: 'K' }),
      fetchFn: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    });
    expect(res.provider).toBe(BUILTIN_PROVIDER_LABEL);
    expect(res.hits[0]!.title).toBe('Wiki hit');
    expect(res.note).toMatch(/Tavily returned HTTP 401.*used the built-in search instead/);
  });

  it('falls back when a key is missing', async () => {
    stubBuiltin();
    const res = await webSearch('q', 3, { config: () => ({ provider: 'brave' }) });
    expect(res.note).toMatch(/no API key is saved/);
  });

  it('calls the chosen MCP tool with mapped args and keeps free text', async () => {
    const callMcp = vi.fn(async () => ({ content: 'Some markdown results', isError: false }));
    const res = await webSearch('q', 4, {
      config: () => ({ provider: 'mcp', mcpTool: 'mcp__firecrawl__firecrawl_search' }),
      callMcp,
      mcpSchema: () => ({ properties: { query: { type: 'string' }, limit: { type: 'number' } } }),
    });
    expect(callMcp).toHaveBeenCalledWith('mcp__firecrawl__firecrawl_search', { query: 'q', limit: 4 });
    expect(res.provider).toBe('MCP firecrawl_search');
    expect(res.text).toBe('Some markdown results');
  });

  it('falls back when the MCP tool errors', async () => {
    stubBuiltin();
    const res = await webSearch('q', 3, {
      config: () => ({ provider: 'mcp', mcpTool: 'mcp__x__search' }),
      callMcp: async () => ({ content: 'rate limited', isError: true }),
    });
    expect(res.provider).toBe(BUILTIN_PROVIDER_LABEL);
    expect(res.note).toMatch(/MCP search failed: rate limited/);
  });

  it('reports both failures when everything fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('blocked', { status: 403 })));
    await expect(
      webSearch('q', 3, { config: () => ({ provider: 'brave' }) }),
    ).rejects.toThrow(/no API key is saved\. Built-in fallback also failed/);
  });
});

describe('parseWebSearchOutput', () => {
  it('accepts the old bare array and the new object', () => {
    expect(parseWebSearchOutput('[{"url":"u"}]')).toEqual({ results: [{ url: 'u' }] });
    expect(parseWebSearchOutput('{"provider":"Tavily","note":"n","results":[]}')).toEqual({
      provider: 'Tavily',
      note: 'n',
      results: [],
    });
    expect(parseWebSearchOutput('not json')).toBeNull();
    expect(parseWebSearchOutput('{"x":1}')).toBeNull();
  });
});
