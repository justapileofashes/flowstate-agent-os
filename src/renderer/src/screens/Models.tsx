import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type {
  ModelsCatalogResponse,
  CatalogModelDto,
  OllamaPullProgress,
  AgentAutoAssignMatchDto,
} from '@shared/ipc-channels';
import { fadeUp, staggerContainer } from '../lib/motion';

type FilterTag = 'all' | 'general' | 'code' | 'reasoning' | 'vision' | 'small';

interface DownloadState {
  status: 'downloading' | 'error';
  pct: number;
  cancel?: () => void;
  error?: string;
}

export function Models(): JSX.Element {
  const [data, setData] = useState<ModelsCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTag>('all');
  const [showAll, setShowAll] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [autoAssign, setAutoAssign] = useState<{
    running: boolean;
    matches: AgentAutoAssignMatchDto[] | null;
  }>({ running: false, matches: null });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ipc.models.catalog();
      setData(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function download(id: string): Promise<void> {
    if (downloads[id]?.status === 'downloading') return;
    setDownloads((d) => ({ ...d, [id]: { status: 'downloading', pct: 0 } }));
    try {
      const handle = await ipc.ollama.pull(
        id,
        (p: OllamaPullProgress) => {
          const pct =
            p.total && p.completed && p.total > 0
              ? Math.round((p.completed / p.total) * 100)
              : 0;
          setDownloads((d) => ({
            ...d,
            [id]: { status: 'downloading', pct, cancel: d[id]?.cancel },
          }));
        },
        (end) => {
          if (end.ok) {
            setDownloads((d) => {
              const next = { ...d };
              delete next[id];
              return next;
            });
            void refresh();
          } else {
            setDownloads((d) => ({
              ...d,
              [id]: { status: 'error', pct: 0, error: end.error ?? 'Download failed' },
            }));
          }
        },
      );
      setDownloads((d) => ({
        ...d,
        [id]: { ...(d[id] ?? { status: 'downloading', pct: 0 }), cancel: handle.cancel },
      }));
    } catch (err) {
      setDownloads((d) => ({
        ...d,
        [id]: {
          status: 'error',
          pct: 0,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  if (loading || !data) {
    return (
      <div className="h-full overflow-y-auto px-8 py-10 max-w-7xl mx-auto">
        <div className="text-sm text-[var(--ink-muted)]">Scanning your hardware…</div>
      </div>
    );
  }

  const { hardware, catalog, recommendations } = data;
  const recIds = new Set(
    [recommendations.balanced, recommendations.code, recommendations.fast].filter(
      (x): x is string => Boolean(x),
    ),
  );

  const filtered = catalog.filter((c) => {
    if (filter === 'all') return true;
    return c.model.tags.includes(filter);
  });

  // Default-collapse to runnable + recommended unless showAll
  const visible = showAll
    ? filtered
    : filtered.filter((c) => c.fit !== 'no' || recIds.has(c.model.id));

  return (
    <div className="screen-enter h-full overflow-y-auto models-page">
      <motion.header
        className="mb-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="eyebrow">Hardware</div>
        <h2 className="section-title" style={{ marginBottom: 24, fontSize: 32 }}>
          This machine
        </h2>
      </motion.header>

      <HardwareCard hardware={hardware} />

      <section className="card mt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold">
              Auto-assign models
            </div>
            <p className="text-sm text-[var(--ink-muted)] mt-1">
              Pick the best installed model for every agent based on this hardware + each
              agent&apos;s purpose.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary text-xs"
            disabled={autoAssign.running}
            onClick={async () => {
              setAutoAssign({ running: true, matches: null });
              try {
                const res = await ipc.models.autoAssignAgents();
                setAutoAssign({ running: false, matches: res.matches });
              } catch (err) {
                setAutoAssign({ running: false, matches: [] });
                // eslint-disable-next-line no-console
                console.warn(err);
              }
            }}
          >
            {autoAssign.running ? 'Assigning…' : 'Auto-assign now'}
          </button>
        </div>

        {autoAssign.matches ? (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            {autoAssign.matches.filter((m) => m.changed).length === 0 ? (
              <div className="text-xs text-[var(--ink-muted)]">
                All agents already on a good fit.
              </div>
            ) : (
              <ul className="text-xs space-y-1.5">
                {autoAssign.matches
                  .filter((m) => m.changed)
                  .map((m) => (
                    <li key={m.agentId} className="flex items-start gap-2">
                      <span className="text-[var(--accent)] mt-0.5">→</span>
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{m.agentName}</span>{' '}
                        <span className="text-[var(--ink-muted)]">
                          {m.previousModel || '(none)'} → {m.pickedModel}
                        </span>
                        <div className="text-[10px] text-[var(--ink-faint)] mt-0.5">
                          {m.reason}
                        </div>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>

      {recIds.size > 0 ? (
        <>
          <div className="row mb-4 mt-6" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 style={{ fontWeight: 400, fontSize: 20, color: 'var(--ink-strong)', margin: 0 }}>Recommended for you</h3>
            <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              based on {hardware.primaryVramGB > 0 ? `${hardware.primaryVramGB.toFixed(0)} GB VRAM · ` : ''}{hardware.ramGB.toFixed(0)} GB RAM{hardware.perfFactor && hardware.perfFactor !== 1 ? ` · ${hardware.perfFactor.toFixed(1)}× speed` : ''}
            </span>
          </div>
          <motion.div className="recco-grid mb-6" variants={staggerContainer} initial="hidden" animate="visible">
            {(['balanced', 'code', 'fast'] as const).map((slot) => {
              const id = recommendations[slot];
              if (!id) return null;
              const entry = catalog.find((c) => c.model.id === id);
              if (!entry) return null;
              const slotLabel = slot === 'balanced' ? 'Best overall' : slot === 'code' ? 'Best for code' : 'Fastest';
              return (
                <motion.div key={slot} variants={fadeUp} className="recco-card">
                  <div className="slot">{slotLabel}</div>
                  <div className="mname">{entry.model.name}</div>
                  <div className="muted text-xs mt-1">
                    {entry.model.sizeGB.toFixed(1)} GB · {entry.fit === 'gpu' ? 'GPU' : entry.fit === 'partial' ? 'partial' : entry.fit === 'cpu' ? 'CPU' : 'too big'} fit
                  </div>
                  <div className="col gap-2 mt-3">
                    <div className="model-bar">
                      speed
                      <div className="bar"><div className="fill" style={{ width: `${Math.min(100, entry.estTokPerSec * 1.5)}%` }} /></div>
                    </div>
                    <div className="model-bar">
                      quality
                      <div className="bar"><div className="fill" style={{ width: `${entry.model.quality * 20}%` }} /></div>
                    </div>
                  </div>
                  {entry.installed ? (
                    <button type="button" className="btn mt-3" style={{ width: '100%', justifyContent: 'center' }} disabled>
                      Installed
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary mt-3"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => void download(entry.model.id)}
                      disabled={entry.fit === 'no'}
                    >
                      Download
                    </button>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        </>
      ) : null}

      <div className="row mb-4" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h3 style={{ fontWeight: 400, fontSize: 20, color: 'var(--ink-strong)', margin: 0 }}>All models</h3>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
          {(['all', 'general', 'code', 'reasoning', 'vision', 'small'] as FilterTag[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilter(t)}
              className={'btn btn-sm ' + (filter === t ? '' : 'btn-ghost')}
            >
              {t}
            </button>
          ))}
          <label className="row gap-2 text-xs text-[var(--ink-muted)] cursor-pointer select-none" style={{ marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Show too-big
          </label>
        </div>
      </div>

      <motion.div className="col gap-2" variants={staggerContainer} initial="hidden" animate="visible">
        {visible.map((entry) => (
          <motion.div key={entry.model.id} variants={fadeUp}>
            <ModelBarRow
              entry={entry}
              download={downloads[entry.model.id]}
              onDownload={() => void download(entry.model.id)}
            />
          </motion.div>
        ))}
      </motion.div>

      {visible.length === 0 ? (
        <div className="text-sm text-[var(--ink-muted)] py-6 text-center">
          No models match. Try a different filter or show models that won&apos;t fit.
        </div>
      ) : null}

      <LibraryBrowse downloads={downloads} onDownload={download} />
    </div>
  );
}

interface LibraryEntry {
  name: string;
  description: string;
  pullCount: string;
  tagCount: number;
  sizes: string[];
  capabilities: string[];
  updatedAt: string;
}

function LibraryBrowse({
  downloads,
  onDownload,
}: {
  downloads: Record<string, DownloadState>;
  onDownload: (id: string) => Promise<void>;
}): JSX.Element {
  const [models, setModels] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipc.ollama.librarySearch(q, 120);
      setModels(res.models);
      if (res.error) setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded) void load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const id = setTimeout(() => void load(query), 250);
    return () => clearTimeout(id);
  }, [query, expanded, load]);

  return (
    <section className="mt-8">
      <div
        className="row mb-3"
        style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}
      >
        <div>
          <h3 style={{ fontWeight: 400, fontSize: 20, color: 'var(--ink-strong)', margin: 0 }}>
            Browse the Ollama library
          </h3>
          <div className="muted text-xs mt-1">
            Pull any model from ollama.com — pick a size variant after install.
          </div>
        </div>
        <button
          type="button"
          className={'btn btn-sm ' + (expanded ? '' : 'btn-primary')}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Hide library' : 'Browse library'}
        </button>
      </div>

      {expanded ? (
        <>
          <div className="row gap-2 mb-3">
            <input
              className="field"
              placeholder="Search 200+ models (llama, qwen, deepseek, mistral, gemma, phi, …)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void load(query)}
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
          {error ? (
            <div className="text-[11px] text-[var(--bad)] mb-2">{error}</div>
          ) : null}
          {loading && models.length === 0 ? (
            <div className="muted text-sm py-6 text-center">Fetching ollama.com/library…</div>
          ) : models.length === 0 ? (
            <div className="muted text-sm py-6 text-center">No models match this search.</div>
          ) : (
            <div className="col gap-2">
              {models.map((m) => (
                <LibraryRow
                  key={m.name}
                  entry={m}
                  downloads={downloads}
                  onDownload={(tag) => void onDownload(tag)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function LibraryRow({
  entry,
  downloads,
  onDownload,
}: {
  entry: LibraryEntry;
  downloads: Record<string, DownloadState>;
  onDownload: (tag: string) => void;
}): JSX.Element {
  const [pickSize, setPickSize] = useState<string>(entry.sizes[0] ?? '');
  const targetTag = pickSize ? `${entry.name}:${pickSize.toLowerCase()}` : entry.name;
  const download = downloads[targetTag];
  return (
    <div
      className="card"
      style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr 220px 160px', alignItems: 'center', gap: 16 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ color: 'var(--ink-strong)', fontWeight: 500 }}>{entry.name}</div>
        <div className="muted text-xs" style={{ marginTop: 2 }}>
          {entry.description || '—'}
        </div>
        <div className="row gap-1 mt-2" style={{ flexWrap: 'wrap' }}>
          {entry.capabilities.map((c) => (
            <span key={c} className="pill" style={{ height: 18, padding: '0 6px', fontSize: 10 }}>
              <span>{c}</span>
            </span>
          ))}
          {entry.pullCount ? (
            <span className="text-[10px] text-[var(--ink-faint)] mono" style={{ marginLeft: 4 }}>
              {entry.pullCount} pulls
            </span>
          ) : null}
        </div>
      </div>
      <div>
        {entry.sizes.length > 0 ? (
          <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
            {entry.sizes.slice(0, 6).map((s) => (
              <button
                key={s}
                type="button"
                className={'btn btn-sm ' + (pickSize === s ? '' : 'btn-ghost')}
                style={{ padding: '0 8px', fontSize: 11 }}
                onClick={() => setPickSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted text-xs">latest</span>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {download?.status === 'downloading' ? (
          <div style={{ minWidth: 140 }}>
            <div className="model-bar">
              <div className="bar">
                <div className="fill" style={{ width: `${download.pct}%`, background: 'var(--accent)' }} />
              </div>
            </div>
            <div className="muted text-xs mt-1" style={{ textAlign: 'right' }}>
              {download.pct}%
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onDownload(targetTag)}
            title={`ollama pull ${targetTag}`}
          >
            Pull {targetTag.length > 22 ? targetTag.slice(0, 20) + '…' : targetTag}
          </button>
        )}
      </div>
    </div>
  );
}

// Trim vendor noise from a raw CPU model string for display.
// "13th Gen Intel(R) Core(TM) i7-14700KF" -> "13th Gen Intel Core i7-14700KF"
function cleanCpuModel(raw: string): string {
  return raw
    .replace(/\((R|TM|tm|r)\)/g, '')
    .replace(/\bCPU\b/g, '')
    .replace(/\bProcessor\b/gi, '')
    .replace(/@.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function HardwareCard({ hardware }: { hardware: ModelsCatalogResponse['hardware'] }): JSX.Element {
  const gpuName = hardware.gpus[0]?.name ?? 'No GPU';
  const cpuModel = cleanCpuModel(hardware.cpuModel || 'Unknown CPU');
  const stats: Array<{ label: string; value: string; sub: string; small?: boolean }> = [
    { label: 'GPU', value: gpuName.length > 18 ? gpuName.slice(0, 18) + '…' : gpuName, sub: hardware.primaryVramGB > 0 ? `${hardware.primaryVramGB.toFixed(1)} GB VRAM` : 'no VRAM' },
    { label: 'CPU', value: cpuModel, sub: `${hardware.cpuCount} cores`, small: true },
    { label: 'RAM', value: `${hardware.ramGB.toFixed(1)} GB`, sub: 'system' },
    { label: 'VRAM', value: hardware.primaryVramGB > 0 ? `${hardware.primaryVramGB.toFixed(1)} GB` : '—', sub: 'dedicated' },
  ];
  return (
    <>
      <div className="hw-card">
        {stats.map((s) => (
          <div className="hw-stat" key={s.label}>
            <div className="label">{s.label}</div>
            <div
              className="value"
              title={s.label === 'CPU' ? hardware.cpuModel : undefined}
              style={s.small ? { fontSize: 15, lineHeight: 1.3 } : undefined}
            >
              {s.value}
            </div>
            <div className="sub">{s.sub}</div>
          </div>
        ))}
      </div>
      <SpecDetails hardware={hardware} />
      {hardware.detectionNotes.length > 0 ? (
        <div className="mt-2 text-[11px] text-[var(--ink-faint)]">
          {hardware.detectionNotes.join(' ')}
        </div>
      ) : null}
    </>
  );
}

function SpecRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div
      className="row"
      style={{ alignItems: 'baseline', gap: 12, padding: '7px 0', borderTop: '1px solid var(--border)' }}
    >
      <span
        className="mono"
        style={{ width: 86, flex: '0 0 auto', fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink)', minWidth: 0 }}>{value}</span>
    </div>
  );
}

function SpecDetails({ hardware }: { hardware: ModelsCatalogResponse['hardware'] }): JSX.Element | null {
  const { cpu, gpus, ramModules } = hardware;
  const rows: Array<{ label: string; value: string }> = [];

  if (cpu) {
    const parts: string[] = [];
    if (cpu.physicalCores > 0) parts.push(`${cpu.physicalCores} cores`);
    if (cpu.logicalCores > 0) parts.push(`${cpu.logicalCores} threads`);
    if (cpu.maxClockMHz > 0) parts.push(`${(cpu.maxClockMHz / 1000).toFixed(2)} GHz`);
    if (cpu.l3CacheKB > 0) parts.push(`L3 ${(cpu.l3CacheKB / 1024).toFixed(0)} MB`);
    rows.push({ label: 'CPU', value: cpu.model });
    if (parts.length > 0) rows.push({ label: '', value: parts.join(' · ') });
  }

  for (const g of gpus) {
    const parts = [`${(g.vramMB / 1024).toFixed(1)} GB VRAM`];
    if (g.driverVersion) parts.push(`driver ${g.driverVersion}`);
    rows.push({ label: 'GPU', value: `${g.name} — ${parts.join(' · ')}` });
  }

  for (const m of ramModules ?? []) {
    const spec = `${m.capacityGB} GB ${m.type}${m.speedMHz ? `-${m.speedMHz}` : ''}`;
    const tail = [m.manufacturer, m.partNumber].filter((x) => x && x !== '—').join(' ');
    rows.push({ label: m.slot || 'RAM', value: tail ? `${spec} · ${tail}` : spec });
  }

  if (rows.length === 0) return null;

  return (
    <section className="card mt-4" style={{ padding: '4px 16px 12px' }}>
      <div
        className="mono mt-2"
        style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-faint)', padding: '8px 0 2px' }}
      >
        Component specs
      </div>
      {rows.map((r, i) => (
        <SpecRow key={i} label={r.label} value={r.value} />
      ))}
    </section>
  );
}

function ModelBarRow({
  entry,
  download,
  onDownload,
}: {
  entry: CatalogModelDto;
  download: DownloadState | undefined;
  onDownload: () => void;
}): JSX.Element {
  const { model, fit, estTokPerSec, installed } = entry;
  return (
    <div
      className="card"
      style={{
        padding: 14,
        display: 'grid',
        gridTemplateColumns: '1fr 100px 220px 140px',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <div>
        <div style={{ color: 'var(--ink-strong)', fontWeight: 500 }}>{model.name}</div>
        <div className="muted text-xs">
          {model.sizeGB.toFixed(1)} GB ·{' '}
          {fit === 'gpu' ? 'GPU' : fit === 'partial' ? 'partial' : fit === 'cpu' ? 'CPU' : 'too big'} fit
        </div>
      </div>
      <div className="row gap-2">
        <span className="pill" style={installed ? { color: 'var(--good)' } : undefined}>
          {installed ? 'installed' : 'available'}
        </span>
      </div>
      <div className="col gap-1">
        <div className="model-bar">
          spd
          <div className="bar">
            <div className="fill" style={{ width: `${Math.min(100, estTokPerSec * 1.5)}%` }} />
          </div>
        </div>
        <div className="model-bar">
          qty
          <div className="bar">
            <div className="fill" style={{ width: `${model.quality * 20}%` }} />
          </div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {installed ? (
          <button type="button" className="btn btn-sm" disabled>
            Manage
          </button>
        ) : download?.status === 'downloading' ? (
          <div style={{ minWidth: 140 }}>
            <div className="model-bar">
              <div className="bar">
                <div
                  className="fill"
                  style={{ width: `${download.pct}%`, background: 'var(--accent)' }}
                />
              </div>
            </div>
            <div className="muted text-xs mt-1" style={{ textAlign: 'right' }}>
              {download.pct}%
            </div>
          </div>
        ) : download?.status === 'error' ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={onDownload}>
            Retry
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={onDownload}
            disabled={fit === 'no'}
          >
            Download
          </button>
        )}
      </div>
    </div>
  );
}

interface ModelCardProps {
  entry: CatalogModelDto;
  highlight?: string;
  download: DownloadState | undefined;
  onDownload: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ModelCard({ entry, highlight, download, onDownload }: ModelCardProps): JSX.Element {
  const { model, fit, estTokPerSec, installed, reason } = entry;
  const fitLabel =
    fit === 'gpu' ? 'GPU' : fit === 'partial' ? 'Partial GPU' : fit === 'cpu' ? 'CPU only' : 'Too big';
  const fitClass =
    fit === 'gpu'
      ? 'pill pill-good'
      : fit === 'no'
        ? 'pill pill-bad'
        : 'text-[10px] px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--ink-muted)]';

  return (
    <div className="card flex flex-col h-full">
      {highlight ? (
        <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--accent)] font-semibold mb-1.5">
          {highlight}
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="text-base font-semibold tracking-tight">{model.name}</h3>
        <span className={fitClass}>{fitLabel}</span>
      </div>
      <code className="text-[11px] text-[var(--ink-faint)] mb-2">{model.id}</code>
      <p className="text-xs text-[var(--ink-muted)] line-clamp-3 mb-3">{model.description}</p>

      <div className="grid grid-cols-3 gap-2 text-xs mb-3">
        <Metric label="Size" value={`${model.sizeGB.toFixed(1)} GB`} />
        <Metric
          label="Speed"
          value={fit !== 'no' ? `${estTokPerSec} tok/s` : '—'}
        />
        <Metric label="Quality" value={<QualityBars n={model.quality} />} />
      </div>

      <div className="flex flex-wrap gap-1 mb-3">
        {model.tags.map((t) => (
          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--ink-muted)]">
            {t}
          </span>
        ))}
        {model.toolsCapable ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--ink-muted)]">
            tools
          </span>
        ) : null}
      </div>

      <div className="text-[10px] text-[var(--ink-faint)] mb-3">{reason}</div>

      <div className="mt-auto">
        {installed ? (
          <button type="button" className="btn w-full justify-center text-xs" disabled>
            Installed
          </button>
        ) : download?.status === 'downloading' ? (
          <div>
            <div className="w-full bg-[var(--surface-2)] rounded h-2 overflow-hidden">
              <div
                className="bg-[var(--accent)] h-full transition-all"
                style={{ width: `${download.pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-[var(--ink-muted)]">
              <span>Downloading… {download.pct}%</span>
              <button
                type="button"
                className="hover:text-[var(--bad)]"
                onClick={() => download.cancel?.()}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : download?.status === 'error' ? (
          <div>
            <div className="text-[10px] text-[var(--bad)] mb-1.5">{download.error}</div>
            <button
              type="button"
              className="btn btn-primary w-full justify-center text-xs"
              onClick={onDownload}
            >
              Retry
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary w-full justify-center text-xs"
            onClick={onDownload}
            disabled={fit === 'no'}
          >
            Download
          </button>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--ink-faint)]">
        {label}
      </span>
      <span className="text-xs font-medium text-[var(--ink)] tabular-nums">{value}</span>
    </div>
  );
}

function QualityBars({ n }: { n: number }): JSX.Element {
  return (
    <span className="inline-flex gap-0.5 items-end h-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-1 rounded-sm ${i <= n ? 'bg-[var(--accent)]' : 'bg-[var(--surface-2)]'}`}
          style={{ height: `${20 + i * 16}%` }}
        />
      ))}
    </span>
  );
}
