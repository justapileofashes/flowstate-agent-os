// Model gateway (spec §3 "Model routing" / Phase 2) over the app's existing
// ProviderRouter. One call shape — chat({alias, messages, tools}) — routed
// by alias to the company's configured model, with retry + exponential
// backoff on transient errors, a per-provider circuit breaker, failover down
// a model chain, and usage/cost/credits returned on every response (and
// emitted as a usage event, including failed attempts for error-rate alerts).
//
// Models that reject native tool calling (many small local models) are
// transparently switched to a text protocol: tools are described in the
// system prompt and ```tool {...}``` blocks are parsed back into calls.

import { randomUUID } from 'node:crypto';
import type { LLMProvider, ProviderDelta } from '@main/agent/llm-provider';
import type { ConversationMessage, ToolCall, ToolSpec } from '@main/agent/types';
import { providerKindForModel, type ProviderKind } from '@main/agent/provider-router';
import { costFor } from '@main/services/model-pricing';
import { estimateTokens } from '@main/services/token-estimate';
import type { ModelAlias } from '@shared/business/types';
import { GATEWAY } from '../config';
import { creditsForLlmCall } from '../guardrails/budgets';
import type { UsageEventInput } from '../db/billing';

export interface GatewayChatRequest {
  alias: ModelAlias;
  companyId: string;
  messages: ConversationMessage[];
  tools?: ToolSpec[];
  /** Hint that the caller wants a single JSON object back. */
  json?: boolean;
  signal?: AbortSignal;
  meta?: { cycleId?: string | null; runId?: string | null; role?: string | null };
}

export interface GatewayUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  credits: number;
  estimated: boolean;
}

export interface GatewayChatResult {
  text: string;
  toolCalls: ToolCall[];
  model: string;
  provider: ProviderKind;
  usage: GatewayUsage;
  latencyMs: number;
  attempts: number;
  failovers: string[];
  textProtocol: boolean;
}

export interface GatewayDeps {
  provider: LLMProvider;
  /** Company alias → primary model id ('' when unset). */
  resolveModel: (companyId: string, alias: ModelAlias) => string;
  /** App-wide fallback chain (settings) + default model, in order. */
  fallbackModels: () => string[];
  onUsage?: (e: UsageEventInput) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly failovers: string[],
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

const TRANSIENT = [
  /\b429\b/,
  /rate.?limit/i,
  /\b5\d\d\b/,
  /overloaded/i,
  /timeout|timed out|etimedout|econnreset|socket hang up/i,
  /fetch failed|network|econnrefused/i,
];

const TOOLS_UNSUPPORTED = /does not support tools|tool(s)? (are )?not supported|tool use is not supported/i;

export function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return TRANSIENT.some((re) => re.test(msg));
}

// ── text tool protocol ──────────────────────────────────────────────────────

const TOOL_BLOCK_RE = /```(?:tool|json)?[ \t]*\r?\n?(\{[\s\S]*?\})[ \t]*\r?\n?```/g;

export function toolProtocolPrompt(tools: ToolSpec[]): string {
  const list = tools
    .map((t) => `- ${t.name}: ${t.description}\n  args schema: ${JSON.stringify(t.parameters)}`)
    .join('\n');
  return (
    '\n\n## Tools\nYou can call tools. To call one, reply with a fenced block exactly like:\n' +
    '```tool\n{"name": "<tool name>", "args": { } }\n```\n' +
    'You may include several blocks in one reply. Tool results come back in the next message. ' +
    'When you are finished, reply with plain text and no tool block.\n' +
    `Available tools:\n${list}`
  );
}

export function parseToolBlocks(text: string, allowed: Set<string>): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const m of text.matchAll(TOOL_BLOCK_RE)) {
    try {
      const obj = JSON.parse(m[1] ?? '') as Record<string, unknown>;
      const name = String(obj['name'] ?? obj['tool'] ?? '');
      const args = (obj['args'] ?? obj['arguments'] ?? obj['parameters'] ?? {}) as unknown;
      if (name && allowed.has(name)) calls.push({ id: randomUUID(), name, args });
    } catch {
      // not a tool block
    }
  }
  return calls;
}

/** Rewrite a native tool-calling transcript into plain turns for the text protocol. */
export function toTextProtocol(messages: ConversationMessage[], tools: ToolSpec[]): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  let systemPatched = false;
  for (const m of messages) {
    if (m.role === 'system' && !systemPatched) {
      out.push({ role: 'system', content: m.content + toolProtocolPrompt(tools) });
      systemPatched = true;
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks = m.toolCalls
        .map((c) => '```tool\n' + JSON.stringify({ name: c.name, args: c.args }) + '\n```')
        .join('\n');
      out.push({ role: 'assistant', content: `${m.content}\n${blocks}`.trim() });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', content: `[tool result: ${m.toolName ?? 'tool'}]\n${m.content}` });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  if (!systemPatched) out.unshift({ role: 'system', content: toolProtocolPrompt(tools).trim() });
  return out;
}

// ── gateway ─────────────────────────────────────────────────────────────────

export class ModelGateway {
  private readonly circuits = new Map<ProviderKind, CircuitState>();
  private readonly noToolModels = new Set<string>();
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: GatewayDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  /** Ordered, de-duplicated model chain for an alias. */
  chain(companyId: string, alias: ModelAlias): string[] {
    const out: string[] = [];
    const push = (m: string | undefined): void => {
      const t = (m ?? '').trim();
      if (t && !out.includes(t)) out.push(t);
    };
    push(this.deps.resolveModel(companyId, alias));
    for (const m of this.deps.fallbackModels()) push(m);
    return out;
  }

  circuitOpen(kind: ProviderKind): boolean {
    const c = this.circuits.get(kind);
    return Boolean(c && c.openUntil > this.now());
  }

  private recordSuccess(kind: ProviderKind): void {
    this.circuits.set(kind, { failures: 0, openUntil: 0 });
  }

  private recordFailure(kind: ProviderKind): void {
    const c = this.circuits.get(kind) ?? { failures: 0, openUntil: 0 };
    c.failures += 1;
    if (c.failures >= GATEWAY.circuitFailureThreshold) {
      c.openUntil = this.now() + GATEWAY.circuitCooldownMs;
      c.failures = 0; // half-open after the cooldown: one trial call
    }
    this.circuits.set(kind, c);
  }

  health(companyId: string, aliases: readonly ModelAlias[]): Array<{
    alias: ModelAlias;
    chain: string[];
    primary: string | null;
    provider: ProviderKind | null;
    circuitOpen: boolean;
    textProtocol: boolean;
  }> {
    return aliases.map((alias) => {
      const chain = this.chain(companyId, alias);
      const primary = chain[0] ?? null;
      const provider = primary ? providerKindForModel(primary) : null;
      return {
        alias,
        chain,
        primary,
        provider,
        circuitOpen: provider ? this.circuitOpen(provider) : false,
        textProtocol: primary ? this.noToolModels.has(primary) : false,
      };
    });
  }

  async chat(req: GatewayChatRequest): Promise<GatewayChatResult> {
    const chain = this.chain(req.companyId, req.alias);
    if (!chain.length) {
      throw new GatewayError(
        `No model configured for "${req.alias}". Pick one in Business → Settings → Models, or set a default model.`,
        [],
      );
    }
    const failovers: string[] = [];
    let attempts = 0;
    let lastErr: unknown = null;

    for (const model of chain) {
      const kind = providerKindForModel(model);
      if (this.circuitOpen(kind)) {
        failovers.push(`${model}: ${kind} circuit open`);
        continue;
      }
      for (let attempt = 1; attempt <= GATEWAY.retryAttempts; attempt++) {
        if (req.signal?.aborted) throw new Error('aborted');
        attempts += 1;
        const started = this.now();
        try {
          const res = await this.callOnce(model, kind, req);
          this.recordSuccess(kind);
          const latencyMs = this.now() - started;
          this.emitUsage(req, model, kind, res.usage, true, null, latencyMs);
          return { ...res, latencyMs, attempts, failovers, model, provider: kind };
        } catch (err) {
          if (req.signal?.aborted) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          if (TOOLS_UNSUPPORTED.test(msg) && req.tools?.length && !this.noToolModels.has(model)) {
            // Switch this model to the text protocol and retry immediately.
            this.noToolModels.add(model);
            attempt -= 1;
            continue;
          }
          lastErr = err;
          this.emitUsage(
            req,
            model,
            kind,
            { inputTokens: 0, outputTokens: 0, costUsd: 0, credits: 0, estimated: true },
            false,
            msg,
            this.now() - started,
          );
          if (isTransient(err) && attempt < GATEWAY.retryAttempts) {
            await this.sleep(GATEWAY.retryBaseDelayMs * 4 ** (attempt - 1));
            continue;
          }
          break;
        }
      }
      this.recordFailure(kind);
      failovers.push(`${model}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`.slice(0, 300));
    }
    throw new GatewayError(
      `All models failed for "${req.alias}": ${failovers.join(' | ') || 'no usable model'}`,
      failovers,
    );
  }

  private async callOnce(
    model: string,
    kind: ProviderKind,
    req: GatewayChatRequest,
  ): Promise<Omit<GatewayChatResult, 'latencyMs' | 'attempts' | 'failovers' | 'model' | 'provider'>> {
    const tools = req.tools ?? [];
    const textProtocol = tools.length > 0 && this.noToolModels.has(model);
    const messages = textProtocol ? toTextProtocol(req.messages, tools) : req.messages;

    // Local JSON calls: chatOnce with format=json is far more reliable for
    // small models, and local tokens are free (estimates are fine).
    if (!tools.length && req.json && kind === 'ollama') {
      const res = await this.deps.provider.chatOnce({
        model,
        messages,
        format: 'json',
        ...(req.signal ? { signal: req.signal } : {}),
      });
      const inputTokens = estimateTokens(messages.map((m) => m.content).join('\n'));
      const outputTokens = estimateTokens(res.text);
      return {
        text: res.text,
        toolCalls: [],
        usage: this.usage(model, inputTokens, outputTokens, true),
        textProtocol: false,
      };
    }

    let text = '';
    const toolCalls: ToolCall[] = [];
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    const stream = this.deps.provider.chatStream({
      model,
      messages,
      tools: textProtocol ? [] : tools,
      ...(req.signal ? { signal: req.signal } : {}),
    });
    for await (const delta of stream as AsyncIterable<ProviderDelta>) {
      if (delta.type === 'text') text += delta.text;
      else if (delta.type === 'tool-call') {
        toolCalls.push({ id: delta.id ?? randomUUID(), name: delta.name, args: delta.args });
      } else if (delta.type === 'done') {
        promptTokens = delta.promptTokens;
        completionTokens = delta.completionTokens;
      }
    }
    // Fallback parse: text-protocol models, and native models that wrote the
    // call as JSON in text instead of using the tool channel.
    if (tools.length && toolCalls.length === 0) {
      toolCalls.push(...parseToolBlocks(text, new Set(tools.map((t) => t.name))));
    }
    const estimated = promptTokens === undefined || completionTokens === undefined;
    const inputTokens = promptTokens ?? estimateTokens(messages.map((m) => m.content).join('\n'));
    const outputTokens = completionTokens ?? estimateTokens(text + JSON.stringify(toolCalls));
    return { text, toolCalls, usage: this.usage(model, inputTokens, outputTokens, estimated), textProtocol };
  }

  private usage(model: string, inputTokens: number, outputTokens: number, estimated: boolean): GatewayUsage {
    const costUsd = costFor(model, inputTokens, outputTokens);
    return {
      inputTokens,
      outputTokens,
      costUsd,
      credits: creditsForLlmCall(costUsd, inputTokens + outputTokens),
      estimated,
    };
  }

  private emitUsage(
    req: GatewayChatRequest,
    model: string,
    kind: ProviderKind,
    u: GatewayUsage,
    ok: boolean,
    error: string | null,
    latencyMs: number,
  ): void {
    try {
      this.deps.onUsage?.({
        companyId: req.companyId,
        cycleId: req.meta?.cycleId ?? null,
        runId: req.meta?.runId ?? null,
        role: req.meta?.role ?? null,
        alias: req.alias,
        provider: kind,
        model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        costUsd: u.costUsd,
        credits: u.credits,
        ok,
        error,
        latencyMs,
      });
    } catch {
      // metering must never break a call
    }
  }
}

/** Pull the first balanced JSON object out of model text (tolerates prose + fences). */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i]!;
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}
