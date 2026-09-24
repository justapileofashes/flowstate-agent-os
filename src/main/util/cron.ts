// Minimal 5-field cron evaluator ("m h dom mon dow"). Shared by Routines and
// the business-agent scheduler. Pure — no electron imports.

/** Supports `*`, lists (1,2,3), ranges (1-5), and steps (* /15). Scans
 *  minute-by-minute up to ~366 days ahead. Cheap enough for per-job cadence. */
export function nextCron(expr: string, from: number): number {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return from + 60 * 60_000;
  const [minF, hrF, domF, monF, dowF] = fields as [string, string, string, string, string];
  const matches = (val: number, field: string, min: number, max: number): boolean => {
    if (field === '*') return true;
    for (const part of field.split(',')) {
      const step = part.includes('/') ? Number(part.split('/')[1]) : 1;
      const range = part.split('/')[0]!;
      let lo = min;
      let hi = max;
      if (range !== '*') {
        if (range.includes('-')) {
          const [a, b] = range.split('-');
          lo = Number(a);
          hi = Number(b);
        } else {
          lo = hi = Number(range);
        }
      }
      if (val < lo || val > hi) continue;
      if ((val - lo) % step === 0) return true;
    }
    return false;
  };
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after
  const limit = from + 366 * 24 * 60 * 60_000;
  while (d.getTime() <= limit) {
    if (
      matches(d.getMinutes(), minF, 0, 59) &&
      matches(d.getHours(), hrF, 0, 23) &&
      matches(d.getDate(), domF, 1, 31) &&
      matches(d.getMonth() + 1, monF, 1, 12) &&
      matches(d.getDay(), dowF, 0, 6)
    ) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return from + 24 * 60 * 60_000;
}

/** True when the expression has five fields that each parse. */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((f) => /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/.test(f));
}
