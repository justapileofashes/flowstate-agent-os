import { randomUUID } from 'node:crypto';
import type { LLMProvider, ProviderDelta } from './llm-provider';
import type { ToolDispatcher } from './tool-dispatcher';
import type {
  AgentEvent,
  ConversationMessage,
  ToolCall,
  ToolSpec,
} from './types';

export interface AgentRuntimeOpts {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools: ToolSpec[];
  dispatcher: ToolDispatcher;
  maxToolCallsPerTurn?: number;
  history?: ConversationMessage[];
}

const DEFAULT_MAX_TOOL_CALLS = 25;

export class AgentRuntime {
  private history: ConversationMessage[];
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly tools: ToolSpec[];
  private readonly dispatcher: ToolDispatcher;
  private readonly maxToolCallsPerTurn: number;

  constructor(opts: AgentRuntimeOpts) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.tools = opts.tools;
    this.dispatcher = opts.dispatcher;
    this.maxToolCallsPerTurn = opts.maxToolCallsPerTurn ?? DEFAULT_MAX_TOOL_CALLS;
    if (opts.history && opts.history.length > 0) {
      this.history = [...opts.history];
      if (!this.history.some((m) => m.role === 'system')) {
        this.history.unshift({ role: 'system', content: opts.systemPrompt });
      }
    } else {
      this.history = [{ role: 'system', content: opts.systemPrompt }];
    }
  }

  getHistory(): ConversationMessage[] {
    return [...this.history];
  }

  send(userMessage: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    if (userMessage.trim().length === 0) {
      throw new Error('empty user message');
    }

    const snapshot = [...this.history];
    this.history.push({ role: 'user', content: userMessage });

    return this.runLoop(snapshot, signal);
  }

  private async *runLoop(
    snapshot: ConversationMessage[],
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    let toolCallsThisTurn = 0;

    try {
      for (;;) {
        if (signal?.aborted) {
          this.history = snapshot;
          yield { type: 'turn-done', reason: 'aborted' };
          return;
        }

        let assistantText = '';
        const pendingCalls: ToolCall[] = [];
        let tokenUsage: { promptTokens?: number; completionTokens?: number } = {};

        const stream = this.provider.chatStream({
          model: this.model,
          messages: this.history,
          tools: this.tools,
          ...(signal ? { signal } : {}),
        });

        for await (const delta of stream as AsyncIterable<ProviderDelta>) {
          if (signal?.aborted) {
            this.history = snapshot;
            yield { type: 'turn-done', reason: 'aborted' };
            return;
          }
          if (delta.type === 'text') {
            assistantText += delta.text;
            yield { type: 'text-delta', text: delta.text };
          } else if (delta.type === 'tool-call') {
            pendingCalls.push({
              id: delta.id ?? randomUUID(),
              name: delta.name,
              args: delta.args,
            });
          } else if (delta.type === 'done') {
            tokenUsage = {
              ...(delta.promptTokens !== undefined ? { promptTokens: delta.promptTokens } : {}),
              ...(delta.completionTokens !== undefined
                ? { completionTokens: delta.completionTokens }
                : {}),
            };
          }
        }

        if (tokenUsage.promptTokens !== undefined || tokenUsage.completionTokens !== undefined) {
          yield {
            type: 'token-usage',
            promptTokens: tokenUsage.promptTokens ?? 0,
            completionTokens: tokenUsage.completionTokens ?? 0,
          };
        }

        if (pendingCalls.length === 0) {
          this.history.push({ role: 'assistant', content: assistantText });
          yield { type: 'turn-done', reason: 'end' };
          return;
        }

        this.history.push({
          role: 'assistant',
          content: assistantText,
          toolCalls: pendingCalls,
        });

        for (const call of pendingCalls) {
          if (signal?.aborted) {
            this.history = snapshot;
            yield { type: 'turn-done', reason: 'aborted' };
            return;
          }
          toolCallsThisTurn += 1;
          if (toolCallsThisTurn > this.maxToolCallsPerTurn) {
            yield { type: 'turn-done', reason: 'max-tools' };
            return;
          }
          yield { type: 'tool-call', call };

          const result = await this.dispatcher.call(call.id, call.name, call.args);
          yield { type: 'tool-result', result };
          this.history.push({
            role: 'tool',
            content: result.content,
            toolCallId: call.id,
            toolName: call.name,
          });
        }
      }
    } catch (err) {
      this.history = snapshot;
      if (signal?.aborted) {
        yield { type: 'turn-done', reason: 'aborted' };
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'turn-done', reason: 'error', error: msg };
    }
  }
}
