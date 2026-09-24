// Small helpers shared by the business repos: ids, JSON columns, and dynamic
// UPDATE builders (camelCase patch → snake_case columns).

import { randomUUID } from 'node:crypto';

export type Row = Record<string, any>;

export const uid = (): string => randomUUID();

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSql(v: unknown): unknown {
  if (v === undefined) return undefined;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) return JSON.stringify(v);
  return v;
}

/** Build `UPDATE <table> SET a = ?, b = ? WHERE <where>` from a patch; keys
 *  not present in `columns` are ignored, undefined values are skipped. */
export function buildUpdate(
  table: string,
  where: string,
  patch: Record<string, unknown>,
  columns: Record<string, string>,
): { sql: string; values: unknown[] } | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = columns[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = ?`);
    values.push(toSql(value));
  }
  if (!sets.length) return null;
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`, values };
}

export function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** YYYY-MM-DD in local time (toISOString would give the UTC date). */
export function localDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function startOfMonth(now: number): number {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function clip(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…[+${s.length - max} chars]` : s;
}
