// Chat compaction. The whole history is resent every turn; past the model's
// context window Ollama silently drops the oldest tokens — often the start of
// the task. Once a chat outgrows its budget, older turns are summarized once
// (by the chat's own model) and the summary stands in for them on later turns.

import { estimateTokens } from '@main/services/token-estimate';
import type { ConversationMessage } from './types';

/** Settings key prefix: `chat_summary:<chatId>` → {count, summary}. */
export const SUMMARY_KEY_PREFIX = 'chat_summary:';

export interface StoredSummary {
  /** The summary covers history[0..count). */
  count: number;
  summary: string;
}

export function historyTokens(msgs: readonly ConversationMessage[]): number {
  return msgs.reduce(
    (n, m) => n + estimateTokens(m.content) + (m.toolCalls ? estimateTokens(JSON.stringify(m.toolCalls)) : 0) + 4,
    0,
  );
}

/**
 * Where to cut: everything before the returned index gets summarized, the rest
 * is kept verbatim. Keeps about half the budget of recent turns and always
 * cuts right before a user message, so a tool call never loses its result.
 * Returns 0 when nothing needs (or can) be cut.
 */
export function compactionCut(msgs: readonly ConversationMessage[], budgetTokens: number): number {
  if (historyTokens(msgs) <= budgetTokens) return 0;
  const keep = budgetTokens / 2;
  let tail = 0;
  let cut = 0;
  for (let i = msgs.length - 1; i > 0; i--) {
    tail += historyTokens([msgs[i]!]);
    if (msgs[i]!.role === 'user') cut = i;
    if (tail >= keep && cut > 0) break;
  }
  // Need at least two older messages for a summary to be worth a call.
  return cut >= 2 ? cut : 0;
}

/** Plain-text transcript of the turns to summarize (tool output trimmed). */
export function transcriptForSummary(msgs: readonly ConversationMessage[], previous?: string): string {
  const lines: string[] = [];
  if (previous) lines.push(`[Earlier summary]\n${previous}`);
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') lines.push(`[tool ${m.toolName ?? ''} result] ${m.content.slice(0, 800)}`);
    else if (m.toolCalls?.length) {
      lines.push(`${m.role}: ${m.content}\n[called ${m.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(0, 200)})`).join(', ')}]`);
    } else lines.push(`${m.role}: ${m.content}`);
  }
  return lines.join('\n\n');
}

export const SUMMARY_SYSTEM =
  'Summarize this earlier part of a conversation between a user and an AI agent so the agent can continue the work ' +
  'without it. Keep: the user\'s goal and requirements, decisions made, files and paths touched, commands run and ' +
  'their outcomes, open problems and next steps. Be specific and concise (at most ~400 words). No preamble.';

/** History with the summarized prefix replaced by one summary message. */
export function applySummary(msgs: readonly ConversationMessage[], s: StoredSummary): ConversationMessage[] {
  const system = msgs[0]?.role === 'system' ? [msgs[0]] : [];
  return [
    ...system,
    { role: 'user', content: `[Summary of the earlier conversation]\n${s.summary}` },
    { role: 'assistant', content: 'Understood — continuing from that summary.' },
    ...msgs.slice(s.count),
  ];
}
