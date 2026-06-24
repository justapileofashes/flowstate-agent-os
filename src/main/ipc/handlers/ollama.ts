import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import {
  CHANNELS,
  ollamaPullEndChannel,
  ollamaPullProgressChannel,
  schemas,
} from '@shared/ipc-channels';
import type { OllamaClient } from '@main/services/ollama-client';
import type { LLMProvider } from '@main/agent/llm-provider';

export function registerOllamaHandlers(client: OllamaClient, provider: LLMProvider): void {
  ipcMain.handle(CHANNELS.OLLAMA_HEALTH, () => client.health());

  const activePulls = new Map<string, AbortController>();

  ipcMain.handle(CHANNELS.OLLAMA_PULL, async (_e, raw) => {
    const { model } = schemas.ollamaPullRequest.parse(raw);
    const pullId = randomUUID();
    const controller = new AbortController();
    activePulls.set(pullId, controller);

    const send = (channel: string, payload: unknown): void => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send(channel, payload);
    };

    void (async () => {
      try {
        for await (const progress of provider.pullModel(model, controller.signal)) {
          send(ollamaPullProgressChannel(pullId), progress);
        }
        send(ollamaPullEndChannel(pullId), { ok: true });
      } catch (err) {
        send(ollamaPullEndChannel(pullId), {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        activePulls.delete(pullId);
      }
    })();

    return { pullId };
  });

  ipcMain.handle(CHANNELS.OLLAMA_START, async () => {
    // Try Windows tray app first (better UX — keeps Ollama in tray), fall
    // back to `ollama serve` headless via PATH.
    const home = process.env['LOCALAPPDATA'] ?? '';
    const trayCandidates = [
      home ? join(home, 'Programs', 'Ollama', 'ollama app.exe') : '',
      home ? join(home, 'Programs', 'Ollama', 'Ollama.exe') : '',
      'C:\\Program Files\\Ollama\\ollama app.exe',
      'C:\\Program Files\\Ollama\\Ollama.exe',
    ].filter((p) => p.length > 0);
    for (const p of trayCandidates) {
      if (existsSync(p)) {
        try {
          const child = spawn(p, [], { detached: true, stdio: 'ignore', windowsHide: true });
          child.unref();
          return { ok: true, mode: 'tray' as const };
        } catch {
          // fall through to serve attempt
        }
      }
    }
    try {
      const child = spawn('ollama', ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      child.unref();
      return { ok: true, mode: 'serve' as const };
    } catch (err) {
      return {
        ok: false,
        mode: 'serve' as const,
        error:
          err instanceof Error
            ? `Could not start Ollama: ${err.message}. Install Ollama from https://ollama.com or ensure it is on PATH.`
            : 'Could not start Ollama.',
      };
    }
  });

  ipcMain.handle(CHANNELS.OLLAMA_PULL_CANCEL, (_e, raw) => {
    const { pullId } = schemas.ollamaPullCancelRequest.parse(raw);
    const ctrl = activePulls.get(pullId);
    if (!ctrl) return { ok: false };
    ctrl.abort();
    activePulls.delete(pullId);
    return { ok: true };
  });

  // ── Ollama cloud (Turbo) auth ─────────────────────────────────────────
  // `ollama signin` opens the browser auth flow + stores credentials in
  // ~/.ollama/. After signin, the local Ollama daemon transparently routes
  // selected cloud-only models (gpt-oss:120b, llama3.3:70b-cloud, etc.)
  // through Ollama Turbo, so no additional API plumbing is needed.
  ipcMain.handle(CHANNELS.OLLAMA_CLOUD_SIGNIN, async () => {
    return new Promise<{ ok: boolean; output: string; error?: string }>((resolve) => {
      try {
        const proc = spawn('ollama', ['signin'], {
          windowsHide: true,
          shell: false,
        });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (b) => { stdout += b.toString(); });
        proc.stderr?.on('data', (b) => { stderr += b.toString(); });
        proc.on('error', (err) => {
          resolve({
            ok: false,
            output: stdout,
            error:
              'Could not run `ollama signin`. Make sure Ollama 0.5+ is installed and on PATH. ' +
              err.message,
          });
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve({ ok: true, output: stdout || stderr });
          } else {
            resolve({
              ok: false,
              output: stdout,
              error: stderr || `ollama signin exited with code ${code}`,
            });
          }
        });
      } catch (err) {
        resolve({
          ok: false,
          output: '',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  });

  ipcMain.handle(CHANNELS.OLLAMA_CLOUD_STATUS, async () => {
    return new Promise<{ signedIn: boolean; user: string; error?: string }>((resolve) => {
      try {
        const proc = spawn('ollama', ['whoami'], { windowsHide: true, shell: false });
        let stdout = '';
        let stderr = '';
        proc.stdout?.on('data', (b) => { stdout += b.toString(); });
        proc.stderr?.on('data', (b) => { stderr += b.toString(); });
        proc.on('error', () => resolve({ signedIn: false, user: '' }));
        proc.on('close', (code) => {
          if (code !== 0) {
            // `whoami` exits non-zero when not signed in.
            resolve({ signedIn: false, user: '', error: stderr.trim() || undefined });
            return;
          }
          const user = stdout.trim().split('\n').pop() ?? '';
          resolve({ signedIn: user.length > 0, user });
        });
      } catch (err) {
        resolve({ signedIn: false, user: '', error: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  ipcMain.handle(CHANNELS.OLLAMA_CLOUD_SIGNOUT, async () => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      try {
        const proc = spawn('ollama', ['signout'], { windowsHide: true, shell: false });
        let stderr = '';
        proc.stderr?.on('data', (b) => { stderr += b.toString(); });
        proc.on('error', (err) => resolve({ ok: false, error: err.message }));
        proc.on('close', (code) =>
          code === 0
            ? resolve({ ok: true })
            : resolve({ ok: false, error: stderr || `exit ${code}` }),
        );
      } catch (err) {
        resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  });

  // Browse the full Ollama public library. Scrapes ollama.com/library
  // (server-rendered HTML) and caches for 10 minutes to avoid hammering.
  let libCache: { fetchedAt: number; models: LibraryModel[] } | null = null;
  const LIB_TTL_MS = 10 * 60_000;

  ipcMain.handle(CHANNELS.OLLAMA_LIBRARY_SEARCH, async (_e, raw) => {
    const { q, limit } = schemas.ollamaLibrarySearchRequest.parse(raw);
    try {
      const now = Date.now();
      if (!libCache || now - libCache.fetchedAt > LIB_TTL_MS) {
        libCache = { fetchedAt: now, models: await fetchOllamaLibrary() };
      }
      const needle = q.trim().toLowerCase();
      const filtered = needle.length === 0
        ? libCache.models
        : libCache.models.filter(
            (m) =>
              m.name.toLowerCase().includes(needle) ||
              m.description.toLowerCase().includes(needle) ||
              m.capabilities.some((c) => c.toLowerCase().includes(needle)),
          );
      return {
        models: filtered.slice(0, limit),
        fetchedAt: libCache.fetchedAt,
      };
    } catch (err) {
      return {
        models: [],
        fetchedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

interface LibraryModel {
  name: string;
  description: string;
  pullCount: string;
  tagCount: number;
  sizes: string[];
  capabilities: string[];
  updatedAt: string;
}

/** Scrape https://ollama.com/library (server-rendered HTML) and parse out
 *  one entry per <li> block on the listing. Resilient to small markup
 *  changes — falls back to the model anchor href if structured fields are
 *  missing. Updated as of 2026-05. */
async function fetchOllamaLibrary(): Promise<LibraryModel[]> {
  const res = await fetch('https://ollama.com/library?sort=popular', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`Ollama library returned ${res.status}`);
  const html = await res.text();
  const blocks = html.split(/<li[\s>]/i).slice(1);
  const out: LibraryModel[] = [];
  const seen = new Set<string>();
  for (const blk of blocks) {
    // Each <li> contains the model's listing card. Extract by href first.
    const hrefMatch = blk.match(/href="\/library\/([^"/]+)"/);
    if (!hrefMatch) continue;
    const name = hrefMatch[1]!.toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);

    const descMatch = blk.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const description = descMatch ? stripHtmlInline(descMatch[1]!).slice(0, 220) : '';

    // Capability badges (tools, vision, embedding, ...).
    const capabilities = [...blk.matchAll(/x-test-capability[^>]*>([^<]+)</g)].map((m) =>
      m[1]!.trim().toLowerCase(),
    );

    // Size variants like 7b, 13b, 70b, 405b.
    const sizes = [...blk.matchAll(/x-test-size[^>]*>([^<]+)</g)].map((m) => m[1]!.trim());

    const pulls = blk.match(/x-test-pull-count[^>]*>([^<]+)</);
    const tagCountMatch = blk.match(/x-test-tag-count[^>]*>([^<]+)</);
    const updated = blk.match(/x-test-updated[^>]*>([^<]+)</);

    out.push({
      name,
      description,
      pullCount: pulls ? pulls[1]!.trim() : '',
      tagCount: tagCountMatch ? Number(tagCountMatch[1]!.replace(/[^0-9]/g, '')) || 0 : 0,
      sizes,
      capabilities,
      updatedAt: updated ? updated[1]!.trim() : '',
    });
  }
  // Older HTML structure fallback: scrape model names directly.
  if (out.length === 0) {
    const anchorRe = /href="\/library\/([a-z0-9._-]+)"/gi;
    let m: RegExpExecArray | null;
    while ((m = anchorRe.exec(html)) !== null) {
      const name = m[1]!.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        description: '',
        pullCount: '',
        tagCount: 0,
        sizes: [],
        capabilities: [],
        updatedAt: '',
      });
    }
  }
  return out;
}

function stripHtmlInline(s: string): string {
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
