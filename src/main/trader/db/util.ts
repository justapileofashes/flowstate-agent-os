// Shared repo helpers (same conventions as the business agent's repos).
export { uid, parseJson, startOfDay, localDate, type Row } from '@main/business/db/util';

/** Finite number or the fallback (SQLite NULL / NaN guard). */
export function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
