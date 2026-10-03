import { describe, it, expect } from 'vitest';
import { fetchPageDigest, type FetchFn } from '@main/services/web-fetch';

const publicDns = async (): Promise<string[]> => ['93.184.216.34'];

function fakeFetch(routes: Record<string, () => Response>): FetchFn {
  return async (url) => {
    const r = routes[url];
    if (!r) throw new Error(`unexpected fetch ${url}`);
    return r();
  };
}

describe('fetchPageDigest (fetch_url tool)', () => {
  it('digests an HTML page into title, text and absolute links', async () => {
    const html =
      '<html><head><title>Docs</title></head><body><nav>menu</nav><main><h1>Intro</h1><p>Hello world</p>' +
      '<a href="/next">Next page</a></main></body></html>';
    const page = await fetchPageDigest('https://example.com/a', {
      resolve: publicDns,
      fetchFn: fakeFetch({
        'https://example.com/a': () => new Response(html, { headers: { 'content-type': 'text/html' } }),
      }),
    });
    expect(page.title).toBe('Docs');
    expect(page.headings).toEqual(['Intro']);
    expect(page.text).toContain('Hello world');
    expect(page.text).not.toContain('menu');
    expect(page.links).toEqual([{ text: 'Next page', href: 'https://example.com/next' }]);
  });

  it('passes plain text through', async () => {
    const page = await fetchPageDigest('https://example.com/t.txt', {
      resolve: publicDns,
      fetchFn: fakeFetch({
        'https://example.com/t.txt': () => new Response('just text', { headers: { 'content-type': 'text/plain' } }),
      }),
    });
    expect(page.text).toBe('just text');
  });

  it('blocks private hosts, including via a redirect', async () => {
    await expect(fetchPageDigest('http://127.0.0.1/admin')).rejects.toThrow(/private/);
    await expect(fetchPageDigest('http://localhost:11434/api/tags')).rejects.toThrow(/local/);
    const redirect = fetchPageDigest('https://example.com/r', {
      resolve: async (h) => (h === 'example.com' ? ['93.184.216.34'] : ['10.0.0.5']),
      fetchFn: fakeFetch({
        'https://example.com/r': () => new Response(null, { status: 302, headers: { location: 'http://intranet.corp/' } }),
      }),
    });
    await expect(redirect).rejects.toThrow(/private/);
  });

  it('turns HTTP errors into failures', async () => {
    await expect(
      fetchPageDigest('https://example.com/404', {
        resolve: publicDns,
        fetchFn: fakeFetch({ 'https://example.com/404': () => new Response('nope', { status: 404 }) }),
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
