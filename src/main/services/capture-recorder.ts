// System-audio capture jobs: renderer streams webm chunks in, we append to
// disk; on stop → transcribe (pluggable, failure non-fatal) → summarize via
// flowclaw gateway → persist a notes chat. Mirror of zoom-recorder.ts.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Transcriber } from './transcriber';
import type { RunDispatcher, ChatSink } from './zoom-recorder';

export type CaptureJobStatus = 'recording' | 'transcribing' | 'summarizing' | 'done' | 'error';

export interface CaptureJob {
  id: string;
  title: string;
  agentId: string;
  connectionId: string;
  model?: string;
  status: CaptureJobStatus;
  audioPath: string;
  bytes: number;
  chatId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CaptureRecorderDeps {
  jobsPath: string;
  capturesDir: string;
  getTranscriber: () => Transcriber | null;
  dispatcher: RunDispatcher;
  chatSink: ChatSink;
  now?: () => number;
}

export interface CaptureStartInput {
  title: string;
  agentId: string;
  connectionId: string;
  model?: string;
}

export class CaptureRecorder {
  private jobList: CaptureJob[] = [];

  constructor(private readonly deps: CaptureRecorderDeps) {
    this.load();
    // A job still "recording" at construction time means the app died (or was
    // closed) mid-capture — the renderer stream is gone, so fail it honestly.
    let dirty = false;
    for (const job of this.jobList) {
      if (job.status === 'recording' || job.status === 'transcribing' || job.status === 'summarizing') {
        job.status = 'error';
        job.error = 'interrupted';
        job.updatedAt = this.nowMs();
        dirty = true;
      }
    }
    if (dirty) this.persist();
  }

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private load(): void {
    try {
      if (!existsSync(this.deps.jobsPath)) return;
      const parsed = JSON.parse(readFileSync(this.deps.jobsPath, 'utf8'));
      if (Array.isArray(parsed)) this.jobList = parsed as CaptureJob[];
    } catch {
      this.jobList = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.deps.jobsPath), { recursive: true });
      writeFileSync(this.deps.jobsPath, JSON.stringify(this.jobList), 'utf8');
    } catch {
      // best-effort, same as ZoomRecorder
    }
  }

  private set(job: CaptureJob, patch: Partial<CaptureJob>): void {
    Object.assign(job, patch);
    job.updatedAt = this.nowMs();
    this.persist();
  }

  jobs(): CaptureJob[] {
    return this.jobList.slice();
  }

  start(input: CaptureStartInput): CaptureJob {
    const now = this.nowMs();
    const id = randomUUID();
    const audioPath = join(this.deps.capturesDir, id, 'audio.webm');
    mkdirSync(dirname(audioPath), { recursive: true });
    writeFileSync(audioPath, '');
    const job: CaptureJob = {
      id,
      title: input.title,
      agentId: input.agentId,
      connectionId: input.connectionId,
      ...(input.model ? { model: input.model } : {}),
      status: 'recording',
      audioPath,
      bytes: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.jobList.push(job);
    this.persist();
    return job;
  }

  appendChunk(id: string, data: Uint8Array): void {
    const job = this.jobList.find((j) => j.id === id);
    if (!job || job.status !== 'recording') return;
    appendFileSync(job.audioPath, data);
    this.set(job, { bytes: job.bytes + data.byteLength });
  }

  async stop(id: string): Promise<CaptureJob> {
    const job = this.jobList.find((j) => j.id === id);
    if (!job) throw new Error(`unknown capture job: ${id}`);

    let transcript: string | null = null;
    let note = '';
    const t = this.deps.getTranscriber();
    if (!t) {
      note = 'Transcriber not configured — transcript unavailable.';
    } else {
      this.set(job, { status: 'transcribing' });
      try {
        transcript = await t.transcribe(job.audioPath);
      } catch (err) {
        note = `Transcription failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    try {
      let finalText: string;
      let prompt = '';
      if (transcript && transcript.trim()) {
        this.set(job, { status: 'summarizing' });
        prompt = buildCapturePrompt(job, transcript);
        const summary = await this.deps.dispatcher.runToText(job.connectionId, prompt, {
          ...(job.model ? { model: job.model } : {}),
        });
        finalText = `${summary}\n\n---\nLocal recording: ${job.audioPath}`;
      } else {
        prompt = `Capture "${job.title}" finished but no transcript is available.`;
        finalText = `${note}\n\nLocal recording: ${job.audioPath}`;
      }
      const chat = this.deps.chatSink.createChat(job.agentId, `Capture · ${job.title}`);
      this.deps.chatSink.appendMessage(chat.id, { role: 'user', content: prompt });
      this.deps.chatSink.appendMessage(chat.id, { role: 'assistant', content: finalText });
      this.set(job, { status: 'done', chatId: chat.id });
    } catch (err) {
      this.set(job, { status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    return job;
  }
}

const TRANSCRIPT_CHAR_CAP = 24_000;

export function buildCapturePrompt(job: CaptureJob, transcript: string): string {
  return (
    `You attended a recorded session titled "${job.title}". Write a concise ` +
    `summary, key decisions, and action items with owners.\n\n` +
    `Transcript:\n${transcript.slice(0, TRANSCRIPT_CHAR_CAP)}`
  );
}
