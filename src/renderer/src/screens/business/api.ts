// Renderer-side client for the business agent: a typed RPC wrapper that
// throws on error, a data hook with reload, and the live context (company,
// version counter bumped on change events, live feed) shared by all tabs.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ipc } from '../../lib/ipc';
import type { BizEvent, BizMethod, BizRequest, BizResponses } from '@shared/business/api';
import type { CompanyDto, FeedEventDto } from '@shared/business/types';

export async function biz<M extends BizMethod>(method: M, params: BizRequest<M>): Promise<BizResponses[M]> {
  const r = await ipc.business.rpc(method, params);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export interface BizLive {
  company: CompanyDto;
  /** Bumped (debounced) whenever main reports a change for this company. */
  version: number;
  feed: FeedEventDto[];
  refresh: () => void;
  openApprovals: () => void;
  goTab: (tab: BizTab) => void;
  /** Jump to CEO chat with a prefilled question. */
  askCeo: (prompt: string) => void;
  chatPrefill: string;
  clearPrefill: () => void;
}

export type BizTab = 'overview' | 'timeline' | 'tasks' | 'outputs' | 'knowledge' | 'usage' | 'chat' | 'settings';

export const BizLiveContext = createContext<BizLive | null>(null);

export function useBizLive(): BizLive {
  const v = useContext(BizLiveContext);
  if (!v) throw new Error('BizLiveContext missing');
  return v;
}

/** Subscribe to main → renderer business events for one company. */
export function useBizEvents(companyId: string | null, onEvent: (ev: BizEvent) => void): void {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!companyId) return;
    return ipc.business.subscribe((ev) => {
      const id = ev.type === 'feed' ? ev.event.companyId : ev.companyId;
      if (id === companyId) cb.current(ev);
    });
  }, [companyId]);
}

/** Load data for an RPC method; re-runs when deps (incl. live version) change. */
export function useBiz<M extends BizMethod>(
  method: M,
  params: BizRequest<M> | null,
  deps: unknown[],
): { data: BizResponses[M] | null; error: string; loading: boolean; reload: () => void } {
  const [data, setData] = useState<BizResponses[M] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!params) return;
    let alive = true;
    setLoading(true);
    biz(method, params)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError('');
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, key, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

// ── formatting ──────────────────────────────────────────────────────────────

export function fmtCredits(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (Math.abs(n) >= 100) return Math.round(n).toLocaleString();
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/\.?0+$/, '') || '0';
}

export function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '<$0.01';
  return `$${n.toFixed(2)}`;
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const s = Math.round((now - ts) / 1000);
  if (s < 0) return fmtIn(ts, now);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function fmtIn(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  if (s <= 60) return 'now';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86_400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86_400)}d`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
