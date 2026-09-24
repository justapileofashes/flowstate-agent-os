// Deterministic brand-voice checks shared by draft.save (warns + flags) and
// the drift checker (opens a fix task). Only short "don't" entries are
// treated as literal phrases; long ones are guidance for the model.

const LEAD_IN = /^(no|don't|do not|never|avoid|stop|without)\s+(using\s+|use\s+|saying\s+|say\s+)?/i;

/** Phrases from brand don'ts that can be matched literally (≤ 4 words). */
export function literalDonts(donts: string[]): string[] {
  const out: string[] = [];
  for (const d of donts) {
    const phrase = d
      .trim()
      .replace(LEAD_IN, '')
      .replace(/^["'“”‘’]+|["'“”‘’.!]+$/g, '')
      .trim();
    if (!phrase) continue;
    if (phrase.split(/\s+/).length > 4) continue;
    out.push(phrase.toLowerCase());
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Brand "don't" phrases that appear in the text (case-insensitive, whole words). */
export function brandViolations(text: string, donts: string[]): string[] {
  const hits: string[] = [];
  for (const phrase of literalDonts(donts)) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRe(phrase)}([^a-z0-9]|$)`, 'i');
    if (re.test(text)) hits.push(phrase);
  }
  return hits;
}
