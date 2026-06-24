// @file mentions. A dev types "@src/auth.ts why does login 500?" and the
// referenced file is pulled into context automatically. Pure: parsing the
// mentions and formatting the context block. Actual reads + sandbox checks
// happen in the IPC handler against the agent workspace.

const MENTION_RE = /(^|\s)@([A-Za-z0-9._\-/\\]+[A-Za-z0-9])/g;
const MAX_FILE_CHARS = 6000;

/** Extract @-mentioned relative paths, de-duped, in first-seen order. */
export function parseMentions(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const raw = m[2]!;
    // ignore bare "@" emails-ish or paths that are just dots
    if (!/[A-Za-z0-9]/.test(raw)) continue;
    const path = raw.replace(/\\/g, '/');
    if (!seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

export interface MentionedFile {
  path: string;
  /** null when the file could not be read (missing / outside workspace). */
  content: string | null;
}

function lang(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', md: 'md',
    py: 'python', rs: 'rust', go: 'go', sh: 'bash', css: 'css', html: 'html',
    sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  };
  return map[ext] ?? '';
}

function clip(s: string): string {
  return s.length > MAX_FILE_CHARS
    ? s.slice(0, MAX_FILE_CHARS) + `\n… [clipped — ${s.length} chars total]`
    : s;
}

/**
 * Render mentioned files as a fenced context block prepended to the prompt.
 * Unreadable mentions are noted inline rather than dropped silently. Returns ''
 * when there is nothing to attach.
 */
export function buildContextBlock(files: MentionedFile[]): string {
  if (files.length === 0) return '';
  const parts: string[] = ['# Attached files (via @mention)', ''];
  for (const f of files) {
    if (f.content === null) {
      parts.push(`## ${f.path}`, '_(could not read — not found or outside the workspace)_', '');
      continue;
    }
    parts.push(`## ${f.path}`, '```' + lang(f.path), clip(f.content), '```', '');
  }
  return parts.join('\n');
}
