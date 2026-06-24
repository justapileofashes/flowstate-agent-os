import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZoomService } from '@main/services/zoom-service';

// ── Fake Zoom: /oauth/token (Basic auth), /v2 API (Bearer auth) ─────────────
let server: Server;
let base: string;
let tokenRequests = 0;
let lastPatchBody: unknown = null;
let recordingsResponse: { status: number; body: unknown } = { status: 404, body: {} };

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', base);
  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    tokenRequests++;
    const auth = req.headers.authorization ?? '';
    const expected = 'Basic ' + Buffer.from('cid:csecret').toString('base64');
    if (auth !== expected) return send(401, { error: 'bad basic auth' });
    if (url.searchParams.get('grant_type') !== 'account_credentials') {
      return send(400, { error: 'bad grant' });
    }
    if (url.searchParams.get('account_id') !== 'acc1') return send(400, { error: 'bad account' });
    return send(200, { access_token: 'tok-zoom', expires_in: 3600 });
  }

  // All /v2 routes require the bearer token.
  if ((req.headers.authorization ?? '') !== 'Bearer tok-zoom') return send(401, { error: 'no bearer' });

  if (url.pathname === '/v2/meetings/123' && req.method === 'PATCH') {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      lastPatchBody = JSON.parse(raw);
      res.writeHead(204).end();
    });
    return;
  }
  if (url.pathname === '/v2/users/me/meetings' && req.method === 'POST') {
    return send(201, { id: 9876543210, join_url: 'https://zoom.us/j/9876543210' });
  }
  if (url.pathname === '/v2/meetings/123/recordings' && req.method === 'GET') {
    return send(recordingsResponse.status, recordingsResponse.body);
  }
  if (url.pathname === '/files/video.mp4' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'video/mp4' });
    res.end(Buffer.from('FAKE-MP4-BYTES'));
    return;
  }
  if (url.pathname === '/files/transcript.vtt' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/vtt' });
    res.end('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello world');
    return;
  }
  send(404, { error: 'not found' });
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no addr');
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

const CREDS = { accountId: 'acc1', clientId: 'cid', clientSecret: 'csecret' };

function makeService(now?: () => number): ZoomService {
  return new ZoomService(() => CREDS, {
    oauthBase: base,
    apiBase: `${base}/v2`,
    ...(now ? { now } : {}),
  });
}

describe('ZoomService auth', () => {
  it('fetches a token with Basic auth + account_credentials grant, then caches it', async () => {
    tokenRequests = 0;
    const svc = makeService();
    expect((await svc.testAuth()).ok).toBe(true);
    await svc.ensureCloudRecording('123'); // second call must reuse the cached token
    expect(tokenRequests).toBe(1);
  });

  it('refreshes the token after expiry', async () => {
    tokenRequests = 0;
    let t = 1_000_000;
    const svc = makeService(() => t);
    await svc.ensureCloudRecording('123');
    t += 3601 * 1000; // past expires_in
    await svc.ensureCloudRecording('123');
    expect(tokenRequests).toBe(2);
  });

  it('reports auth failure when creds are wrong', async () => {
    const bad = new ZoomService(() => ({ ...CREDS, clientSecret: 'nope' }), {
      oauthBase: base,
      apiBase: `${base}/v2`,
    });
    const res = await bad.testAuth();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/401/);
  });

  it('throws a clear error when no creds are configured', async () => {
    const svc = new ZoomService(() => null, { oauthBase: base, apiBase: `${base}/v2` });
    const res = await svc.testAuth();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not configured/i);
  });
});

describe('ZoomService meetings + recordings', () => {
  it('PATCHes auto_recording=cloud onto an existing meeting', async () => {
    await makeService().ensureCloudRecording('123');
    expect(lastPatchBody).toEqual({ settings: { auto_recording: 'cloud' } });
  });

  it('creates an instant meeting with cloud auto-recording', async () => {
    const m = await makeService().createMeeting('Standup');
    expect(m.id).toBe('9876543210');
    expect(m.joinUrl).toContain('zoom.us/j/');
  });

  it('treats recordings 404 as not-ready (meeting not ended/processed)', async () => {
    recordingsResponse = { status: 404, body: { code: 3301 } };
    const rec = await makeService().getRecordings('123');
    expect(rec.ready).toBe(false);
    expect(rec.files).toEqual([]);
  });

  it('maps the recordings payload to typed files + share url', async () => {
    recordingsResponse = {
      status: 200,
      body: {
        share_url: 'https://zoom.us/rec/share/abc',
        recording_files: [
          { file_type: 'MP4', download_url: `${base}/files/video.mp4` },
          { file_type: 'TRANSCRIPT', download_url: `${base}/files/transcript.vtt` },
          { file_type: '', download_url: '' }, // junk dropped
        ],
      },
    };
    const rec = await makeService().getRecordings('123');
    expect(rec.ready).toBe(true);
    expect(rec.shareUrl).toBe('https://zoom.us/rec/share/abc');
    expect(rec.files).toEqual([
      { fileType: 'MP4', downloadUrl: `${base}/files/video.mp4` },
      { fileType: 'TRANSCRIPT', downloadUrl: `${base}/files/transcript.vtt` },
    ]);
  });
});

describe('ZoomService downloads', () => {
  it('streams a binary file to disk with bearer auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zoom-test-'));
    const dest = join(dir, 'nested', 'video.mp4');
    await makeService().download(`${base}/files/video.mp4`, dest);
    expect(readFileSync(dest).toString()).toBe('FAKE-MP4-BYTES');
    rmSync(dir, { recursive: true, force: true });
  });

  it('downloads a transcript as text', async () => {
    const text = await makeService().downloadText(`${base}/files/transcript.vtt`);
    expect(text).toContain('WEBVTT');
    expect(text).toContain('hello world');
  });
});
