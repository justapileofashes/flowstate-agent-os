import type { ConversationMessage, ToolSpec } from './types';

export interface LLMProviderModel {
  name: string;
  size?: number;
}

export type ProviderDelta =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name: string; args: unknown; id?: string }
  | { type: 'done'; promptTokens?: number; completionTokens?: number };

export interface ChatStreamOpts {
  model: string;
  messages: ConversationMessage[];
  tools: ToolSpec[];
  signal?: AbortSignal;
}

export interface ChatOnceOpts {
  model: string;
  messages: ConversationMessage[];
  format?: 'json';
  signal?: AbortSignal;
}

export interface ChatOnceResult {
  text: string;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface LLMProvider {
  chatStream(opts: ChatStreamOpts): AsyncIterable<ProviderDelta>;
  chatOnce(opts: ChatOnceOpts): Promise<ChatOnceResult>;
  listModels(): Promise<LLMProviderModel[]>;
  isReachable(): Promise<boolean>;
  pullModel(name: string, signal?: AbortSignal): AsyncIterable<PullProgress>;
}
