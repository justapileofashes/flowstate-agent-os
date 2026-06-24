import type { LLMProvider } from './llm-provider';
import type { ToolDispatcher } from './tool-dispatcher';
import type { AgentEvent, ConversationMessage, ToolCall, ToolSpec } from './types';
import { AgentRuntime } from './agent-runtime';
import { resolveModelChain, pickNextModel, isRetryableModelError } from './model-fallback';
import type {
  AgentRow,
  ChatRow,
  ChatRepository,
} from '@main/repos/chat-repository';
import { chatEventChannel, chatEventEndChannel } from '@shared/ipc-channels';

export interface AgentSessionOpts {
  streamId: string;
  agent: AgentRow;
  chat: ChatRow;
  history: ConversationMessage[];
  provider: LLMProvider;
  dispatcher: ToolDispatcher;
  repo: ChatRepository;
  send: (channel: string, payload: unknown) => void;
  toolSpecs: ToolSpec[];
  /** Ordered fallback models tried (in order) if the primary fails before
   *  emitting any output. Empty/undefined disables failover. */
  fallbackModels?: string[];
  onComplete?: () => void;
}

interface PendingAssistant {
  kind: 'assistant';
  content: string;
  toolCalls: ToolCall[];
}

interface PendingTool {
  kind: 'tool';
  content: string;
  toolCallId: string;
  toolName: string;
}

type Pending = PendingAssistant | PendingTool;

export class AgentSession {
  private readonly streamId: string;
  private readonly agent: AgentRow;
  private readonly chat: ChatRow;
  private readonly history: ConversationMessage[];
  private readonly provider: LLMProvider;
  private readonly dispatcher: ToolDispatcher;
  private readonly repo: ChatRepository;
  private readonly send: (channel: string, payload: unknown) => void;
  private readonly toolSpecs: ToolSpec[];
  private readonly fallbackModels: string[];
  private readonly onComplete?: () => void;
  private readonly abortController = new AbortController();

  constructor(opts: AgentSessionOpts) {
    this.streamId = opts.streamId;
    this.agent = opts.agent;
    this.chat = opts.chat;
    this.history = opts.history;
    this.provider = opts.provider;
    this.dispatcher = opts.dispatcher;
    this.repo = opts.repo;
    this.send = opts.send;
    this.fallbackModels = opts.fallbackModels ?? [];
    this.toolSpecs = opts.toolSpecs;
    if (opts.onComplete) this.onComplete = opts.onComplete;
  }

  abort(): void {
    this.abortController.abort();
  }

  async run(userText: string): Promise<void> {
    // Persist user message immediately so it survives any error/abort.
    this.repo.appendMessage(this.chat.id, { role: 'user', content: userText });

    // Failover chain: primary model first, then configured fallbacks. We only
    // switch models if the primary errors retryably BEFORE emitting any output,
    // so a partially-streamed turn is never duplicated.
    const chain = resolveModelChain(this.agent.model, this.fallbackModels, [
      this.agent.model,
      ...this.fallbackModels,
    ]);

    const persisted: Pending[] = [];
    let currentAssistant: PendingAssistant | null = null;
    let lastReason: string = 'end';

    const closeAssistant = (): void => {
      if (currentAssistant !== null) {
        persisted.push(currentAssistant);
        currentAssistant = null;
      }
    };

    try {
      const tried: string[] = [];
      let activeModel = chain[0]!;
      for (;;) {
        const runtime = new AgentRuntime({
          provider: this.provider,
          model: activeModel,
          systemPrompt: this.agent.systemPrompt,
          tools: this.toolSpecs,
          dispatcher: this.dispatcher,
          history: this.history,
        });
        let emitted = 0;
        try {
          for await (const event of runtime.send(userText, this.abortController.signal) as AsyncIterable<AgentEvent>) {
            emitted++;
            this.send(chatEventChannel(this.streamId), event);

            switch (event.type) {
          case 'text-delta':
            if (currentAssistant === null) {
              currentAssistant = { kind: 'assistant', content: '', toolCalls: [] };
            }
            currentAssistant.content += event.text;
            break;
          case 'tool-call':
            if (currentAssistant === null) {
              currentAssistant = { kind: 'assistant', content: '', toolCalls: [] };
            }
            currentAssistant.toolCalls.push(event.call);
            break;
          case 'tool-result':
            closeAssistant();
            persisted.push({
              kind: 'tool',
              content: event.result.content,
              toolCallId: event.result.toolCallId,
              toolName: event.result.toolName,
            });
            break;
          case 'turn-done':
            lastReason = event.reason;
            if (event.reason === 'end' || event.reason === 'max-tools') {
              closeAssistant();
            }
            break;
          case 'token-usage': {
            // Persist into the cost meter ledger. Local Ollama models are
            // priced at 0 — they still show up so the meter doubles as a
            // usage history (tokens/sec etc.).
            try {
              const ev = event as { promptTokens?: number; completionTokens?: number };
              // Lazy-load to avoid a hard dep at module-import time.
              const { recordUsage } = await import('@main/ipc/handlers/usage');
              recordUsage({
                chatId: this.chat.id,
                agentId: this.agent.id,
                model: activeModel,
                promptTokens: ev.promptTokens ?? 0,
                completionTokens: ev.completionTokens ?? 0,
              });
            } catch {
              // best-effort
            }
            break;
          }
          default:
            break;
            }
          }
          break; // turn completed on this model
        } catch (err) {
          const next = pickNextModel(chain, [...tried, activeModel]);
          if (
            emitted === 0 &&
            next !== null &&
            !this.abortController.signal.aborted &&
            isRetryableModelError(err)
          ) {
            // Nothing streamed yet — safe to transparently retry on the next
            // model. Surface a transient notice (not persisted).
            this.send(chatEventChannel(this.streamId), {
              type: 'text-delta',
              text: `⚠ ${activeModel} unavailable — retrying with ${next}…\n`,
            });
            tried.push(activeModel);
            activeModel = next;
            continue;
          }
          throw err;
        }
      }

      if (lastReason === 'end' || lastReason === 'max-tools') {
        for (const p of persisted) {
          if (p.kind === 'assistant') {
            this.repo.appendMessage(this.chat.id, {
              role: 'assistant',
              content: p.content,
              ...(p.toolCalls.length > 0 ? { toolCalls: p.toolCalls } : {}),
            });
          } else {
            this.repo.appendMessage(this.chat.id, {
              role: 'tool',
              content: p.content,
              toolCallId: p.toolCallId,
              toolName: p.toolName,
            });
          }
        }
      }

      this.send(chatEventEndChannel(this.streamId), { reason: lastReason });
    } finally {
      this.onComplete?.();
    }
  }
}
