export interface ToolCallView {
  id: string;
  name: string;
  args: unknown;
  result?: { ok: boolean; content: string };
}

export interface StreamingAssistant {
  content: string;
  toolCalls: ToolCallView[];
}

export type AgentEventLike =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: { id: string; name: string; args: unknown } }
  | { type: 'tool-result'; result: { toolCallId: string; toolName: string; ok: boolean; content: string } }
  | { type: 'turn-done'; reason: string; error?: string }
  | { type: 'token-usage'; promptTokens: number; completionTokens: number };

export function emptyStreaming(): StreamingAssistant {
  return { content: '', toolCalls: [] };
}

export function mergeEvents(
  state: StreamingAssistant,
  events: AgentEventLike[],
): StreamingAssistant {
  let next: StreamingAssistant = state;
  let mutated = false;

  const ensure = (): StreamingAssistant => {
    if (!mutated) {
      next = { content: state.content, toolCalls: state.toolCalls.map((c) => ({ ...c })) };
      mutated = true;
    }
    return next;
  };

  for (const event of events) {
    if (event.type === 'text-delta') {
      const s = ensure();
      s.content += event.text;
    } else if (event.type === 'tool-call') {
      const s = ensure();
      s.toolCalls.push({
        id: event.call.id,
        name: event.call.name,
        args: event.call.args,
      });
    } else if (event.type === 'tool-result') {
      const s = ensure();
      const idx = s.toolCalls.findIndex((c) => c.id === event.result.toolCallId);
      if (idx >= 0) {
        const tc = s.toolCalls[idx]!;
        s.toolCalls[idx] = {
          ...tc,
          result: { ok: event.result.ok, content: event.result.content },
        };
      }
    }
  }

  return next;
}
