// Recommends a cloud model for features that need a strong one (multi-agent
// planning: Business, team runs, the AI Trader desk). Shown only when the
// model the feature will actually use is a small local one. Dismissible per
// feature (remembered in this browser profile).

import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';

export function HeavyModelNotice({
  feature,
  models,
  onOpenSettings,
}: {
  /** Stable key + display name, e.g. "Business agent". */
  feature: string;
  /** Models the feature runs on; omit for the orchestrator (planner) model. */
  models?: string[];
  onOpenSettings?: () => void;
}): JSX.Element | null {
  const dismissKey = `heavy-model-notice:${feature}`;
  const [weak, setWeak] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissKey) === '1';
    } catch {
      return false;
    }
  });
  const modelsKey = (models ?? []).join('|');

  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    void ipc
      .modelStrength(models && models.length ? models : undefined)
      .then((r) => {
        if (alive) setWeak(r.models.filter((m) => m.strength === 'local-small').map((m) => m.model));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // modelsKey stands in for the array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsKey, dismissed]);

  if (dismissed || weak.length === 0) return null;

  return (
    <div
      className="card"
      role="note"
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 14px', margin: '0 0 12px' }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ color: 'var(--ink-strong)' }}>{feature} works best with a cloud model</div>
        <div className="hint" style={{ marginTop: 2 }}>
          It plans and coordinates several agents, which small local models (here:{' '}
          <span className="mono">{[...new Set(weak)].join(', ')}</span>) often get wrong. Add a cloud API key or
          an Ollama cloud model and pick it for this feature — or a local model of 30B+ if your hardware allows.
        </div>
      </div>
      {onOpenSettings && (
        <button type="button" className="btn btn-sm" onClick={onOpenSettings}>
          Choose model
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(dismissKey, '1');
          } catch {
            // storage unavailable — dismiss for this session only
          }
          setDismissed(true);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
