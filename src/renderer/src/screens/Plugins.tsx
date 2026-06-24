import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import type {
  PluginDto,
  PluginMarketplaceDto,
  PluginMarketplacePluginDto,
  PluginSkillDto,
} from '@shared/ipc-channels';

// Visual: Flowstate v2 redesign (plugins-screen.jsx). Wired to the real
// ipc.plugins.* bridge — the design mock stubbed the IPC.

function isGit(source: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(source) || source.endsWith('.git');
}

function Switch({
  on,
  tone,
  onClick,
  title,
  disabled,
}: {
  on: boolean;
  tone?: 'bad';
  onClick: () => void;
  title: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      disabled={disabled}
      style={{
        width: 34,
        height: 20,
        borderRadius: 999,
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        flex: '0 0 auto',
        position: 'relative',
        appearance: 'none',
        opacity: disabled ? 0.5 : 1,
        border: '1px solid ' + (on ? 'transparent' : 'var(--border-strong)'),
        background: on ? (tone === 'bad' ? 'var(--bad)' : 'var(--accent)') : 'var(--surface-3)',
        transition: 'background .2s var(--ease), border-color .2s var(--ease)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 16 : 2,
          width: 14,
          height: 14,
          borderRadius: 999,
          background: on ? '#14110d' : 'var(--ink-faint)',
          transition: 'left .2s var(--ease), background .2s var(--ease)',
        }}
      />
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10,
        color: 'var(--ink-faint)',
        padding: '2px 7px',
        borderRadius: 4,
        background: 'rgba(240,236,226,0.03)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </span>
  );
}

function Hdr({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      className="mono"
      style={{
        fontSize: 10.5,
        letterSpacing: '.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint)',
        margin: '30px 0 12px',
      }}
    >
      {children}
    </div>
  );
}

function compBadges(c: PluginDto['components']): string[] {
  const out: string[] = [];
  if (c.skills) out.push(c.skills + ' skill' + (c.skills > 1 ? 's' : ''));
  if (c.commands) out.push(c.commands + ' command' + (c.commands > 1 ? 's' : ''));
  if (c.agents) out.push(c.agents + ' agent' + (c.agents > 1 ? 's' : ''));
  if (c.mcp) out.push(c.mcp + ' mcp');
  if (c.hooks) out.push('hooks');
  return out;
}

export function Plugins(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginDto[]>([]);
  const [marketplaces, setMarketplaces] = useState<PluginMarketplaceDto[]>([]);
  const [available, setAvailable] = useState<PluginMarketplacePluginDto[]>([]);
  const [skills, setSkills] = useState<PluginSkillDto[]>([]);
  const [src, setSrc] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, m, s] = await Promise.all([
        ipc.plugins.list(),
        ipc.plugins.marketplaces(),
        ipc.plugins.listSkills(),
      ]);
      setPlugins(p.plugins);
      setMarketplaces(m.marketplaces);
      setSkills(s.skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const refreshBrowse = useCallback(async () => {
    try {
      const res = await ipc.plugins.browse(query || undefined);
      setAvailable(res.plugins);
    } catch {
      setAvailable([]);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
    const unsub = ipc.plugins.subscribeStatus((p) => setPlugins(p.plugins));
    return unsub;
  }, [refresh]);

  useEffect(() => {
    void refreshBrowse();
  }, [refreshBrowse, marketplaces.length]);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      await refreshBrowse();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addSource = (): void => {
    const s = src.trim();
    if (!s) return;
    void run(async () => {
      await ipc.plugins.addMarketplace(s);
      setSrc('');
    });
  };

  // plugins available per marketplace, for the count column
  const countFor = (id: string): number => available.filter((b) => b.marketplaceId === id).length;

  return (
    <div className="screen-enter" style={{ padding: '32px 48px 80px', maxWidth: 1100, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <div className="eyebrow">Plugins &amp; skills</div>
      <h2 className="section-title" style={{ marginBottom: 8, fontSize: 32 }}>
        Skills &amp; plugins, run locally
      </h2>
      <p className="muted mt-3" style={{ maxWidth: 580 }}>
        Claude Code-format plugins — skills, commands, agents and MCP servers. Marketplaces are git
        clones fetched only when you ask. Anything that runs shell commands stays off until you allow
        it.
      </p>

      {error ? (
        <div className="card" style={{ padding: 12, marginTop: 16, borderColor: 'var(--bad)' }}>
          <span className="text-xs" style={{ color: 'var(--bad)' }}>{error}</span>
        </div>
      ) : null}

      {/* Marketplaces */}
      <Hdr>Marketplaces</Hdr>
      <div className="card" style={{ padding: 14 }}>
        {marketplaces.length === 0 ? (
          <div className="muted text-xs">No marketplaces yet. Add a git URL or folder below.</div>
        ) : (
          marketplaces.map((m, i) => (
            <div
              key={m.id}
              className="row gap-3"
              style={{ alignItems: 'center', padding: '9px 0', borderTop: i ? '1px solid var(--border)' : 'none' }}
            >
              <span className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', width: 46 }}>
                {isGit(m.source) ? 'git' : 'local'}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: 'var(--ink-strong)', fontWeight: 500 }}>{m.name}</div>
                <div className="muted text-xs mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {m.source}
                </div>
              </div>
              <span className="muted text-xs mono">{countFor(m.id)} plugins</span>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => ipc.plugins.refreshMarketplace(m.id))}>
                Refresh
              </button>
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => ipc.plugins.removeMarketplace(m.id))}>
                Remove
              </button>
            </div>
          ))
        )}
        <div className="row gap-2" style={{ marginTop: 12, alignItems: 'center' }}>
          <input
            className="field"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addSource()}
            placeholder="git URL or absolute folder path…"
            style={{ flex: 1 }}
          />
          <button className="btn btn-sm btn-primary" disabled={busy || !src.trim()} onClick={addSource}>
            Add source
          </button>
        </div>
      </div>

      {/* Browse & install */}
      <Hdr>Browse &amp; install</Hdr>
      <div className="row gap-2 mb-4" style={{ alignItems: 'center' }}>
        <input
          className="field"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search plugins across marketplaces…"
          style={{ width: 320 }}
        />
        <span className="muted text-xs mono" style={{ marginLeft: 'auto' }}>{available.length} available</span>
      </div>
      {available.length === 0 ? (
        <div className="muted text-xs">No plugins available. Add a marketplace above.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {available.map((b) => (
            <div key={`${b.marketplaceId}/${b.name}`} className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-strong)', fontWeight: 500 }}>{b.name}</div>
                  <div className="muted text-xs mono" style={{ marginTop: 2 }}>{b.marketplaceId}</div>
                </div>
                {b.installed ? (
                  <span className="pill good"><span className="dot" /> installed</span>
                ) : (
                  <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(() => ipc.plugins.install(b.marketplaceId, b.name))}>
                    Install
                  </button>
                )}
              </div>
              <div className="muted text-xs" style={{ lineHeight: 1.5 }}>{b.description || '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Installed */}
      <Hdr>Installed · {plugins.length}</Hdr>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {plugins.length === 0 ? (
          <div className="muted text-xs">Nothing installed yet.</div>
        ) : (
          plugins.map((p) => (
            <div key={p.id} className="card" style={{ padding: 15 }}>
              <div className="row gap-3" style={{ alignItems: 'center' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row gap-2" style={{ alignItems: 'center' }}>
                    <span style={{ fontSize: 14, color: 'var(--ink-strong)', fontWeight: 500 }}>{p.name}</span>
                    {p.readOnly ? (
                      <span className="mono" style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-faint)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--border)' }}>
                        discovered
                      </span>
                    ) : null}
                  </div>
                  <div className="muted text-xs mono" style={{ marginTop: 3 }}>
                    {p.origin}
                    {p.version ? ' · v' + p.version : p.readOnly ? ' · read-only' : ''}
                  </div>
                </div>
                <Switch on={p.enabled} disabled={busy} onClick={() => void run(() => ipc.plugins.setEnabled(p.id, !p.enabled))} title={p.enabled ? 'Disable' : 'Enable'} />
              </div>

              <div className="row gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                {compBadges(p.components).map((c, i) => (
                  <Badge key={i}>{c}</Badge>
                ))}
              </div>

              {p.components.hooks > 0 ? (
                <div
                  className="row gap-3"
                  style={{ alignItems: 'center', justifyContent: 'space-between', marginTop: 12, padding: '9px 12px', borderRadius: 8, border: '1px solid rgba(160,130,120,0.32)', background: 'rgba(160,130,120,0.08)' }}
                >
                  <span className="mono row gap-2" style={{ fontSize: 11, color: 'var(--bad)', alignItems: 'center' }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flex: '0 0 auto' }}>
                      <path d="M7 1.5 13 12H1L7 1.5Z" stroke="currentColor" strokeLinejoin="round" />
                      <path d="M7 5.5v3 M7 10.2v.2" stroke="currentColor" strokeLinecap="round" />
                    </svg>
                    Runs shell commands on your machine
                  </span>
                  <Switch on={p.hooksConsent} tone="bad" disabled={busy} onClick={() => void run(() => ipc.plugins.setHooksConsent(p.id, !p.hooksConsent))} title={p.hooksConsent ? 'Revoke hooks consent' : 'Allow hooks'} />
                </div>
              ) : null}

              {p.components.agents > 0 || !p.readOnly ? (
                <div className="row gap-2" style={{ marginTop: 12 }}>
                  {p.components.agents > 0 ? (
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(async () => {
                      const r = await ipc.plugins.importAgents(p.id);
                      if (r.count === 0) throw new Error('No new agents to import (already present).');
                    })}>
                      Import {p.components.agents} agent{p.components.agents === 1 ? '' : 's'}
                    </button>
                  ) : null}
                  {!p.readOnly ? (
                    <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void run(() => ipc.plugins.uninstall(p.id))}>
                      Uninstall
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {/* Available skills */}
      <Hdr>Available skills</Hdr>
      <div className="card" style={{ padding: 6 }}>
        {skills.length === 0 ? (
          <div className="muted text-xs" style={{ padding: '11px 12px' }}>
            No skills yet. Install a plugin with skills, or drop one in ~/.claude/skills.
          </div>
        ) : (
          skills.map((s, i) => (
            <div key={s.name} className="row gap-3" style={{ alignItems: 'center', padding: '11px 12px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink)', width: 130, flex: '0 0 auto' }}>{s.name}</span>
              <span className="muted text-xs" style={{ flex: 1, minWidth: 0 }}>{s.description}</span>
              <span className="muted text-xs mono">{s.pluginId || 'standalone'}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
