// Client-side snippet helpers — mirror the backend's expansion so the composer
// can preview/insert resolved text. (Authoritative expansion is the backend's
// job at send; this keeps the UI in sync.)

const RE = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;
const BUILTINS = new Set(['date', 'time', 'datetime']);

/** Variable descriptors in a body: {name, def}, builtins excluded, first-seen. */
export function snippetVars(body: string): Array<{ name: string; def: string }> {
  const out: Array<{ name: string; def: string }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(body))) {
    const name = m[1]!.trim();
    if (BUILTINS.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, def: m[2] != null ? m[2].trim() : '' });
  }
  return out;
}

/** Expand {{var}} / {{var|default}} / {{date|time|datetime}} against `vars`. */
export function expandSnippet(body: string, vars: Record<string, string> = {}): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const builtins: Record<string, string> = { date, time, datetime: `${date} ${time}` };
  return body.replace(RE, (_full, rawName: string, def: string | undefined) => {
    const name = rawName.trim();
    if (name in builtins) return builtins[name]!;
    if (vars[name] != null && vars[name] !== '') return vars[name]!;
    return def != null ? def : '';
  });
}
