// Deterministic fake LLM for business-agent tests (spec Phase 1: "build a
// deterministic fake LLM for tests (returns scripted tool calls)"). A
// handler sees each request and returns text and/or tool calls; helpers
// classify which prompt is being answered.

import type {
  ChatOnceOpts,
  ChatOnceResult,
  ChatStreamOpts,
  LLMProvider,
  LLMProviderModel,
  ProviderDelta,
  PullProgress,
} from '@main/agent/llm-provider';
import type { ConversationMessage } from '@main/agent/types';
import type { RoleKey } from '@shared/business/types';
import { ROLES } from '@main/business/agent/roles';

export interface FakeReply {
  text?: string;
  tools?: Array<{ name: string; args: unknown }>;
  promptTokens?: number;
  completionTokens?: number;
}

export interface FakeRequest {
  model: string;
  messages: ConversationMessage[];
  toolNames: string[];
  kind: 'stream' | 'once';
  json: boolean;
}

export type FakeHandler = (req: FakeRequest) => FakeReply | Error | Promise<FakeReply | Error>;

export class ScriptedLLM implements LLMProvider {
  readonly calls: FakeRequest[] = [];

  constructor(
    private handler: FakeHandler,
    private readonly models: string[] = ['fake-model'],
  ) {}

  setHandler(h: FakeHandler): void {
    this.handler = h;
  }

  async *chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta> {
    const req: FakeRequest = {
      model: opts.model,
      messages: opts.messages,
      toolNames: opts.tools.map((t) => t.name),
      kind: 'stream',
      json: false,
    };
    this.calls.push(req);
    const r = await this.handler(req);
    if (r instanceof Error) throw r;
    if (r.text) yield { type: 'text', text: r.text };
    for (const t of r.tools ?? []) yield { type: 'tool-call', name: t.name, args: t.args, id: `call-${this.calls.length}-${t.name}` };
    yield { type: 'done', promptTokens: r.promptTokens ?? 400, completionTokens: r.completionTokens ?? 100 };
  }

  async chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult> {
    const req: FakeRequest = { model: opts.model, messages: opts.messages, toolNames: [], kind: 'once', json: opts.format === 'json' };
    this.calls.push(req);
    const r = await this.handler(req);
    if (r instanceof Error) throw r;
    return { text: r.text ?? '' };
  }

  async listModels(): Promise<LLMProviderModel[]> {
    return this.models.map((name) => ({ name }));
  }

  async isReachable(): Promise<boolean> {
    return true;
  }

  async *pullModel(): AsyncIterable<PullProgress> {
    yield { status: 'success' };
  }
}

// ── classifiers ─────────────────────────────────────────────────────────────

const sys = (r: FakeRequest): string => r.messages.find((m) => m.role === 'system')?.content ?? '';
const lastUser = (r: FakeRequest): string => [...r.messages].reverse().find((m) => m.role === 'user')?.content ?? '';

export const is = {
  plan: (r: FakeRequest) => lastUser(r).includes('Output format (strict JSON'),
  goalCheck: (r: FakeRequest) => sys(r).includes('strict reviewer'),
  summary: (r: FakeRequest) => /cycle report|end-of-day summary/.test(lastUser(r)) && sys(r).includes('reporting to the owner'),
  kaizen: (r: FakeRequest) => sys(r).includes('operations reviewer'),
  drift: (r: FakeRequest) => sys(r).includes('brand and strategy auditor'),
  extract: (r: FakeRequest) => sys(r).includes('Extract data from a web page'),
  role: (r: FakeRequest, role: RoleKey) => sys(r).startsWith(ROLES[role].prompt),
};

export function roleOf(r: FakeRequest): RoleKey | null {
  for (const role of Object.keys(ROLES) as RoleKey[]) if (is.role(r, role)) return role;
  return null;
}

/** Tool results already in this conversation (in order). */
export function toolResults(r: FakeRequest): Array<{ name: string; content: string }> {
  return r.messages.filter((m) => m.role === 'tool').map((m) => ({ name: m.toolName ?? '', content: m.content }));
}

export function userPrompt(r: FakeRequest): string {
  return lastUser(r);
}

/** Default auxiliary replies: goal checks pass, summaries/kaizen/drift are benign. */
export function auxReply(r: FakeRequest): FakeReply | null {
  if (is.goalCheck(r)) return { text: '{"achieved": true, "reason": "done"}' };
  if (is.summary(r)) return { text: '## Cycle report\n**Done**\n- work\n**Needs you**\n- approvals\n**Next**\n- continue' };
  if (is.kaizen(r)) return { text: '{"rules": []}' };
  if (is.drift(r)) return { text: '{"findings": []}' };
  if (is.extract(r)) return { text: '{"data": {"tiers": [{"name": "Pro", "price": "$19/mo"}]}}' };
  return null;
}
