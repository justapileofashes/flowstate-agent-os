export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: object;
}

export type AgentEventTurnDoneReason = 'end' | 'max-tools' | 'aborted' | 'error';

export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; result: ToolResult }
  | { type: 'turn-done'; reason: AgentEventTurnDoneReason; error?: string }
  | { type: 'token-usage'; promptTokens: number; completionTokens: number }
  | {
      type: 'tool-approval-required';
      toolCallId: string;
      toolName: string;
      args: unknown;
      cwd: string;
    }
  | {
      type: 'tool-approval-resolved';
      toolCallId: string;
      decision: 'allow-once' | 'allow-rest' | 'deny';
      reason?: string;
    };
