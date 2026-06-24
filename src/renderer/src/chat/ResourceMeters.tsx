// Surface 3 — live system meters (Dashboard): CPU / RAM / GPU, so the user
// can see what local models cost the machine. Polls ipc.system.stats() every
// 2.5s; the interval is torn down on unmount, so polling pauses the moment you
// navigate away from the Dashboard. First call reads ~0% CPU (percentages are
// interval-deltas) — rendered as-is. GPU card hides entirely when gpu is null.
// Design source: Claude Design handoff (system-surfaces.jsx).

import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type { SystemStatsGetResponse } from '@shared/ipc-channels';

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function Meter({
  label,
  meta,
  value,
  pct,
}: {
  label: string;
  meta?: string;
  value: string;
  pct: number;
}): JSX.Element {
  return (
    <div className="rm-card">
      <div className="rm-top">
        <span className="rm-label">{label}</span>
        {meta ? <span className="rm-meta">{meta}</span> : null}
      </div>
      <div className="rm-value">{value}</div>
      <div className="rm-bar">
        <div className="rm-fill" style={{ width: `${clamp(pct, 0, 100)}%` }} />
      </div>
    </div>
  );
}

export function ResourceMeters(): JSX.Element {
  const [stats, setStats] = useState<SystemStatsGetResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async (): Promise<void> => {
      try {
        const s = await ipc.system.stats();
        if (alive) setStats(s);
      } catch {
        // keep last good reading
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 2500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const gb = (mb: number): string => (mb / 1024).toFixed(1);
  const cpu = stats ? stats.cpuPct : null;
  const ramPct = stats ? (stats.ramUsedMB / stats.ramTotalMB) * 100 : 0;
  const gpu = stats ? stats.gpu : null;
  const gpuPct = gpu ? (gpu.vramUsedMB / gpu.vramTotalMB) * 100 : 0;

  return (
    <div className={'rm-strip' + (stats && !gpu ? ' rm-2up' : '')}>
      <Meter label="CPU" value={cpu == null ? '—' : `${cpu}%`} pct={cpu ?? 0} />
      <Meter
        label="RAM"
        meta={stats ? `${Math.round(ramPct)}%` : undefined}
        value={stats ? `${gb(stats.ramUsedMB)} / ${gb(stats.ramTotalMB)} GB` : '—'}
        pct={ramPct}
      />
      {gpu ? (
        <Meter
          label="GPU"
          meta={`${gpu.utilPct}% util`}
          value={`${gb(gpu.vramUsedMB)} / ${gb(gpu.vramTotalMB)} GB VRAM`}
          pct={gpuPct}
        />
      ) : null}
    </div>
  );
}
