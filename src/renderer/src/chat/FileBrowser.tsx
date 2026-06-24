import { useCallback, useEffect, useState } from 'react';
import { ipc } from '../lib/ipc';

interface Props {
  workspacePath: string;
  onClose: () => void;
}

interface Entry {
  name: string;
  kind: 'file' | 'dir' | 'other';
}

interface PreviewState {
  relPath: string;
  content: string;
  truncated: boolean;
  sizeBytes: number;
}

export function FileBrowser({ workspacePath, onClose }: Props): JSX.Element {
  const [path, setPath] = useState<string>('.');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await ipc.files.list(workspacePath, path);
      setEntries(res.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspacePath, path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function go(name: string, kind: Entry['kind']): void {
    if (kind === 'dir') {
      setPath(path === '.' ? name : `${path}/${name}`);
      return;
    }
    const rel = path === '.' ? name : `${path}/${name}`;
    void ipc.files.read(workspacePath, rel).then((res) => {
      setPreview({ relPath: rel, content: res.content, truncated: res.truncated, sizeBytes: res.sizeBytes });
    }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  function up(): void {
    if (path === '.') return;
    const parts = path.split('/');
    parts.pop();
    setPath(parts.length === 0 ? '.' : parts.join('/'));
  }

  return (
    <aside className="w-[280px] border-l border-[var(--border)] bg-[var(--surface)] flex flex-col">
      <header className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs uppercase tracking-wider text-[var(--ink-faint)]">Files</span>
        <div className="flex gap-1">
          <button type="button" className="btn text-xs" onClick={() => void refresh()}>
            ↻
          </button>
          <button type="button" className="btn text-xs" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div className="px-3 py-1.5 text-xs text-[var(--ink-faint)] flex items-center gap-2 border-b border-[var(--border)]">
        <button type="button" className="btn text-xs px-1.5 py-0.5" onClick={up} disabled={path === '.'}>
          ↑
        </button>
        <code className="kbd text-xs truncate flex-1">{path}</code>
      </div>
      {error ? (
        <div className="px-3 py-2 text-xs text-[var(--bad)]">{error}</div>
      ) : null}
      <nav className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--ink-faint)]">empty</div>
        ) : (
          entries.map((e) => (
            <button
              key={e.name}
              type="button"
              onClick={() => go(e.name, e.kind)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs hover:bg-white/5"
            >
              <span className="text-[var(--ink-faint)] w-3">
                {e.kind === 'dir' ? '▸' : e.kind === 'file' ? '·' : '?'}
              </span>
              <span className="truncate">{e.name}</span>
            </button>
          ))
        )}
      </nav>
      {preview ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50" onClick={() => setPreview(null)}>
          <div
            className="w-[720px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg border border-[var(--border)] bg-[var(--bg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
              <code className="text-sm">{preview.relPath}</code>
              <span className="text-xs text-[var(--ink-faint)]">
                {preview.sizeBytes.toLocaleString()} bytes{preview.truncated ? ' · truncated' : ''}
              </span>
              <button type="button" className="btn text-xs" onClick={() => setPreview(null)}>
                Close
              </button>
            </header>
            <pre className="kbd flex-1 overflow-auto whitespace-pre-wrap break-all text-xs p-3 m-0 rounded-none border-0">
              {preview.content}
            </pre>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
