// Redaction for everything the business agent persists about what it did
// (run_steps, feed, audit, approval previews): secret-named keys are dropped,
// strings go through the shared secret/PII detectors, HTML is flattened, and
// long values are clipped. Content the agent *works on* is not scrubbed —
// only the trace we store.

import { redactSensitive } from '@main/services/redaction';

const SECRET_KEY_RE = /(pass(word|wd)?|secret|token|api[_-]?key|authorization|auth|cookie|session|private[_-]?key|credential|signature)/i;

export function stripHtml(s: string): string {
  if (!/<[a-z!/][^>]*>/i.test(s)) return s;
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/<[^>]*$/, ' ') // dangling unclosed tag at the end
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// Record ids (UUIDs) look like opaque tokens to the generic detector but are
// not secrets — keep them so traces and replays stay navigable.
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export function scrubText(s: string, max = 2_000): string {
  const ids: string[] = [];
  const shielded = stripHtml(s).replace(UUID_RE, (m) => `\u0000${ids.push(m) - 1}\u0000`);
  const clean = redactSensitive(shielded).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => ids[Number(i)] ?? '');
  return clean.length > max ? `${clean.slice(0, max)}…[+${clean.length - max} chars]` : clean;
}

/** Deep-scrub a JSON-ish value. */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return scrubText(v, 1_000);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const head = v.slice(0, 25).map((x) => scrubValue(x, depth + 1));
    return v.length > 25 ? [...head, `[+${v.length - 25} more]`] : head;
  }
  if (typeof v === 'object') {
    // Secret wrappers serialize to '<redacted>' themselves; plain objects are walked.
    const maybe = v as { toJSON?: () => unknown };
    if (typeof maybe.toJSON === 'function' && !(v instanceof Date)) {
      const j = maybe.toJSON();
      if (j === '<redacted>') return j;
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 60)) {
      out[k] = SECRET_KEY_RE.test(k) ? '<redacted>' : scrubValue(val, depth + 1);
    }
    return out;
  }
  return String(v);
}

/** Scrubbed JSON string for a trace column. */
export function scrubJson(v: unknown, max = 2_000): string {
  let s: string;
  try {
    s = JSON.stringify(scrubValue(v));
  } catch {
    s = '"[unserializable]"';
  }
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
