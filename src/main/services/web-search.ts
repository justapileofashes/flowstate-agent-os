// Keyless web search: DuckDuckGo HTML → DDG lite → DDG Instant Answer →
// Wikipedia, in that order. Shared by the chat agents' web_search tool and
// the business agent's web.search skill (moved out of tool-dispatcher).

export interface SearchHit {
  title: string;
  snippet: string;
  url: string;
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
