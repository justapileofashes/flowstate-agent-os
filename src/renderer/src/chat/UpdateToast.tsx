// "Update ready — restart" toast. The installed build downloads updates from
// GitHub Releases in the background (main/services/auto-update.ts); once one
// is ready this offers a restart. Dismissing it is fine — the update also
// installs on the next quit. Reuses the pack-toast idiom.

import { useEffect, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import type { UpdateStatusDto } from '@shared/ipc-channels';

export function UpdateToast(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatusDto | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!window.flowstate?.updates) return;
    void ipc.updates.status().then(setStatus).catch(() => {});
    return ipc.updates.onStatus(setStatus);
  }, []);

  if (!status || status.state !== 'ready' || dismissed === status.version) return null;

  return (
    <div
      className="pack-toast glass"
      role="status"
      aria-live="polite"
      style={{ position: 'fixed', left: 'auto', right: 20, bottom: 20, transform: 'none' }}
    >
      <span className="pill good">
        <span className="dot" />
        <span>update</span>
      </span>
      <div className="pack-toast-body">
        <div className="pack-toast-title">Flowstate {status.version} is ready</div>
        <div className="pack-toast-sub">Restart to update, or it installs when you quit.</div>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={restarting}
        onClick={() => {
          setRestarting(true);
          void ipc.updates.install().then((r) => {
            if (!r.ok) setRestarting(false);
          });
        }}
      >
        {restarting ? 'Restarting…' : 'Restart'}
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={() => setDismissed(status.version ?? '')}
        aria-label="Later"
      >
        Later
      </button>
    </div>
  );
}
