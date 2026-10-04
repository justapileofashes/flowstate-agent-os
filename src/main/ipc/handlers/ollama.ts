import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ipcMain, shell } from 'electron';
import { broadcast } from '@main/util/broadcast';
import { extractSigninUrl, getCloudStatus } from '@main/services/ollama-cloud';
import { fetchOllamaLibrary, type LibraryModel } from '@main/services/ollama-library';
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

    const send = broadcast;

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
    // back to `ollama serve` headless (install dir, then PATH).
    const home = process.env['LOCALAPPDATA'] ?? '';
    const trayCandidates = [
      home ? join(home, 'Programs', 'Ollama', 'ollama app.exe') : '',
      home ? join(home, 'Programs', 'Ollama', 'Ollama.exe') : '',
      'C:\\Program Files\\Ollama\\ollama app.exe',
      'C:\\Program Files\\Ollama\\Ollama.exe',
    ].filter((p) => p.length > 0);
    for (const p of trayCandidates) {
      if (existsSync(p) && (await spawnDetached(p, [])) === null) {
        return { ok: true, mode: 'tray' as const };
      }
    }
    const cliCandidates = [
      home ? join(home, 'Programs', 'Ollama', 'ollama.exe') : '',
      'C:\\Program Files\\Ollama\\ollama.exe',
    ].filter((p) => p.length > 0 && existsSync(p));
    let lastError = '';
    for (const bin of [...cliCandidates, 'ollama']) {
      const error = await spawnDetached(bin, ['serve']);
      if (error === null) return { ok: true, mode: 'serve' as const };
      lastError = error;
    }
    return {
      ok: false,
      mode: 'serve' as const,
      error: /ENOENT/.test(lastError)
        ? 'Ollama is not installed (or not on PATH). Install it from https://ollama.com/download, then try again.'
        : `Could not start Ollama: ${lastError}`,
    };
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
  // Signing in links this machine's Ollama key to an ollama.com account;
  // after that the local daemon routes cloud-only models (gpt-oss:120b, …)
  // through Turbo, so no extra API plumbing is needed here.
  ipcMain.handle(CHANNELS.OLLAMA_CLOUD_STATUS, () => getCloudStatus(client.host));

  ipcMain.handle(CHANNELS.OLLAMA_CLOUD_SIGNIN, async () => {
    const status = await getCloudStatus(client.host);
    if (status.signedIn) return { ok: true, output: '', alreadySignedIn: true };
    // Newer servers hand out the connect URL directly.
    if (status.signinUrl) {
      await shell.openExternal(status.signinUrl);
      return { ok: true, output: 'Finish signing in in your browser.', url: status.signinUrl };
    }
    // Otherwise `ollama signin` prints it. It may keep running until the
    // browser step completes, so answer as soon as the URL shows up.
    return new Promise<{ ok: boolean; output: string; error?: string; url?: string }>((resolve) => {
      let out = '';
      let done = false;
      const finish = (r: { ok: boolean; output: string; error?: string; url?: string }): void => {
        if (done) return;
        done = true;
        resolve(r);
      };
      const bins = [
        process.env['LOCALAPPDATA'] ? join(process.env['LOCALAPPDATA'], 'Programs', 'Ollama', 'ollama.exe') : '',
      ].filter((p) => p && existsSync(p));
      const proc = spawn(bins[0] ?? 'ollama', ['signin'], { windowsHide: true, shell: false });
      const killer = setTimeout(() => proc.kill(), 5 * 60_000);
      const onData = (b: Buffer): void => {
        out += b.toString();
        const url = extractSigninUrl(out);
        if (url) {
          void shell.openExternal(url);
          finish({ ok: true, output: 'Finish signing in in your browser.', url });
        }
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('error', (err) => {
        clearTimeout(killer);
        finish({
          ok: false,
          output: out,
          error: /ENOENT/.test(err.message)
            ? 'Ollama is not installed (or not on PATH) — install it from ollama.com/download.'
            : err.message,
        });
      });
      proc.on('close', (code) => {
        clearTimeout(killer);
        const text = out.trim();
        if (code === 0) finish({ ok: true, output: text || 'Sign-in finished.' });
        else finish({ ok: false, output: text, error: text || `ollama signin exited with code ${code}` });
      });
    });
  });

  ipcMain.handle(CHANNELS.OLLAMA_CLOUD_SIGNOUT, async () => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      try {
        const proc = spawn('ollama', ['signout'], { windowsHide: true, shell: false });
        let stderr = '';
        proc.stderr?.on('data', (b) => { stderr += b.toString(); });
        proc.on('error', (err) =>
          resolve({
            ok: false,
            error: /ENOENT/.test(err.message)
              ? 'Ollama is not installed (or not on PATH).'
              : err.message,
          }),
        );
        proc.on('close', (code) =>
          code === 0
            ? resolve({ ok: true })
            : resolve({ ok: false, error: stderr.trim() || `ollama signout exited with code ${code}` }),
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

/**
 * Launch a detached background process. Resolves `null` once the OS has
 * started it, or the error message if it couldn't (e.g. ENOENT). Spawn
 * failures are reported asynchronously via 'error', so a bare try/catch never
 * sees them — and an unhandled 'error' crashes the main process.
 */
function spawnDetached(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      child.once('error', (err) => resolve(err.message));
      child.once('spawn', () => {
        child.unref();
        resolve(null);
      });
    } catch (err) {
      resolve(err instanceof Error ? err.message : String(err));
    }
  });
}

