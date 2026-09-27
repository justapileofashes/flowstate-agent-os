// Web search for the chat agents' web_search tool and the business agent's
// web.search skill. The provider is a setting: Brave Search API, Tavily, a
// search tool from a connected MCP server, or the keyless built-in chain
// (DuckDuckGo HTML → DDG lite → DDG Instant Answer → Wikipedia). Whatever is
// configured runs first; the built-in chain is the fallback, and every result
// names the provider that answered.

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
}

export type WebSearchProviderId = 'builtin' | 'brave' | 'tavily' | 'mcp';

export const WEB_SEARCH_SETTING_KEYS = {
  provider: 'web_search_provider',
  braveKey: 'brave_search_api_key',
  tavilyKey: 'tavily_api_key',
  mcpTool: 'web_search_mcp_tool',
} as const;

export interface WebSearchConfig {
  provider: WebSearchProviderId;
  braveKey?: string;
  tavilyKey?: string;
  /** Full MCP tool name: mcp__<serverId>__<tool>. */
  mcpTool?: string;
}

export interface WebSearchEnv {
  config(): WebSearchConfig;
  callMcp?: (tool: string, args: Record<string, unknown>) => Promise<{ content: string; isError: boolean }>;
  /** JSON schema of an MCP tool's input, used to map query/limit onto it. */
  mcpSchema?: (tool: string) => unknown;
  fetchFn?: typeof fetch;
}

export interface WebSearchResult {
  /** Who answered, e.g. "Brave Search", "MCP firecrawl_search", "Built-in (DuckDuckGo / Wikipedia)". */
  provider: string;
  hits: SearchHit[];
  /** Raw text from an MCP tool whose output isn't a list of hits. */
  text?: string;
  /** Set when the configured provider failed and a fallback answered. */
  note?: string;
}

export const BUILTIN_PROVIDER_LABEL = 'Built-in (DuckDuckGo / Wikipedia)';
const MAX_MCP_TEXT = 12_000;

export function readWebSearchConfig(get: (key: string) => string | null | undefined): WebSearchConfig {
  const raw = (get(WEB_SEARCH_SETTING_KEYS.provider) ?? '').trim();
  const provider: WebSearchProviderId =
    raw === 'brave' || raw === 'tavily' || raw === 'mcp' ? raw : 'builtin';
  const cfg: WebSearchConfig = { provider };
  const brave = (get(WEB_SEARCH_SETTING_KEYS.braveKey) ?? '').trim();
  const tavily = (get(WEB_SEARCH_SETTING_KEYS.tavilyKey) ?? '').trim();
  const tool = (get(WEB_SEARCH_SETTING_KEYS.mcpTool) ?? '').trim();
  if (brave) cfg.braveKey = brave;
  if (tavily) cfg.tavilyKey = tavily;
  if (tool) cfg.mcpTool = tool;
  return cfg;
}

async function readError(res: Response, who: string): Promise<Error> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 300).trim();
  } catch {
    // no body
  }
  const hint = res.status === 401 || res.status === 403 ? ' (check the API key)' : res.status === 429 ? ' (rate limited)' : '';
  return new Error(`${who} returned HTTP ${res.status}${hint}${body ? `: ${body}` : ''}`);
}

export async function braveSearch(
  key: string,
  query: string,
  limit: number,
  fetchFn: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(Math.max(limit, 1), 20)}`;
  const res = await fetchFn(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw await readError(res, 'Brave Search');
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .slice(0, limit)
    .map((r) => ({ url: r.url!, title: stripHtml(r.title ?? r.url!), snippet: stripHtml(r.description ?? '') }));
}

export async function tavilySearch(
  key: string,
  query: string,
  limit: number,
  fetchFn: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const res = await fetchFn('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: Math.min(Math.max(limit, 1), 20), search_depth: 'basic' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw await readError(res, 'Tavily');
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? [])
    .filter((r) => r.url)
    .slice(0, limit)
    .map((r) => ({ url: r.url!, title: r.title ?? r.url!, snippet: (r.content ?? '').slice(0, 500) }));
}

const QUERY_KEYS = ['query', 'q', 'search', 'searchQuery', 'search_query', 'searchTerm', 'text', 'prompt'];
const LIMIT_KEYS = ['limit', 'count', 'max_results', 'maxResults', 'num_results', 'numResults', 'numberOfResults', 'n', 'num'];

/** Map {query, limit} onto whatever an MCP search tool's input schema asks for. */
export function mcpSearchArgs(schema: unknown, query: string, limit: number): Record<string, unknown> {
  const s = (schema && typeof schema === 'object' ? schema : {}) as {
    properties?: Record<string, { type?: string | string[] }>;
    required?: string[];
  };
  const props = s.properties ?? {};
  const names = Object.keys(props);
  const isString = (k: string): boolean => {
    const t = props[k]?.type;
    return t === undefined || t === 'string' || (Array.isArray(t) && t.includes('string'));
  };
  const queryKey =
    QUERY_KEYS.find((k) => k in props) ??
    (s.required ?? []).find((k) => isString(k)) ??
    names.find((k) => isString(k)) ??
    'query';
  const args: Record<string, unknown> = { [queryKey]: query };
  const limitKey = LIMIT_KEYS.find((k) => k in props);
  if (limitKey) {
    const t = props[limitKey]?.type;
    args[limitKey] = t === 'string' ? String(limit) : limit;
  }
  return args;
}

/** Best-effort: pull {title,url,snippet} records out of an MCP tool's text. */
export function hitsFromMcpText(text: string, limit: number): SearchHit[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const pickList = (v: unknown): unknown[] | null => {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['results', 'data', 'web', 'items', 'hits', 'organic']) {
        const inner = o[k];
        if (Array.isArray(inner)) return inner;
        if (inner && typeof inner === 'object') {
          const nested = pickList(inner);
          if (nested) return nested;
        }
      }
    }
    return null;
  };
  const list = pickList(parsed) ?? [];
  const hits: SearchHit[] = [];
  for (const item of list) {
    if (hits.length >= limit) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const url = [o['url'], o['link'], o['href']].find((v): v is string => typeof v === 'string');
    if (!url) continue;
    const title = [o['title'], o['name']].find((v): v is string => typeof v === 'string') ?? url;
    const snippet =
      [o['snippet'], o['description'], o['content'], o['text'], o['markdown']].find(
        (v): v is string => typeof v === 'string',
      ) ?? '';
    hits.push({ url, title: stripHtml(title), snippet: stripHtml(snippet).slice(0, 500) });
  }
  return hits;
}

export function mcpToolLabel(fullName: string): string {
  const rest = fullName.replace(/^mcp__/, '');
  const i = rest.indexOf('__');
  return i > 0 ? rest.slice(i + 2) : rest;
}

async function runConfigured(
  cfg: WebSearchConfig,
  query: string,
  limit: number,
  env: WebSearchEnv,
): Promise<WebSearchResult> {
  const fetchFn = env.fetchFn ?? fetch;
  switch (cfg.provider) {
    case 'brave': {
      if (!cfg.braveKey) throw new Error('Brave Search is selected but no API key is saved');
      return { provider: 'Brave Search', hits: await braveSearch(cfg.braveKey, query, limit, fetchFn) };
    }
    case 'tavily': {
      if (!cfg.tavilyKey) throw new Error('Tavily is selected but no API key is saved');
      return { provider: 'Tavily', hits: await tavilySearch(cfg.tavilyKey, query, limit, fetchFn) };
    }
    case 'mcp': {
      if (!cfg.mcpTool) throw new Error('An MCP search tool is selected but none is chosen');
      if (!env.callMcp) throw new Error('MCP is not available here');
      const res = await env.callMcp(cfg.mcpTool, mcpSearchArgs(env.mcpSchema?.(cfg.mcpTool), query, limit));
      const label = `MCP ${mcpToolLabel(cfg.mcpTool)}`;
      if (res.isError) throw new Error(`${label} failed: ${res.content.slice(0, 300)}`);
      const hits = hitsFromMcpText(res.content, limit);
      if (hits.length) return { provider: label, hits };
      if (!res.content.trim()) return { provider: label, hits: [] };
      const text =
        res.content.length > MAX_MCP_TEXT
          ? `${res.content.slice(0, MAX_MCP_TEXT)}\n[truncated ${res.content.length - MAX_MCP_TEXT} chars]`
          : res.content;
      return { provider: label, hits: [], text };
    }
    default:
      return { provider: BUILTIN_PROVIDER_LABEL, hits: await duckDuckGoSearch(query, limit) };
  }
}

/**
 * Run the configured provider; if it fails or finds nothing, fall back to the
 * built-in chain and say why in `note`. Throws only when everything failed.
 */
export async function webSearch(query: string, limit: number, env: WebSearchEnv): Promise<WebSearchResult> {
  const cfg = env.config();
  if (cfg.provider === 'builtin') {
    return { provider: BUILTIN_PROVIDER_LABEL, hits: await duckDuckGoSearch(query, limit) };
  }
  let reason: string;
  try {
    const res = await runConfigured(cfg, query, limit, env);
    if (res.hits.length || res.text) return res;
    reason = `${res.provider} returned no results`;
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  }
  try {
    const hits = await duckDuckGoSearch(query, limit);
    return { provider: BUILTIN_PROVIDER_LABEL, hits, note: `${reason} — used the built-in search instead.` };
  } catch (err) {
    throw new Error(`${reason}. Built-in fallback also failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// App-wide environment, set once at startup (main/index.ts) so every caller —
// chat tools, team runs, the business agent — follows the same setting.
let appEnv: WebSearchEnv | null = null;

export function configureWebSearch(env: WebSearchEnv | null): void {
  appEnv = env;
}

/** Search with the app's configured provider (built-in when unconfigured). */
export function searchWeb(query: string, limit: number): Promise<WebSearchResult> {
  return webSearch(query, limit, appEnv ?? { config: () => ({ provider: 'builtin' }) });
}

const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function duckDuckGoSearch(query: string, limit: number): Promise<SearchHit[]> {
  // Try html.duckduckgo.com first; fall back to lite.duckduckgo.com if that
  // returns 0 hits (their bot filter rotates which page works). Final fallback
  // is the public Instant Answer JSON API for at least an abstract.
  const headers = {
    'User-Agent': UA_DESKTOP,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://duckduckgo.com/',
  };

  const hits: SearchHit[] = [];

  // Helper to parse the standard HTML result page.
  const parseHtmlPage = (html: string): void => {
    const blockRe =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) !== null && hits.length < limit) {
      const rawUrl = decodeURIComponent(match[1]!.replace(/&amp;/g, '&'));
      let target = rawUrl;
      const wrap = /uddg=([^&]+)/.exec(rawUrl);
      if (wrap) target = decodeURIComponent(wrap[1]!);
      hits.push({
        url: target,
        title: stripHtml(match[2]!),
        snippet: stripHtml(match[3]!),
      });
    }
  };

  // Helper for the lite version (simpler markup, table-based).
  const parseLitePage = (html: string): void => {
    const liteRe = /<a class="result-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = liteRe.exec(html)) !== null && hits.length < limit) {
      const target = m[1]!;
      hits.push({
        url: target,
        title: stripHtml(m[2]!),
        snippet: stripHtml(m[3]!),
      });
    }
    // Fallback to a more permissive pattern if the structured one missed.
    if (hits.length === 0) {
      const looseRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{6,})<\/a>/g;
      let mm: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((mm = looseRe.exec(html)) !== null && hits.length < limit) {
        const u = mm[1]!;
        if (seen.has(u)) continue;
        seen.add(u);
        if (/duckduckgo\.com/.test(u)) continue;
        hits.push({ url: u, title: stripHtml(mm[2]!), snippet: '' });
      }
    }
  };

  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers },
    );
    if (res.ok) parseHtmlPage(await res.text());
  } catch {
    // ignore — try next endpoint
  }

  if (hits.length === 0) {
    try {
      const res = await fetch(
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
        { headers },
      );
      if (res.ok) parseLitePage(await res.text());
    } catch {
      // ignore
    }
  }

  if (hits.length === 0) {
    // Instant-answer JSON API — limited but reliable. Returns abstract + topic
    // results for many queries.
    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': UA_DESKTOP, Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
        };
        if (data.AbstractText && data.AbstractURL) {
          hits.push({
            url: data.AbstractURL,
            title: data.Heading ?? query,
            snippet: data.AbstractText,
          });
        }
        for (const t of data.RelatedTopics ?? []) {
          if (hits.length >= limit) break;
          if (t.FirstURL && t.Text) {
            hits.push({ url: t.FirstURL, title: t.Text.slice(0, 80), snippet: t.Text });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Wikipedia full-text fallback. Always reachable, returns at least an
  // abstract for almost any query — good safety net when DDG is throttled.
  if (hits.length === 0) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': UA_DESKTOP, Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          query?: { search?: Array<{ title: string; snippet: string; pageid: number }> };
        };
        for (const r of data.query?.search ?? []) {
          if (hits.length >= limit) break;
          hits.push({
            url: `https://en.wikipedia.org/?curid=${r.pageid}`,
            title: r.title,
            snippet: stripHtml(r.snippet),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  if (hits.length === 0) {
    throw new Error(
      `No search results for "${query}" across DuckDuckGo HTML/lite, DDG Instant Answer, and Wikipedia. Likely network blocked or the query is too narrow — try broader wording or a specific site (e.g. "OpenAI blog announcements").`,
    );
  }
  return hits;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
