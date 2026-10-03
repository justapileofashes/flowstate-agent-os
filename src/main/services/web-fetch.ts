// SSRF-safe page fetch + readable digest, shared by the core `fetch_url` tool
// and the Business agent's web.browse skill. Only public http(s) hosts: the
// host is resolved and every address checked (private, loopback, link-local,
// metadata ranges blocked), and the check repeats on every redirect hop.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { stripHtml } from '@main/business/guardrails/scrub';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function ipv4Private(ip: string): boolean {
  const p = ip.split('.').map(Number);
  const [a, b] = [p[0] ?? 0, p[1] ?? 0];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && p[2] === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return ipv4Private(ip);
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return ipv4Private(mapped[1]!);
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((a) => a.address);

function domainMatches(host: string, domain: string): boolean {
  const d = domain.toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return host === d || host.endsWith(`.${d}`);
}

export async function assertPublicUrl(
  raw: string,
  opts: { allow: string[]; block: string[]; resolve?: Resolver },
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) URLs can be browsed');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new Error('local/internal hosts are blocked');
  }
  if (opts.block.some((d) => domainMatches(host, d))) throw new Error(`${host} is on the company blocklist`);
  if (opts.allow.length && !opts.allow.some((d) => domainMatches(host, d))) {
    throw new Error(`${host} is not on the company allowlist`);
  }
  const addrs = isIP(host) ? [host] : await (opts.resolve ?? defaultResolver)(host);
  if (!addrs.length) throw new Error(`could not resolve ${host}`);
  if (addrs.some(isPrivateAddress)) throw new Error(`${host} resolves to a private address — blocked`);
  return url;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 Flowstate';
const MAX_BYTES = 3_000_000;

export async function safeFetchPage(
  raw: string,
  opts: { allow: string[]; block: string[]; fetchFn: FetchFn; resolve?: Resolver; signal?: AbortSignal },
): Promise<{ url: string; status: number; contentType: string; body: string }> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current, opts);
    const timeout = AbortSignal.timeout(15_000);
    const res = await opts.fetchFn(url.toString(), {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirect without location (${res.status})`);
      current = new URL(loc, url).toString();
      continue;
    }
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > MAX_BYTES) throw new Error(`page too large (${len} bytes)`);
    const body = (await res.text()).slice(0, MAX_BYTES);
    return { url: url.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', body };
  }
  throw new Error('too many redirects');
}

export interface PageDigest {
  title: string;
  description: string;
  headings: string[];
  text: string;
  links: Array<{ text: string; href: string }>;
  prices: string[];
}

export function digestHtml(html: string, baseUrl: string): PageDigest {
  const title = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').slice(0, 200);
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
    '';
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => stripHtml(m[1] ?? ''))
    .filter(Boolean)
    .slice(0, 30);
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  const text = stripHtml(main.replace(/<(nav|footer|header|svg|noscript)[\s\S]*?<\/\1>/gi, ' ')).slice(0, 20_000);
  const links: Array<{ text: string; href: string }> = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= 40) break;
    try {
      const href = new URL(m[1]!, baseUrl).toString();
      if (!href.startsWith('http')) continue;
      const t = stripHtml(m[2] ?? '').slice(0, 80);
      if (t && !links.some((l) => l.href === href)) links.push({ text: t, href });
    } catch {
      // bad href
    }
  }
  const prices = [...new Set(text.match(/(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?(?:\s?\/\s?(?:month|mo|year|yr|user|seat))?)/gi) ?? [])].slice(0, 20);
  return { title, description: stripHtml(description).slice(0, 300), headings, text, links, prices };
}

/** Fetch a public page and digest it: HTML → readable text + links; other
 *  text types pass through. Used by the agents' fetch_url tool. */
export async function fetchPageDigest(
  url: string,
  opts: { fetchFn?: FetchFn; resolve?: Resolver; signal?: AbortSignal } = {},
): Promise<PageDigest & { url: string; status: number }> {
  const page = await safeFetchPage(url, {
    allow: [],
    block: [],
    fetchFn: opts.fetchFn ?? fetch,
    ...(opts.resolve ? { resolve: opts.resolve } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (page.status >= 400) throw new Error(`${page.url} returned HTTP ${page.status}`);
  const digest =
    /html/i.test(page.contentType) || /<html|<body/i.test(page.body)
      ? digestHtml(page.body, page.url)
      : { title: '', description: '', headings: [], text: page.body.slice(0, 20_000), links: [], prices: [] };
  return { url: page.url, status: page.status, ...digest };
}
