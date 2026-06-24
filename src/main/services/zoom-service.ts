// Zoom REST client for the meeting-recorder pipeline (spec:
// docs/superpowers/specs/2026-06-10-zoom-meeting-recorder-design.md).
//
// Auth is Server-to-Server OAuth: POST /oauth/token with HTTP Basic
// clientId:clientSecret and grant_type=account_credentials. The access token
// (1h) is cached and refreshed 5 minutes early. Credentials are injected via
// a getter (same pattern as OpenClawClient.getToken) so the store can rotate
// them without rebuilding the service. fetch + base URLs are injectable so the
// whole client is testable against a local node:http fake.

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ZoomCreds {
  accountId: string;
  clientId: string;
  clientSecret: string;
}

export interface ZoomServiceOpts {
  /** Injectable fetch for testing. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** OAuth host, default https://zoom.us */
  oauthBase?: string;
  /** API base, default https://api.zoom.us/v2 */
  apiBase?: string;
  /** Clock, injectable for token-expiry tests. */
  now?: () => number;
}

export interface ZoomRecordingFile {
  fileType: string; // 'MP4' | 'M4A' | 'TRANSCRIPT' | ...
  downloadUrl: string;
}

export interface ZoomRecordings {
  ready: boolean;
  shareUrl?: string;
  files: ZoomRecordingFile[];
}

export interface CreatedMeeting {
  id: string;
  joinUrl: string;
}

export class ZoomService {
  private readonly fetchImpl: typeof fetch;
  private readonly oauthBase: string;
  private readonly apiBase: string;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly getCreds: () => ZoomCreds | null,
    opts: ZoomServiceOpts = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.oauthBase = opts.oauthBase ?? 'https://zoom.us';
    this.apiBase = opts.apiBase ?? 'https://api.zoom.us/v2';
    this.now = opts.now ?? Date.now;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.value;
    const creds = this.getCreds();
    if (!creds) throw new Error('Zoom credentials not configured');
    const url =
      `${this.oauthBase}/oauth/token?grant_type=account_credentials` +
      `&account_id=${encodeURIComponent(creds.accountId)}`;
    const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}` },
    });
    if (!res.ok) throw new Error(`Zoom token request failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    // Refresh 5 minutes before Zoom expires the token.
    this.token = {
      value: body.access_token,
      expiresAt: this.now() + Math.max(body.expires_in - 300, 60) * 1000,
    };
    return this.token.value;
  }

  /** Token-fetch ping with fresh (uncached) credentials. */
  async testAuth(): Promise<{ ok: boolean; error?: string }> {
    this.token = null;
    try {
      await this.getToken();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async api(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    return this.fetchImpl(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  /** Turn on cloud auto-recording for an existing meeting. */
  async ensureCloudRecording(meetingId: string): Promise<void> {
    const res = await this.api(`/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ settings: { auto_recording: 'cloud' } }),
    });
    if (!res.ok) throw new Error(`Failed to enable cloud recording: HTTP ${res.status}`);
  }

  /** Create an instant meeting that records to cloud from the start. */
  async createMeeting(topic: string): Promise<CreatedMeeting> {
    const res = await this.api('/users/me/meetings', {
      method: 'POST',
      body: JSON.stringify({ topic, type: 1, settings: { auto_recording: 'cloud' } }),
    });
    if (!res.ok) throw new Error(`Failed to create meeting: HTTP ${res.status}`);
    const body = (await res.json()) as { id: number | string; join_url: string };
    return { id: String(body.id), joinUrl: body.join_url };
  }

  /** Recording files for a meeting. 404 = not ended/processed yet (not an error). */
  async getRecordings(meetingId: string): Promise<ZoomRecordings> {
    const res = await this.api(`/meetings/${encodeURIComponent(meetingId)}/recordings`);
    if (res.status === 404) return { ready: false, files: [] };
    if (!res.ok) throw new Error(`Failed to fetch recordings: HTTP ${res.status}`);
    const body = (await res.json()) as {
      share_url?: string;
      recording_files?: Array<{ file_type?: string; download_url?: string }>;
    };
    const files = (body.recording_files ?? [])
      .filter((f) => !!f.file_type && !!f.download_url)
      .map((f) => ({ fileType: f.file_type as string, downloadUrl: f.download_url as string }));
    return {
      ready: files.length > 0,
      files,
      ...(body.share_url ? { shareUrl: body.share_url } : {}),
    };
  }

  /** Stream a recording file to disk (bearer-authorized). Creates parent dirs. */
  async download(url: string, destPath: string): Promise<void> {
    const token = await this.getToken();
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
    await mkdir(dirname(destPath), { recursive: true });
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destPath));
  }

  /** Download a small text file (VTT transcript) as a string. */
  async downloadText(url: string): Promise<string> {
    const token = await this.getToken();
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Transcript download failed: HTTP ${res.status}`);
    return res.text();
  }
}
