// Tool calling for local models that don't do it natively. Some reject the
// `tools` parameter outright; others "call" a tool by writing JSON in their
// reply. Both work through a plain-text protocol: tools are described in the
// system prompt, calls are parsed out of the reply text, and tool history is
// replayed as ordinary turns.

import type { ConversationMessage, ToolSpec } from './types';

export interface TextToolCall {
  name: string;
  args: unknown;
}

const BLOCK_RES = [
  /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, // Qwen/Hermes style
  /```(?:tool|tool_call|json)?[ \t]*\r?\n?(\{[\s\S]*?\})[ \t]*\r?\n?```/g, // fenced JSON
];

function asCall(obj: unknown, allowed: ReadonlySet<string>): TextToolCall | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const fn = o['function'] && typeof o['function'] === 'object' ? (o['function'] as Record<string, unknown>) : o;
  const name = String(fn['name'] ?? fn['tool'] ?? '');
  if (!allowed.has(name)) return null;
  let args = fn['arguments'] ?? fn['args'] ?? fn['parameters'] ?? fn['input'] ?? {};
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      // leave as string; the dispatcher validates
    }
  }
  return { name, args };
}

/** Tool calls written as text: <tool_call> tags, fenced JSON blocks, or a
 *  reply that is nothing but one JSON call object. Unknown tools are ignored. */
export function parseTextToolCalls(text: string, allowed: ReadonlySet<string>): TextToolCall[] {
  const calls: TextToolCall[] = [];
  for (const re of BLOCK_RES) {
    for (const m of text.matchAll(re)) {
      try {
        const c = asCall(JSON.parse(m[1] ?? ''), allowed);
        if (c) calls.push(c);
      } catch {
        // not JSON
      }
    }
    if (calls.length) return calls;
  }
  const whole = text.trim();
  if (whole.startsWith('{') && whole.endsWith('}')) {
    try {
      const c = asCall(JSON.parse(whole), allowed);
      if (c) calls.push(c);
    } catch {
      // prose that happens to be braced
    }
  }
  return calls;
}

/** The reply with its tool blocks removed (what's left is shown as text). */
export function stripToolBlocks(text: string): string {
  let out = text;
  for (const re of BLOCK_RES) out = out.replace(re, '');
  const t = out.trim();
  return t.startsWith('{') && t.endsWith('}') ? '' : t;
}

/** System-prompt section describing the tools for the text protocol. */
export function textToolPrompt(tools: readonly ToolSpec[]): string {
  const list = tools
    .map((t) => `- ${t.name}: ${t.description}\n  arguments: ${JSON.stringify(t.parameters)}`)
    .join('\n');
  return (
    '\n\n## Tools\nYou can use tools. To call one, reply with ONLY a block like:\n' +
    '<tool_call>\n{"name": "<tool name>", "arguments": { ... }}\n</tool_call>\n' +
    'The result comes back in the next message. When you are done, answer in plain text with no tool block.\n' +
    `Available tools:\n${list}`
  );
}

/** Replay native tool history as plain turns for a model without tool support. */
export function toTextProtocolMessages(
  messages: readonly ConversationMessage[],
  tools: readonly ToolSpec[],
): ConversationMessage[] {
  const out: ConversationMessage[] = [];
  let systemDone = false;
  for (const m of messages) {
    if (m.role === 'system' && !systemDone) {
      out.push({ role: 'system', content: m.content + textToolPrompt(tools) });
      systemDone = true;
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks = m.toolCalls
        .map((c) => `<tool_call>\n${JSON.stringify({ name: c.name, arguments: c.args })}\n</tool_call>`)
        .join('\n');
      out.push({ role: 'assistant', content: [m.content, blocks].filter(Boolean).join('\n') });
    } else if (m.role === 'tool') {
      out.push({ role: 'user', content: `Tool result (${m.toolName ?? 'tool'}):\n${m.content}` });
    } else {
      out.push(m);
    }
  }
  if (!systemDone) out.unshift({ role: 'system', content: textToolPrompt(tools).trimStart() });
  return out;
}

/** Ollama's error for models whose template has no tool support. */
export function isToolsUnsupportedError(message: string): boolean {
  return /does not support tools|tools? (are|is) not supported/i.test(message);
}
