import { describe, it, expect, vi } from 'vitest';
import { extractSigninUrl, getCloudStatus, isOllamaSigninUrl } from '@main/services/ollama-cloud';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('getCloudStatus', () => {
  it('reports the signed-in account from /api/me', async () => {
    const fetchFn = vi.fn(async (_u: string, _i?: RequestInit) => json(200, { name: 'ashton' }));
    await expect(getCloudStatus('http://h', fetchFn)).resolves.toEqual({ signedIn: true, user: 'ashton' });
    expect(fetchFn.mock.calls[0]![0]).toBe('http://h/api/me');
  });

  it('is signed out (with the connect URL) on 401', async () => {
    const r = await getCloudStatus('http://h', async () =>
      json(401, { error: 'unauthorized', signin_url: 'https://ollama.com/connect?key=abc' }),
    );
    expect(r).toEqual({ signedIn: false, user: '', signinUrl: 'https://ollama.com/connect?key=abc' });
  });

  it('never passes on a non-ollama.com sign-in URL', async () => {
    const r = await getCloudStatus('http://h', async () => json(401, { signin_url: 'https://evil.example/x' }));
    expect(r.signinUrl).toBeUndefined();
  });

  it('explains an old Ollama (no account endpoint) as a note, not an error', async () => {
    const r = await getCloudStatus('http://h', async () => json(404, { error: 'not found' }));
    expect(r.signedIn).toBe(false);
    expect(r.error).toBeUndefined();
    expect(r.note).toMatch(/update Ollama/);
  });

  it('handles Ollama not running', async () => {
    const r = await getCloudStatus('http://h', async () => {
      throw new Error('fetch failed');
    });
    expect(r.note).toMatch(/not running/);
    expect(r.error).toBeUndefined();
  });
});

describe('sign-in URL helpers', () => {
  it('extracts the ollama.com connect URL from CLI output', () => {
    const out = 'You need to be signed in to Ollama to run Cloud models.\n\nTo sign in, navigate to:\n    https://ollama.com/connect?name=pc&key=abc123\n';
    expect(extractSigninUrl(out)).toBe('https://ollama.com/connect?name=pc&key=abc123');
  });

  it('ignores other URLs', () => {
    expect(extractSigninUrl('see https://example.com/help')).toBeNull();
    expect(isOllamaSigninUrl('http://ollama.com/connect')).toBe(false);
    expect(isOllamaSigninUrl('https://www.ollama.com/connect')).toBe(true);
  });
});
