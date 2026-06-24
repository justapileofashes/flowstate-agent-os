import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureRecorder, buildCapturePrompt } from '@main/services/capture-recorder';
import type { Transcriber } from '@main/services/transcriber';

function fakeTranscriber(text: string): Transcriber {
  return { transcribe: async () => text, test: async () => ({ ok: true }) };
}

function throwingTranscriber(): Transcriber {
  return {
    transcribe: async () => {
      throw new Error('whisper exploded');
    },
    test: async () => ({ ok: false, error: 'x' }),
  };
}

function deps(
  dir: string,
  over: Partial<{
    transcriber: Transcriber | null;
    runText: string;
    runThrows: boolean;
  }> = {},
): {
  chats: Array<{ chatId: string; role: string; content: string }>;
  runs: Array<{ connectionId: string; prompt: string; model?: string }>;
  recorder: CaptureRecorder;
} {
  const chats: Array<{ chatId: string; role: string; content: string }> = [];
  const runs: Array<{ connectionId: string; prompt: string; model?: string }> = [];
  let chatN = 0;
  return {
    chats,
    runs,
    recorder: new CaptureRecorder({
      jobsPath: join(dir, 'capture-jobs.json'),
      capturesDir: join(dir, 'captures'),
      getTranscriber: () =>
        over.transcriber === undefined ? fakeTranscriber('TRANSCRIPT TEXT') : over.transcriber,
      dispatcher: {
        runToText: async (id: string, prompt: string, o?: { model?: string }) => {
          runs.push({ connectionId: id, prompt, ...(o?.model ? { model: o.model } : {}) });
          if (over.runThrows) throw new Error('gateway down');
          return over.runText ?? 'SUMMARY';
        },
      },
      chatSink: {
        createChat: (_agentId: string, _title?: string) => ({ id: `chat-${++chatN}` }),
        appendMessage: (chatId: string, m: { role: 'user' | 'assistant'; content: string }) => {
          chats.push({ chatId, role: m.role, content: m.content });
        },
      },
    }),
  };
}

const START = { title: 'Webinar X', agentId: 'a1', connectionId: 'conn1', model: 'qwen2.5:32b' };

describe('CaptureRecorder', () => {
  it('start() creates a recording job with an empty audio file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const { recorder } = deps(dir);
    const job = recorder.start(START);
    expect(job.status).toBe('recording');
    expect(job.title).toBe('Webinar X');
    expect(existsSync(job.audioPath)).toBe(true);
    expect(readFileSync(job.audioPath).byteLength).toBe(0);
    expect(job.audioPath).toContain(join('captures', job.id));
  });

  it('appendChunk() appends bytes and bumps the byte counter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const { recorder } = deps(dir);
    const job = recorder.start(START);
    recorder.appendChunk(job.id, new Uint8Array([1, 2, 3]));
    recorder.appendChunk(job.id, new Uint8Array([4, 5]));
    const after = recorder.jobs().find((j) => j.id === job.id);
    expect(after?.bytes).toBe(5);
    expect(readFileSync(job.audioPath).byteLength).toBe(5);
  });

  it('stop() runs transcribe → summarize → chat and marks done', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const d = deps(dir);
    const job = d.recorder.start(START);
    d.recorder.appendChunk(job.id, new Uint8Array([9]));
    const done = await d.recorder.stop(job.id);

    expect(done.status).toBe('done');
    expect(done.chatId).toBe('chat-1');
    // model override forwarded to the gateway
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]?.model).toBe('qwen2.5:32b');
    expect(d.runs[0]?.connectionId).toBe('conn1');
    expect(d.runs[0]?.prompt).toContain('TRANSCRIPT TEXT');
    // chat: user = prompt with transcript, assistant = summary + audio path
    expect(d.chats).toHaveLength(2);
    expect(d.chats[0]?.role).toBe('user');
    expect(d.chats[0]?.content).toContain('TRANSCRIPT TEXT');
    expect(d.chats[1]?.role).toBe('assistant');
    expect(d.chats[1]?.content).toContain('SUMMARY');
    expect(d.chats[1]?.content).toContain(done.audioPath);
  });

  it('transcriber failure is non-fatal: done with note, gateway skipped', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const d = deps(dir, { transcriber: throwingTranscriber() });
    const job = d.recorder.start(START);
    const done = await d.recorder.stop(job.id);

    expect(done.status).toBe('done');
    expect(d.runs).toHaveLength(0); // nothing to summarize
    const assistant = d.chats.find((c) => c.role === 'assistant');
    expect(assistant?.content).toContain('Transcription failed');
    expect(assistant?.content).toContain(done.audioPath);
  });

  it('unconfigured transcriber is non-fatal: done with note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const d = deps(dir, { transcriber: null });
    const job = d.recorder.start(START);
    const done = await d.recorder.stop(job.id);

    expect(done.status).toBe('done');
    expect(d.runs).toHaveLength(0);
    const assistant = d.chats.find((c) => c.role === 'assistant');
    expect(assistant?.content).toContain('Transcriber not configured');
    expect(assistant?.content).toContain(done.audioPath);
  });

  it('dispatcher failure marks the job error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const d = deps(dir, { runThrows: true });
    const job = d.recorder.start(START);
    const done = await d.recorder.stop(job.id);
    expect(done.status).toBe('error');
    expect(done.error).toContain('gateway down');
  });

  it('jobs persist across instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const d = deps(dir);
    const job = d.recorder.start(START);
    await d.recorder.stop(job.id);

    const d2 = deps(dir);
    const found = d2.recorder.jobs().find((j) => j.id === job.id);
    expect(found?.status).toBe('done');
  });

  it('marks jobs stuck in recording as interrupted on restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const d = deps(dir);
    const job = d.recorder.start(START); // left recording

    const d2 = deps(dir);
    const found = d2.recorder.jobs().find((j) => j.id === job.id);
    expect(found?.status).toBe('error');
    expect(found?.error).toBe('interrupted');
  });
});

describe('buildCapturePrompt', () => {
  it('includes title and truncates the transcript to 24k chars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cap-'));
    const { recorder } = deps(dir);
    const job = recorder.start(START);
    const long = 'x'.repeat(30_000);
    const prompt = buildCapturePrompt(job, long);
    expect(prompt).toContain('Webinar X');
    expect(prompt.length).toBeLessThan(25_000);
  });
});
