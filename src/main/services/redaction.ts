// Local, deterministic redaction of secrets and PII. Used by the audit logger so
// the governance record never persists sensitive values. Pure + dependency-free.
//
// This is NOT applied to content the agent reads or edits — only to data we store
// or display about what it did. Detectors run specific-first so a more general rule
// doesn't partially mask a value a specific rule would have caught cleanly.

interface Detector {
  re: RegExp;
  replacement: string;
}

const DETECTORS: Detector[] = [
  // Private key blocks (PEM).
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '<key>',
  },
  // Email addresses.
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '<email>' },
  // AWS access key id.
  { re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '<token>' },
  // Bearer / authorization tokens.
  { re: /\b[Bb]earer\s+[A-Za-z0-9._\-]+/g, replacement: 'Bearer <token>' },
  // key= / token= / secret= / password= / api_key: assignments.
  {
    re: /\b(api[_-]?key|secret|password|passwd|token|access[_-]?token)\b\s*[:=]\s*["']?[^\s"',]+["']?/gi,
    replacement: '$1=<secret>',
  },
  // OpenAI / generic sk- style keys.
  { re: /\bsk-[A-Za-z0-9]{16,}\b/g, replacement: '<token>' },
  // US SSN.
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '<ssn>' },
  // Credit-card-like: 13–19 digits, optionally space/dash separated in groups.
  { re: /\b(?:\d[ -]?){13,19}\b/g, replacement: '<card>' },
  // Long opaque hex/base64 token blobs (>=24 chars).
  { re: /\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g, replacement: '<token>' },
];

/** Mask secrets / PII in a string. Returns the input unchanged if nothing matches. */
export function redactSensitive(text: string): string {
  if (!text) return text;
  let out = text;
  for (const d of DETECTORS) {
    out = out.replace(d.re, d.replacement);
  }
  return out;
}
