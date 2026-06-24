import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SecretStore, type SecretBackend } from '@main/services/secret-store';
import {
  OpenAICompatTranscriber,
  CliTranscriber,
  TranscriberStore,
  TRANSCRIBER_KEY,
  buildTranscriber,
} from '@main/services/transcriber';

/** Reversible fake "encryption" so tests can assert ciphertext at rest. */
function fakeBackend(): SecretBackend {
  return {
    isAvailable: () => true,
    encrypt: (plain) => Buffer.from([...plain].reverse().join('')),
    decrypt: (buf) => [...buf.toString()].reverse().join(''),
  };
}

function fakeKV(): {
  get(k: string): string | null;
  set(k: string, v: string): void;
  raw: Map<string, string>;
} {
  const raw = new Map<string, string>();
  return { get: (k) => raw.get(k) ?? null, set: (k, v) => void raw.set(k, v), raw };
}

describe('OpenAICompatTranscriber', () => {
  it('POSTs multipart with file bytes + model and returns text', async () => {
    let gotAuth = '';
    let gotBody = Buffer.alloc(0);
    const srv = createServer((req, res) => {
      gotAuth = String(req.headers['authorization'] ?? '');
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        gotBody = Buffer.concat(chunks);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ text: 'hello transcript' }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;

    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    const audio = join(dir, 'audio.webm');
    writeFileSync(audio, Buffer.from('FAKEWEBMBYTES'));

    const t = new OpenAICompatTranscriber({
      url: `http://127.0.0.1:${port}`,
      model: 'whisper-1',
      apiKey: 'sk-test',
    });
    const text = await t.transcribe(audio);
    expect(text).toBe('hello transcript');
    expect(gotAuth).toBe('Bearer sk-test');
    const body = gotBody.toString('latin1');
    expect(body).toContain('FAKEWEBMBYTES');
    expect(body).toContain('whisper-1');
    srv.close();
  });

  it('test() is ok on any HTTP response, fails only on network error', async () => {
    const srv = createServer((_req, res) => {
      res.statusCode = 404;
      res.end('no');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as { port: number }).port;
    const t = new OpenAICompatTranscriber({ url: `http://127.0.0.1:${port}`, model: 'm' });
    expect((await t.test()).ok).toBe(true);
    srv.close();
    const dead = new OpenAICompatTranscriber({ url: 'http://127.0.0.1:1', model: 'm' });
    const res = await dead.test();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe('CliTranscriber', () => {
  it('runs the command template and captures stdout', async () => {
    const t = new CliTranscriber({ command: `node -e "console.log('hi from cli')" {file}` });
    const dir = mkdtempSync(join(tmpdir(), 'tr-'));
    const audio = join(dir, 'a.webm');
    writeFileSync(audio, 'x');
    expect((await t.transcribe(audio)).trim()).toBe('hi from cli');
  });

  it('test() reports exit-code success/failure', async () => {
    const ok = new CliTranscriber({ command: `node -e "process.exit(0)" {file}` });
    expect((await ok.test()).ok).toBe(true);
    const bad = new CliTranscriber({ command: `node -e "process.exit(3)" {file}` });
    expect((await bad.test()).ok).toBe(false);
  });
});

describe('TranscriberStore + buildTranscriber', () => {
  it('round-trips config with apiKey encrypted at rest', () => {
    const kv = fakeKV();
    const store = new TranscriberStore(kv, new SecretStore(fakeBackend()));
    store.save({ mode: 'openai', url: 'http://x', model: 'm', apiKey: 'secret' });

    const persisted = kv.raw.get(TRANSCRIBER_KEY) ?? '';
    expect(persisted).toContain('enc:v1:');
    expect(persisted).not.toContain('secret');

    const loaded = store.load();
    expect(loaded?.mode).toBe('openai');
    expect(loaded?.url).toBe('http://x');
    expect(loaded?.model).toBe('m');
    expect(loaded?.apiKey).toBe('secret');
  });

  it('round-trips cli config without apiKey and tolerates junk', () => {
    const kv = fakeKV();
    const store = new TranscriberStore(kv, new SecretStore(fakeBackend()));
    expect(store.load()).toBeNull();
    kv.set(TRANSCRIBER_KEY, 'not json');
    expect(store.load()).toBeNull();
    store.save({ mode: 'cli', command: 'whisper {file}' });
    expect(store.load()).toEqual({ mode: 'cli', command: 'whisper {file}' });
  });

  it('buildTranscriber returns null when unconfigured', () => {
    const kv = fakeKV();
    const store = new TranscriberStore(kv, new SecretStore(fakeBackend()));
    expect(buildTranscriber(store)).toBeNull();
  });

  it('buildTranscriber returns the right implementation per mode', () => {
    const kv = fakeKV();
    const store = new TranscriberStore(kv, new SecretStore(fakeBackend()));
    store.save({ mode: 'openai', url: 'http://x', model: 'm' });
    expect(buildTranscriber(store)).toBeInstanceOf(OpenAICompatTranscriber);
    store.save({ mode: 'cli', command: 'whisper {file}' });
    expect(buildTranscriber(store)).toBeInstanceOf(CliTranscriber);
    store.save({ mode: 'openai' }); // missing url/model → not buildable
    expect(buildTranscriber(store)).toBeNull();
  });
});
