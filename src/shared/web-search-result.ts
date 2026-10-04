// Shape of the web_search tool's output, shared by the dispatcher (writes it)
// and the chat UI (renders citation cards). Older chats stored a bare array of
// hits, so the parser accepts both.

export interface WebSearchHitView {
  title?: string;
  snippet?: string;
  url?: string;
}

export interface WebSearchToolOutput {
  provider?: string;
  note?: string;
  results: WebSearchHitView[];
  /** Free text from an MCP search tool whose output isn't a hit list. */
  text?: string;
}

export function parseWebSearchOutput(content: string): WebSearchToolOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (Array.isArray(parsed)) return { results: parsed as WebSearchHitView[] };
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o['results'])) return null;
  const out: WebSearchToolOutput = { results: o['results'] as WebSearchHitView[] };
  if (typeof o['provider'] === 'string') out.provider = o['provider'];
  if (typeof o['note'] === 'string') out.note = o['note'];
  if (typeof o['text'] === 'string') out.text = o['text'];
  return out;
}
