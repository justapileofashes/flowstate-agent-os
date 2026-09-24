// First-run CLI connect prompt. On first launch Flowstate scans PATH for known
// command-line tools and asks which to connect; connected CLIs are advertised to
// shell-enabled agents so they know to use them via run_shell. Shown once
// (gated on clis_onboarding_seen, set when the user connects or skips). The
// same picker is reusable from Settings via the `embedded` prop.

import { useEffect, useMemo, useState, type JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { DetectedCliDto } from '@shared/ipc-channels';

const CATEGORY_LABEL: Record<string, string> = {
  vcs: 'Version control',
  runtime: 'Runtimes',
  package: 'Package managers',
  container: 'Containers',
  cloud: 'Cloud & infra',
  ai: 'AI & agents',
  data: 'Databases',
  media: 'Media',
  other: 'Other',
};

/** Shared scanner + picker UI. Returns the selected ids via onDone. */
export function ClisPicker({
  onDone,
  onCancel,
  cancelLabel = 'Skip',
}: {
  onDone: (ids: string[]) => void;
  onCancel?: () => void;
  cancelLabel?: string;
}): JSX.Element {
  const [clis, setClis] = useState<DetectedCliDto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [{ clis: detected }, state] = await Promise.all([
          ipc.clis.detect(),
          ipc.clis.get(),
        ]);
        const installed = detected.filter((c) => c.installed);
        setClis(installed);
        // Pre-check: previously connected if any, else everything detected.
        const prior = new Set(state.connected);
        const init = installed.filter((c) => (prior.size > 0 ? prior.has(c.id) : true));
        setSelected(new Set(init.map((c) => c.id)));
      } catch {
        setClis([]);
      }
    })();
  }, []);

  const grouped = useMemo(() => {
    const by = new Map<string, DetectedCliDto[]>();
    for (const c of clis ?? []) {
      const arr = by.get(c.category) ?? [];
      arr.push(c);
      by.set(c.category, arr);
    }
    return [...by.entries()];
  }, [clis]);

  const toggle = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function connect(): Promise<void> {
    setBusy(true);
    try {
      await ipc.clis.connect([...selected]);
      onDone([...selected]);
    } finally {
      setBusy(false);
    }
  }

  if (clis === null) {
    return <div className="muted text-sm" style={{ padding: '24px 0' }}>Scanning for installed CLIs…</div>;
  }

  if (clis.length === 0) {
    return (
      <div>
        <p className="muted text-sm" style={{ marginBottom: 16 }}>
          No coding CLIs found on your PATH. Install one (e.g. Claude Code, Aider, or Gemini CLI),
          then re-scan from the Coding CLIs screen — they’ll become available to your agents.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={() => onDone([])} disabled={busy}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ maxHeight: 360, overflowY: 'auto', margin: '4px 0 16px' }}>
        {grouped.map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {CATEGORY_LABEL[cat] ?? cat}
            </div>
            {items.map((c) => (
              <label
                key={c.id}
                className="row gap-3"
                style={{ alignItems: 'center', padding: '6px 4px', cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row gap-2" style={{ alignItems: 'baseline' }}>
                    <span className="nm">{c.name}</span>
                    <code className="muted text-xs mono">{c.command}</code>
                    {c.version ? <span className="muted text-xs">v{c.version}</span> : null}
                  </div>
                  <div className="muted text-xs">{c.description}</div>
                </div>
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="muted text-xs">
          {selected.size} of {clis.length} selected
        </span>
        <div className="row gap-2">
          {onCancel ? (
            <button type="button" className="btn" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={busy}>
            {busy ? 'Connecting…' : `Connect ${selected.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** First-run modal wrapper. Only shows when onboarding hasn't been seen. */
export function ClisOnboardingModal(): JSX.Element | null {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const state = await ipc.clis.get();
        if (!state.onboardingSeen) setOpen(true);
      } catch {
        // best-effort
      }
    })();
  }, []);

  async function skip(): Promise<void> {
    setOpen(false);
    try {
      await ipc.clis.connect([]); // marks onboarding seen, connects nothing
    } catch {
      // best-effort
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => void skip()}
        >
          <motion.div
            className="modal glass"
            style={{ width: '100%', maxWidth: 520 }}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="eyebrow">Connect your tools</div>
            <h2 className="section-title" style={{ fontSize: 22, marginBottom: 6 }}>
              Connect your coding CLIs
            </h2>
            <p className="muted text-sm" style={{ marginBottom: 8 }}>
              Flowstate found these AI coding CLIs installed on your machine. Connect the ones you
              use — your agents will know they’re available, and you can launch any of them from the
              Coding CLIs screen. You can change this any time.
            </p>
            <ClisPicker onDone={() => setOpen(false)} onCancel={() => void skip()} />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
