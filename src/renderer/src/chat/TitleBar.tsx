import { useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';
import { BrandMark } from '../lib/brand-mark';
import { useAgentLiveStatus } from './useAgentLiveStatus';

interface Props {
  subtitle?: string;
}

export function TitleBar({ subtitle }: Props): JSX.Element {
  const [maximized, setMaximized] = useState(false);
  const liveStatus = useAgentLiveStatus();
  const anyStreaming = liveStatus.size > 0;
  const markState = anyStreaming ? 'streaming' : 'idle';

  useEffect(() => {
    void ipc.window.isMaximized().then(setMaximized);
    const unsub = ipc.window.onMaximizedChanged(setMaximized);
    return unsub;
  }, []);

  return (
    <div className="titlebar glass" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="titlebar-left">
        <span style={{ color: 'var(--ink-strong)', display: 'inline-flex', marginLeft: 2 }}>
          <BrandMark size={14} state={markState} />
        </span>
        <span className="titlebar-title">
          <em>Flowstate</em>
          {subtitle ? <> &nbsp;·&nbsp; {subtitle}</> : null}
        </span>
      </div>
      <div className="win-controls" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          type="button"
          aria-label="Minimize"
          className="win-btn"
          onClick={() => void ipc.window.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="5" width="8" height="1" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          className="win-btn"
          onClick={() => void ipc.window.toggleMaximize().then(setMaximized)}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="2.5" y="1.5" width="5.5" height="5.5" stroke="currentColor" strokeWidth="1" fill="none" />
              <rect x="1.5" y="2.5" width="5.5" height="5.5" stroke="currentColor" strokeWidth="1" fill="var(--bg)" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="win-btn close"
          onClick={() => void ipc.window.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}
