// Coding CLIs screen — detect installed AI coding/agentic CLIs (Claude Code,
// Codex, Gemini, Aider, …), connect them (so agents know they exist), and launch
// any of them straight into Flowstate's built-in terminal. Missing ones link to
// their install docs.

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { DetectedCliDto } from '@shared/ipc-channels';
import { TerminalPanel } from '../chat/TerminalPanel';

const CATEGORY_LABEL: Record<string, string> = {
  agentic: 'Agentic coders',
  assistant: 'Prompt & shell assistants',
  other: 'Other',
};

interface Launch {
  id: string;
  command: string;
  cwd: string;
}

export function CodingClis(): JSX.Element {
  const [clis, setClis] = useState<DetectedCliDto[] | null>(null);
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const [homeDir, setHomeDir] = useState('');
  const [cwd, setCwd] = useState('');
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setScanning(true);
    try {
      const [{ clis: detected }, state] = await Promise.all([ipc.clis.detect(), ipc.clis.get()]);
      setClis(detected);
      setConnected(new Set(state.connected));
      setHomeDir(state.homeDir);
      setCwd((prev) => prev || state.homeDir);
    } catch {
      setClis([]);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(async (next: Set<string>) => {
    setConnected(next);
    try {
      await ipc.clis.connect([...next]);
    } catch {
      // best-effort
    }
  }, []);

  const toggle = (id: string): void => {
    const next = new Set(connected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void persist(next);
  };

  const grouped = useMemo(() => {
    const by = new Map<string, DetectedCliDto[]>();
    for (const c of clis ?? []) {
      const arr = by.get(c.category) ?? [];
      arr.push(c);
      by.set(c.category, arr);
    }
    return [...by.entries()];
  }, [clis]);

  const installedCount = (clis ?? []).filter((c) => c.installed).length;

  if (launch) {
    return (
      <div className="screen-enter h-full" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ padding: '16px 24px', gap: 12, alignItems: 'center' }}>
          <button type="button" className="btn btn-sm" onClick={() => setLaunch(null)}>
            ← Back
          </button>
          <div className="nm">Running {launch.command}</div>
          <code className="muted text-xs mono">{launch.cwd}</code>
        </div>
        <div style={{ flex: 1, minHeight: 0, padding: '0 24px 24px' }}>
          <TerminalPanel
            id={`coding-cli-${launch.id}`}
            cwd={launch.cwd}
            initialCommand={launch.command}
            onClose={() => setLaunch(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="screen-enter h-full overflow-y-auto"
      style={{ padding: '32px 48px 80px', maxWidth: 1000, margin: '0 auto' }}
    >
      <motion.header
        className="mb-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="eyebrow">Coding CLIs</div>
        <h2 className="section-title" style={{ marginBottom: 8, fontSize: 32 }}>
          Your coding agents
        </h2>
        <p className="muted mt-3" style={{ maxWidth: 620 }}>
          Flowstate detects AI coding CLIs installed on your machine. Connect the ones you use —
          your agents learn they’re available, and you can launch any of them right inside
          Flowstate’s terminal.
        </p>
      </motion.header>

      <div className="row gap-3 mb-5" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Re-scan'}
        </button>
        {clis ? (
          <span className="muted text-xs">
            {installedCount} installed · {connected.size} connected
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <label className="row gap-2" style={{ alignItems: 'center' }}>
          <span className="muted text-xs">Launch in</span>
          <input
            className="field text-xs mono"
            style={{ width: 280 }}
            value={cwd}
            placeholder={homeDir || 'working directory'}
            onChange={(e) => setCwd(e.target.value)}
            spellCheck={false}
          />
        </label>
      </div>

      {clis === null ? (
        <div className="muted text-sm" style={{ padding: '32px 0' }}>Scanning for coding CLIs…</div>
      ) : null}

      {grouped.map(([cat, items]) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>
            {CATEGORY_LABEL[cat] ?? cat}
          </div>
          <div className="cnx-grid">
            {items.map((c) => {
              const isConn = connected.has(c.id);
              return (
                <div key={c.id} className="cnx-card">
                  <div className="row gap-3" style={{ alignItems: 'center' }}>
                    <div>
                      <div className="nm">{c.name}</div>
                      <div className="muted text-xs mono">
                        {c.installed
                          ? `${c.command}${c.version ? ` · v${c.version}` : ''}`
                          : 'not installed'}
                      </div>
                    </div>
                    <div style={{ flex: 1 }} />
                    {c.installed ? (
                      <span className="pill good"><span className="dot" /><span>found</span></span>
                    ) : null}
                  </div>
                  <div className="ds">{c.description}</div>
                  <div className="row" style={{ marginTop: 4, gap: 8 }}>
                    {c.docsUrl ? (
                      <a className="btn btn-sm btn-ghost" href={c.docsUrl} target="_blank" rel="noreferrer">
                        {c.installed ? 'Docs ↗' : 'Install ↗'}
                      </a>
                    ) : (
                      <span />
                    )}
                    <div style={{ flex: 1 }} />
                    {c.installed ? (
                      <>
                        <button
                          type="button"
                          className={'btn btn-sm ' + (isConn ? '' : 'btn-ghost')}
                          onClick={() => toggle(c.id)}
                        >
                          {isConn ? 'Connected' : 'Connect'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => setLaunch({ id: c.id, command: c.command, cwd: cwd || homeDir })}
                        >
                          Launch ▶
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {clis && installedCount === 0 ? (
        <div className="muted text-sm" style={{ padding: '8px 0' }}>
          No coding CLIs found on your PATH yet. Install one above (e.g. Claude Code, Aider, or
          Gemini CLI), then Re-scan.
        </div>
      ) : null}
    </div>
  );
}
