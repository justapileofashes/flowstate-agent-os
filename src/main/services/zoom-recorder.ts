// Meeting-recorder job store + poller (spec §2,
// docs/superpowers/specs/2026-06-10-zoom-meeting-recorder-design.md). A job
// arms a Zoom meeting for cloud recording, waits for Zoom to finish
// processing, downloads the full recording + transcript into recordingsDir,
// then dispatches the transcript to a flowclaw gateway connection for a
// summary and persists the result as a chat. All dependencies are injected so
// the lifecycle is testable without Electron, the DB, or the network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type ZoomJobStatus = 'armed' | 'waiting' | 'downloading' | 'summarizing' | 'done' | 'error';

export interface ZoomJob {
  id: string;
  meetingId: string;
  topic: string;
  agentId: string; // chat rows require an agent
  connectionId: string; // flowclaw connection that writes the summary
  model?: string;
  status: ZoomJobStatus;
  chatId?: string;
  recordingFiles?: string[]; // local absolute paths after download
  shareUrl?: string;
  joinUrl?: string; // set when the job created the meeting
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** The slice of ZoomService the recorder needs (kept narrow for fakes). */
export interface ZoomServiceLike {
  ensureCloudRecording(meetingId: string): Promise<void>;
  createMeeting(topic: string): Promise<{ id: string; joinUrl: string }>;
  getRecordings(meetingId: string): Promise<{
    ready: boolean;
    shareUrl?: string;
    files: Array<{ fileType: string; downloadUrl: string }>;
  }>;
  download(url: string, destPath: string): Promise<void>;
  downloadText(url: string): Promise<string>;
}

/** The slice of FlowclawConnections the recorder needs. */
export interface RunDispatcher {
  runToText(id: string, prompt: string, opts?: { model?: string }): Promise<string>;
}

/** The slice of ChatRepository the recorder needs. */
export interface ChatSink {
  createChat(agentId: string, title?: string): { id: string };
  appendMessage(chatId: string, msg: { role: 'user' | 'assistant'; content: string }): unknown;
}

export interface RecordInput {
  meetingId?: string;
  topic?: string;
  agentId: string;
  connectionId: string;
  model?: string;
}

export interface ZoomRecorderDeps {
  zoom: ZoomServiceLike;
  dispatcher: RunDispatcher;
  chats: ChatSink;
  jobsPath: string; // e.g. userData/zoom-jobs.json
  recordingsDir: string; // e.g. userData/zoom-recordings
  now?: () => number;
}

export class ZoomRecorder {
  private jobs: ZoomJob[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: ZoomRecorderDeps) {
    this.load();
  }

  private nowMs(): number {
    return (this.deps.now ?? Date.now)();
  }

  private load(): void {
    try {
      if (!existsSync(this.deps.jobsPath)) return;
      const parsed = JSON.parse(readFileSync(this.deps.jobsPath, 'utf8'));
      if (Array.isArray(parsed)) this.jobs = parsed as ZoomJob[];
    } catch {
      this.jobs = [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.deps.jobsPath), { recursive: true });
      writeFileSync(this.deps.jobsPath, JSON.stringify(this.jobs), 'utf8');
    } catch {
      // best-effort, same as RoutineStore
    }
  }

  list(): ZoomJob[] {
    return this.jobs.slice();
  }

  private setStatus(job: ZoomJob, status: ZoomJobStatus): void {
    job.status = status;
    job.updatedAt = this.nowMs();
    this.persist();
  }

  /** Arm a meeting for cloud recording (or create a fresh recorded meeting). */
  async record(input: RecordInput): Promise<ZoomJob> {
    const now = this.nowMs();
    const job: ZoomJob = {
      id: randomUUID(),
      meetingId: input.meetingId ?? '',
      topic: input.topic ?? 'Zoom meeting',
      agentId: input.agentId,
      connectionId: input.connectionId,
      ...(input.model ? { model: input.model } : {}),
      status: 'armed',
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.push(job);
    this.persist();
    try {
      if (input.meetingId) {
        await this.deps.zoom.ensureCloudRecording(input.meetingId);
      } else if (input.topic) {
        const m = await this.deps.zoom.createMeeting(input.topic);
        job.meetingId = m.id;
        job.joinUrl = m.joinUrl;
      } else {
        throw new Error('Either meetingId or topic is required');
      }
      this.setStatus(job, 'waiting');
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      this.setStatus(job, 'error');
    }
    return job;
  }

  /** One poll cycle: advance every waiting job whose recording became ready. */
  async tick(): Promise<void> {
    for (const job of this.jobs.filter((j) => j.status === 'waiting')) {
      try {
        const rec = await this.deps.zoom.getRecordings(job.meetingId);
        if (!rec.ready) continue;
        if (rec.shareUrl) job.shareUrl = rec.shareUrl;

        this.setStatus(job, 'downloading');
        const transcript = await this.collectFiles(job, rec.files);

        this.setStatus(job, 'summarizing');
        const prompt = buildSummaryPrompt(job, transcript);
        const summary = await this.deps.dispatcher.runToText(job.connectionId, prompt, {
          ...(job.model ? { model: job.model } : {}),
        });

        const chat = this.deps.chats.createChat(job.agentId, `Zoom · ${job.topic}`);
        this.deps.chats.appendMessage(chat.id, { role: 'user', content: prompt });
        this.deps.chats.appendMessage(chat.id, {
          role: 'assistant',
          content: finalMessage(job, summary),
        });
        job.chatId = chat.id;
        this.setStatus(job, 'done');
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        this.setStatus(job, 'error');
      }
    }
  }

  /** Download MP4/M4A + transcript locally. Returns transcript text when
   *  available. Download failures are non-fatal — cloud links remain. */
  private async collectFiles(
    job: ZoomJob,
    files: Array<{ fileType: string; downloadUrl: string }>,
  ): Promise<string | null> {
    const local: string[] = [];
    let transcript: string | null = null;
    const dir = join(this.deps.recordingsDir, job.meetingId);
    for (const f of files) {
      const type = f.fileType.toUpperCase();
      try {
        if (type === 'TRANSCRIPT' || type === 'VTT') {
          transcript = await this.deps.zoom.downloadText(f.downloadUrl);
          const dest = join(dir, 'transcript.vtt');
          mkdirSync(dirname(dest), { recursive: true });
          writeFileSync(dest, transcript, 'utf8');
          local.push(dest);
        } else if (type === 'MP4' || type === 'M4A') {
          const dest = join(dir, `recording.${type.toLowerCase()}`);
          await this.deps.zoom.download(f.downloadUrl, dest);
          local.push(dest);
        }
      } catch {
        // non-fatal: this file stays cloud-only
      }
    }
    if (local.length > 0) job.recordingFiles = local;
    return transcript;
  }

  /** Start the poller. Cheap when no jobs are waiting. */
  start(intervalMs = 60_000): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function buildSummaryPrompt(job: ZoomJob, transcript: string | null): string {
  const head = `You are reviewing the Zoom meeting "${job.topic}" (meeting ID ${job.meetingId}).`;
  if (transcript) {
    return (
      `${head}\nBelow is the meeting transcript (VTT). Write meeting notes: a concise ` +
      `summary, key decisions, and action items with owners.\n\n${transcript}`
    );
  }
  return (
    `${head}\nNo transcript was available for this recording (enable "Audio transcript" ` +
    `in Zoom recording settings to get one next time). Write a short note that the ` +
    `meeting was recorded and point the reader to the recording files listed after ` +
    `your note.`
  );
}

export function finalMessage(job: ZoomJob, summary: string): string {
  const lines = [summary.trim(), '', '---'];
  if (job.recordingFiles && job.recordingFiles.length > 0) {
    lines.push('Full recording (local):', ...job.recordingFiles.map((p) => `- ${p}`));
  } else {
    lines.push('Local download unavailable — use the cloud link below.');
  }
  if (job.shareUrl) lines.push(`Zoom share link: ${job.shareUrl}`);
  return lines.join('\n');
}
