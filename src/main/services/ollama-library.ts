// Scrapes https://ollama.com/library (server-rendered HTML) into model cards
// for the Models screen's library browser.
//
// ollama.com used to tag fields with x-test-* attributes; those are gone
// (2026), which left sizes, capabilities, pulls, tags and "updated" blank.
// The parser now reads the visible structure — badge spans and the
// "<value> Pulls / Tags / Updated <when>" line — and still accepts the old
// attributes if they come back.

export interface LibraryModel {
  name: string;
  description: string;
  pullCount: string;
  tagCount: number;
  sizes: string[];
  capabilities: string[];
  updatedAt: string;
}

export function stripHtmlInline(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parameter-size badges: 7b, 0.6b, 1.5m, 8x7b, e4b, 235b-a22b. */
const SIZE_RE = /^(?:\d+x)?e?\d+(?:\.\d+)?[bmk](?:-a\d+(?:\.\d+)?[bm])?$/i;

/** "<span>38.1M</span><span …>&nbsp;Pulls</span>" → "38.1M". */
function labelled(block: string, label: string): string {
  const re = new RegExp(`<span[^>]*>\\s*([^<]+?)\\s*</span>\\s*<span[^>]*>(?:&nbsp;|\\s)*${label}\\b`, 'i');
  return block.match(re)?.[1]?.trim() ?? '';
}

export function parseOllamaLibrary(html: string): LibraryModel[] {
  const blocks = html.split(/<li[\s>]/i).slice(1);
  const out: LibraryModel[] = [];
  const seen = new Set<string>();
  for (const blk of blocks) {
    const hrefMatch = blk.match(/href="\/library\/([^"/?#]+)"/);
    if (!hrefMatch) continue;
    const name = hrefMatch[1]!.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);

    const descMatch = blk.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch ? stripHtmlInline(descMatch[1]!).slice(0, 220) : '';

    // Badges: legacy x-test-* spans, else every rounded "pill" span.
    const legacyCaps = [...blk.matchAll(/x-test-capability[^>]*>([^<]+)</g)].map((m) => m[1]!.trim());
    const legacySizes = [...blk.matchAll(/x-test-size[^>]*>([^<]+)</g)].map((m) => m[1]!.trim());
    const pills = [...blk.matchAll(/<span[^>]*class="[^"]*rounded-md[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/g)].map(
      (m) => stripHtmlInline(m[1]!),
    );
    const sizes = legacySizes.length ? legacySizes : pills.filter((t) => SIZE_RE.test(t));
    const capabilities = (legacyCaps.length ? legacyCaps : pills.filter((t) => !SIZE_RE.test(t))).map((c) =>
      c.toLowerCase(),
    );

    const pullCount = blk.match(/x-test-pull-count[^>]*>([^<]+)</)?.[1]?.trim() || labelled(blk, 'Pulls');
    const tags = blk.match(/x-test-tag-count[^>]*>([^<]+)</)?.[1] || labelled(blk, 'Tags');
    const updatedAt =
      blk.match(/x-test-updated[^>]*>([^<]+)</)?.[1]?.trim() ||
      blk.match(/Updated(?:&nbsp;|\s)*<\/span>\s*<span[^>]*>\s*([^<]+?)\s*<\/span>/i)?.[1]?.trim() ||
      '';

    out.push({
      name,
      description,
      pullCount,
      tagCount: Number(String(tags).replace(/[^0-9]/g, '')) || 0,
      sizes: [...new Set(sizes)],
      capabilities: [...new Set(capabilities)],
      updatedAt,
    });
  }
  // Last resort for an unrecognisable page: model names from links.
  if (out.length === 0) {
    for (const m of html.matchAll(/href="\/library\/([a-z0-9._-]+)"/gi)) {
      const name = m[1]!.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, description: '', pullCount: '', tagCount: 0, sizes: [], capabilities: [], updatedAt: '' });
    }
  }
  return out;
}

export async function fetchOllamaLibrary(fetchFn: typeof fetch = fetch): Promise<LibraryModel[]> {
  const res = await fetchFn('https://ollama.com/library?sort=popular', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Ollama library returned ${res.status}`);
  return parseOllamaLibrary(await res.text());
}
