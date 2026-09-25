// Renderer client for the AI Trader: typed RPC wrapper (throws the structured
// error's message), a data hook that reloads on push events, and formatters.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../../lib/ipc';
import type { TraderEvent, TraderMethod, TraderRequest, TraderResponses } from '@shared/trader/api';

export class TraderCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function tr<M extends TraderMethod>(method: M, params: TraderRequest<M>): Promise<TraderResponses[M]> {
  const r = await ipc.trader.rpc(method, params);
  if (!r.ok) throw new TraderCallError(r.error.code, r.error.message);
  return r.data;
}

/** Subscribe to main → renderer trader events. */
export function useTraderEvents(onEvent: (ev: TraderEvent) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => ipc.trader.subscribe((ev) => cb.current(ev)), []);
}

/** Load an RPC; reloads when `deps` change or when a matching push event arrives. */
export function useTr<M extends TraderMethod>(
  method: M,
  params: TraderRequest<M> | null,
  deps: unknown[] = [],
  reloadOn: Array<TraderEvent['type']> = [],
): { data: TraderResponses[M] | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<TraderResponses[M] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useTraderEvents((ev) => {
    if (!reloadOn.includes(ev.type)) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(reload, 300); // debounce bursts (one tick emits many events)
  });
  useEffect(() => {
    if (!params) return;
    let alive = true;
    setLoading(true);
    tr(method, params)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError('');
      })
      .catch((e: unknown) => {
        if (alive) setError(errText(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, tick, ...deps]);
  return { data, error, loading, reload };
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── formatting ──────────────────────────────────────────────────────────────

export function money(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signedMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
}

export function price(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export function signedPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`;
}

export function tone(n: number | null | undefined): '' | 'good' | 'bad' {
  if (n === null || n === undefined || !Number.isFinite(n) || Math.abs(n) < 1e-9) return '';
  return n > 0 ? 'good' : 'bad';
}

export function when(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const s = Math.round((now - ts) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 60) return 'in <1m';
    if (f < 3600) return `in ${Math.round(f / 60)}m`;
    return `in ${Math.round(f / 3600)}h`;
  }
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
