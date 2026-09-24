// US equity market calendar (regular session 09:30–16:00 America/New_York,
// NYSE full holidays + early closes for 2025–2027) and bar-close math.
// Crypto trades 24/7. When a broker clock is available it wins; this is the
// fallback and the backtester's session model.

import type { AssetClass, Timeframe } from '@shared/trader/types';
import { TIMEFRAME_MS } from '@shared/trader/types';

const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);

/** 13:00 ET closes. */
const EARLY_CLOSES = new Set(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});

export interface EtParts {
  date: string; // YYYY-MM-DD (ET)
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(ts: number): EtParts {
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ts))) parts[p.type] = p.value;
  const y = Number(parts['year']);
  const m = Number(parts['month']);
  const d = Number(parts['day']);
  return {
    date: `${parts['year']}-${parts['month']}-${parts['day']}`,
    y,
    m,
    d,
    hh: Number(parts['hour']),
    mm: Number(parts['minute']),
    weekday: WEEKDAYS[parts['weekday'] ?? 'Mon'] ?? 1,
  };
}

/** Epoch ms of an ET wall-clock time (handles DST by probing both offsets). */
export function etToUtc(y: number, m: number, d: number, hh: number, mm: number): number {
  for (const offsetH of [4, 5]) {
    const guess = Date.UTC(y, m - 1, d, hh + offsetH, mm);
    const p = etParts(guess);
    if (p.hh === hh && p.mm === mm && p.d === d) return guess;
  }
  return Date.UTC(y, m - 1, d, hh + 5, mm);
}

export function isTradingDay(date: string, weekday: number): boolean {
  return weekday >= 1 && weekday <= 5 && !HOLIDAYS.has(date);
}

export interface Session {
  date: string;
  open: number;
  close: number;
}

/** The regular session containing `ts`'s ET date, or null on a non-trading day. */
export function sessionFor(ts: number): Session | null {
  const p = etParts(ts);
  if (!isTradingDay(p.date, p.weekday)) return null;
  return {
    date: p.date,
    open: etToUtc(p.y, p.m, p.d, 9, 30),
    close: etToUtc(p.y, p.m, p.d, EARLY_CLOSES.has(p.date) ? 13 : 16, 0),
  };
}

export function isMarketOpen(assetClass: AssetClass, now: number, extendedHours = false): boolean {
  if (assetClass === 'crypto') return true;
  const s = sessionFor(now);
  if (!s) return false;
  if (extendedHours) return now >= s.open - 5.5 * 3_600_000 && now < s.close + 4 * 3_600_000;
  return now >= s.open && now < s.close;
}

/** Next regular-session open strictly after `now` (searches 10 days). */
export function nextOpen(now: number): number | null {
  for (let i = 0; i < 10; i++) {
    const s = sessionFor(now + i * 86_400_000);
    if (s && s.open > now) return s.open;
  }
  return null;
}

export function currentClose(now: number): number | null {
  const s = sessionFor(now);
  return s && now < s.close ? s.close : null;
}

/** When a bar that opened at `ts` is complete. Intraday equity bars are cut at the session close. */
export function barEnd(ts: number, timeframe: Timeframe, assetClass: AssetClass): number {
  const end = ts + TIMEFRAME_MS[timeframe];
  if (assetClass === 'crypto' || timeframe === '1d') return end;
  const s = sessionFor(ts);
  return s && ts < s.close ? Math.min(end, s.close) : end;
}

/** Does an equity bar overlap the regular session? (Alpaca returns extended-hours bars.) */
export function inSession(ts: number, timeframe: Timeframe): boolean {
  if (timeframe === '1d') return true;
  const s = sessionFor(ts);
  if (!s) return false;
  return ts + TIMEFRAME_MS[timeframe] > s.open && ts < s.close;
}

/** Canonical daily bar timestamp: the ET trading date at 00:00 UTC. */
export function dailyTs(ts: number): number {
  const p = etParts(ts);
  return Date.UTC(p.y, p.m - 1, p.d);
}

/** Start of the most recent completed bar grid for a timeframe (tick alignment). */
export function lastBarCloseBoundary(now: number, timeframe: Timeframe): number {
  const tf = TIMEFRAME_MS[timeframe];
  return Math.floor(now / tf) * tf;
}
