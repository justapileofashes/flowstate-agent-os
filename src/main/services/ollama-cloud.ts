// Ollama cloud (Turbo) account status + sign-in helpers.
//
// The Settings card used to shell out to `ollama whoami`, which doesn't exist
// (it printed "unknown command" in red), and treated `ollama signin` exiting
// 0 as "signed in" although that command only prints a connect URL. Status now
// comes from the local server's account endpoint, and sign-in hands the user
// the connect URL to finish in their browser.

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface CloudStatus {
  signedIn: boolean;
  user: string;
  /** Something is actually wrong (shown in red). */
  error?: string;
  /** Informational — Ollama offline, too old, … (shown muted). */
  note?: string;
  /** Where to finish signing in, when the server offers it. */
  signinUrl?: string;
}

/** Only ever open ollama.com connect/sign-in pages in the user's browser. */
export function isOllamaSigninUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'ollama.com' || u.hostname.endsWith('.ollama.com'));
  } catch {
    return false;
  }
}

/** First ollama.com https URL in CLI output, if any. */
export function extractSigninUrl(text: string): string | null {
  for (const m of text.matchAll(/https:\/\/[^\s"'<>]+/g)) {
    const url = m[0].replace(/[).,;]+$/, '');
    if (isOllamaSigninUrl(url)) return url;
  }
  return null;
}

export async function getCloudStatus(host: string, fetchFn: FetchFn = fetch): Promise<CloudStatus> {
  let res: Response;
  try {
    res = await fetchFn(`${host}/api/me`, { method: 'POST' });
  } catch {
    return { signedIn: false, user: '', note: 'Ollama is not running — start it to check your cloud account.' };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON body
  }
  if (res.ok) {
    const user = [body['name'], body['username'], body['email']].find((v) => typeof v === 'string' && v) as
      | string
      | undefined;
    return { signedIn: true, user: user ?? '' };
  }
  if (res.status === 401 || res.status === 403) {
    const url = typeof body['signin_url'] === 'string' ? body['signin_url'] : '';
    return { signedIn: false, user: '', ...(url && isOllamaSigninUrl(url) ? { signinUrl: url } : {}) };
  }
  if (res.status === 404 || res.status === 405) {
    return {
      signedIn: false,
      user: '',
      note: 'This Ollama version has no cloud sign-in — update Ollama (ollama.com/download) to use Turbo models.',
    };
  }
  return { signedIn: false, user: '', error: `Ollama returned HTTP ${res.status} for the account check.` };
}
