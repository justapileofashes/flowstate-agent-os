// Pluggable speech-to-text for webinar captures. Two backends: any
// OpenAI-compatible /v1/audio/transcriptions server (speaches,
// faster-whisper-server, OpenAI itself) or a user CLI command template.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { SettingsKV } from './flowclaw-store';
import type { SecretStore } from './secret-store';

export interface Transcriber {
  transcribe(filePath: string): Promise<string>;
  test(): Promise<{ ok: boolean; error?: string }>;
}

export interface TranscriberConfig {
  mode: 'openai' | 'cli';
  url?: string;
  apiKey?: string;
  model?: string;
  command?: string;
}

type FetchLike = typeof fetch;

export class OpenAICompatTranscriber implements Transcriber {
  constructor(
    private readonly cfg: { url: string; model: string; apiKey?: string },
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async transcribe(filePath: string): Promise<string> {
    const form = new FormData();
    const bytes = readFileSync(filePath);
    form.append('file', new Blob([bytes]), basename(filePath));
    form.append('model', this.cfg.model);
    const res = await this.fetchImpl(
      `${this.cfg.url.replace(/\/$/, '')}/v1/audio/transcriptions`,
      {
        method: 'POST',
        headers: this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {},
        body: form,
      },
    );
    if (!res.ok) throw new Error(`transcription failed: HTTP ${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    return String(body['text'] ?? '');
  }

  async test(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Any HTTP response = reachable (some servers 404 /v1/models).
      await this.fetchImpl(`${this.cfg.url.replace(/\/$/, '')}/v1/models`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class CliTranscriber implements Transcriber {
  constructor(private readonly cfg: { command: string }) {}

  private run(file: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const cmd = this.cfg.command.split('{file}').join(`"${file}"`);
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, { shell: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      child.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
  }

  async transcribe(filePath: string): Promise<string> {
    const { code, stdout, stderr } = await this.run(filePath);
    if (code !== 0) throw new Error(`transcriber exited ${code}: ${stderr.slice(0, 300)}`);
    return stdout;
  }

  async test(): Promise<{ ok: boolean; error?: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'flowstate-tr-'));
    const empty = join(dir, 'empty.webm');
    writeFileSync(empty, '');
    try {
      const { code, stderr } = await this.run(empty);
      return code === 0
        ? { ok: true }
        : { ok: false, error: `exit ${code}: ${stderr.slice(0, 300)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export const TRANSCRIBER_KEY = 'capture_transcriber';

export class TranscriberStore {
  constructor(
    private readonly settings: SettingsKV,
    private readonly secrets: SecretStore,
  ) {}

  save(cfg: TranscriberConfig): void {
    this.settings.set(
      TRANSCRIBER_KEY,
      JSON.stringify({
        mode: cfg.mode,
        ...(cfg.url ? { url: cfg.url } : {}),
        ...(cfg.model ? { model: cfg.model } : {}),
        ...(cfg.command ? { command: cfg.command } : {}),
        ...(cfg.apiKey ? { apiKey: this.secrets.encryptValue(cfg.apiKey) } : {}),
      }),
    );
  }

  load(): TranscriberConfig | null {
    const raw = this.settings.get(TRANSCRIBER_KEY);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      const mode = p['mode'];
      if (mode !== 'openai' && mode !== 'cli') return null;
      return {
        mode,
        ...(typeof p['url'] === 'string' ? { url: p['url'] } : {}),
        ...(typeof p['model'] === 'string' ? { model: p['model'] } : {}),
        ...(typeof p['command'] === 'string' ? { command: p['command'] } : {}),
        ...(typeof p['apiKey'] === 'string'
          ? { apiKey: this.secrets.decryptValue(p['apiKey']) }
          : {}),
      };
    } catch {
      return null;
    }
  }
}

export function buildTranscriber(
  store: TranscriberStore,
  fetchImpl?: FetchLike,
): Transcriber | null {
  const cfg = store.load();
  if (!cfg) return null;
  if (cfg.mode === 'openai' && cfg.url && cfg.model) {
    return new OpenAICompatTranscriber(
      { url: cfg.url, model: cfg.model, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) },
      fetchImpl ?? fetch,
    );
  }
  if (cfg.mode === 'cli' && cfg.command) return new CliTranscriber({ command: cfg.command });
  return null;
}
