import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ZoomRecorder,
  buildSummaryPrompt,
  finalMessage,
  type ZoomServiceLike,
  type ZoomJob,
} from '@main/services/zoom-recorder';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zoom-rec-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface FakeZoomOpts {
  ready?: boolean;
  withTranscript?: boolean;
  failDownloads?: boolean;
  failArm?: boolean;
}

function fakeZoom(opts: FakeZoomOpts = {}): ZoomServiceLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async ensureCloudRecording(meetingId) {
      calls.push(`arm:${meetingId}`);
      if (opts.failArm) throw new Error('HTTP 401');
    },
    async createMeeting(topic) {
      calls.push(`create:${topic}`);
      return { id: 'm-new', joinUrl: 'https://zoom.us/j/m-new' };
    },
    async getRecordings(meetingId) {
      calls.push(`recordings:${meetingId}`);
      if (!opts.ready) return { ready: false, files: [] };
      return {
        ready: true,
        shareUrl: 'https://zoom.us/rec/share/xyz',
        files: [
          { fileType: 'MP4', downloadUrl: 'https://dl/video.mp4' },
          { fileType: 'M4A', downloadUrl: 'https://dl/audio.m4a' },
          ...(opts.withTranscript
            ? [{ fileType: 'TRANSCRIPT', downloadUrl: 'https://dl/t.vtt' }]
            : []),
        ],
      };
    },
    async download(url, dest) {
      calls.push(`download:${url}->${dest}`);
      if (opts.failDownloads) throw new Error('download boom');
    },
    async downloadText(url) {
      calls.push(`text:${url}`);
      if (opts.failDownloads) throw new Error('text boom');
      return 'WEBVTT\n\nalice: ship it\nbob: agreed';
    },
  };
}

function fakeDispatcher(result = 'SUMMARY: shipped it'): {
  runToText(id: string, prompt: string, opts?: { model?: string }): Promise<string>;
  seen: Array<{ id: string; prompt: string; model?: string }>;
} {
  const seen: Array<{ id: string; prompt: string; model?: string }> = [];
  return {
    seen,
    async runToText(id, prompt, opts) {
      seen.push({ id, prompt, ...(opts?.model ? { model: opts.model } : {}) });
      if (result === 'THROW') throw new Error('gateway down');
      return result;
    },
  };
}

function fakeChats(): {
  createChat(agentId: string, title?: string): { id: string };
  appendMessage(chatId: string, msg: { role: 'user' | 'assistant'; content: string }): unknown;
  chats: Array<{ id: string; agentId: string; title?: string }>;
  messages: Array<{ chatId: string; role: string; content: string }>;
} {
  const chats: Array<{ id: string; agentId: string; title?: string }> = [];
  const messages: Array<{ chatId: string; role: string; content: string }> = [];
  return {
    chats,
    messages,
    createChat(agentId, title) {
      const id = `chat-${chats.length + 1}`;
      chats.push({ id, agentId, ...(title !== undefined ? { title } : {}) });
      return { id };
    },
    appendMessage(chatId, msg) {
      messages.push({ chatId, ...msg });
      return {};
    },
  };
}

function makeRecorder(
  zoom: ZoomServiceLike,
  dispatcher: ReturnType<typeof fakeDispatcher>,
  chats = fakeChats(),
): { recorder: ZoomRecorder; chats: ReturnType<typeof fakeChats> } {
  const recorder = new ZoomRecorder({
    zoom,
    dispatcher,
    chats,
    jobsPath: join(dir, 'zoom-jobs.json'),
    recordingsDir: join(dir, 'recordings'),
  });
  return { recorder, chats };
}

describe('ZoomRecorder.record', () => {
  it('arms an existing meeting for cloud recording -> waiting', async () => {
    const zoom = fakeZoom();
    const { recorder } = makeRecorder(zoom, fakeDispatcher());
    const job = await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    expect(zoom.calls).toContain('arm:123');
    expect(job.status).toBe('waiting');
  });

  it('creates a fresh recorded meeting when only a topic is given', async () => {
    const zoom = fakeZoom();
    const { recorder } = makeRecorder(zoom, fakeDispatcher());
    const job = await recorder.record({ topic: 'Standup', agentId: 'a1', connectionId: 'h1' });
    expect(job.meetingId).toBe('m-new');
    expect(job.joinUrl).toBe('https://zoom.us/j/m-new');
    expect(job.status).toBe('waiting');
  });

  it('lands in error when arming fails', async () => {
    const { recorder } = makeRecorder(fakeZoom({ failArm: true }), fakeDispatcher());
    const job = await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/401/);
  });

  it('persists jobs across recorder instances', async () => {
    const { recorder } = makeRecorder(fakeZoom(), fakeDispatcher());
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    const again = new ZoomRecorder({
      zoom: fakeZoom(),
      dispatcher: fakeDispatcher(),
      chats: fakeChats(),
      jobsPath: join(dir, 'zoom-jobs.json'),
      recordingsDir: join(dir, 'recordings'),
    });
    expect(again.list()).toHaveLength(1);
    expect(again.list()[0]?.meetingId).toBe('123');
  });
});

describe('ZoomRecorder.tick', () => {
  it('keeps waiting while the recording is not ready', async () => {
    const { recorder } = makeRecorder(fakeZoom({ ready: false }), fakeDispatcher());
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    expect(recorder.list()[0]?.status).toBe('waiting');
  });

  it('full pipeline: download recording + transcript, summarize via dispatcher, chat persisted', async () => {
    const zoom = fakeZoom({ ready: true, withTranscript: true });
    const dispatcher = fakeDispatcher();
    const { recorder, chats } = makeRecorder(zoom, dispatcher);
    await recorder.record({
      meetingId: '123',
      topic: 'Sprint review',
      agentId: 'a1',
      connectionId: 'h1',
      model: 'qwen2.5',
    });
    await recorder.tick();

    const job = recorder.list()[0] as ZoomJob;
    expect(job.status).toBe('done');
    // Full recording downloaded locally (MP4 + M4A + transcript file).
    expect(job.recordingFiles).toHaveLength(3);
    expect(job.shareUrl).toBe('https://zoom.us/rec/share/xyz');
    // Transcript fed to the gateway with the model override.
    expect(dispatcher.seen[0]?.id).toBe('h1');
    expect(dispatcher.seen[0]?.model).toBe('qwen2.5');
    expect(dispatcher.seen[0]?.prompt).toContain('alice: ship it');
    // Chat: prompt + final message with summary, local paths, share link.
    expect(job.chatId).toBe('chat-1');
    expect(chats.chats[0]?.agentId).toBe('a1');
    expect(chats.messages).toHaveLength(2);
    expect(chats.messages[1]?.content).toContain('SUMMARY: shipped it');
    expect(chats.messages[1]?.content).toContain('recording.mp4');
    expect(chats.messages[1]?.content).toContain('https://zoom.us/rec/share/xyz');
  });

  it('falls back to a metadata-only prompt when there is no transcript', async () => {
    const dispatcher = fakeDispatcher();
    const { recorder } = makeRecorder(fakeZoom({ ready: true, withTranscript: false }), dispatcher);
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    expect(recorder.list()[0]?.status).toBe('done');
    expect(dispatcher.seen[0]?.prompt).toMatch(/no transcript was available/i);
  });

  it('download failures are non-fatal: summary still runs, chat notes cloud-only', async () => {
    const { recorder, chats } = makeRecorder(
      fakeZoom({ ready: true, withTranscript: true, failDownloads: true }),
      fakeDispatcher(),
    );
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    const job = recorder.list()[0] as ZoomJob;
    expect(job.status).toBe('done');
    expect(job.recordingFiles).toBeUndefined();
    expect(chats.messages[1]?.content).toMatch(/local download unavailable/i);
  });

  it('gateway failure lands the job in error with a message', async () => {
    const { recorder } = makeRecorder(
      fakeZoom({ ready: true, withTranscript: true }),
      fakeDispatcher('THROW'),
    );
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    const job = recorder.list()[0] as ZoomJob;
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/gateway down/);
  });

  it('writes the transcript text to a local .vtt file', async () => {
    const { recorder } = makeRecorder(
      fakeZoom({ ready: true, withTranscript: true }),
      fakeDispatcher(),
    );
    await recorder.record({ meetingId: '123', agentId: 'a1', connectionId: 'h1' });
    await recorder.tick();
    const vtt = join(dir, 'recordings', '123', 'transcript.vtt');
    expect(existsSync(vtt)).toBe(true);
    expect(readFileSync(vtt, 'utf8')).toContain('alice: ship it');
  });
});

describe('prompt + final message builders', () => {
  const job = {
    id: 'j1',
    meetingId: '123',
    topic: 'Demo',
    agentId: 'a1',
    connectionId: 'h1',
    status: 'summarizing',
    createdAt: 0,
    updatedAt: 0,
  } as ZoomJob;

  it('transcript prompt asks for notes, decisions, action items', () => {
    const p = buildSummaryPrompt(job, 'WEBVTT\nhello');
    expect(p).toContain('Demo');
    expect(p).toMatch(/action items/i);
    expect(p).toContain('WEBVTT');
  });

  it('final message includes local paths and the share link', () => {
    const msg = finalMessage(
      { ...job, recordingFiles: ['C:\\rec\\video.mp4'], shareUrl: 'https://zoom.us/rec/s' },
      'the summary',
    );
    expect(msg).toContain('the summary');
    expect(msg).toContain('C:\\rec\\video.mp4');
    expect(msg).toContain('https://zoom.us/rec/s');
  });
});
