import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import { modalBackdrop, modalPanel } from '../lib/motion';

interface Props {
  models: string[];
  onClose: () => void;
}

interface ModelState {
  status: 'queued' | 'pulling' | 'done' | 'error';
  message: string;
  total?: number;
  completed?: number;
  cancel?: () => void;
}

export function ModelPullerModal({ models, onClose }: Props): JSX.Element {
  const [states, setStates] = useState<Record<string, ModelState>>(
    () => Object.fromEntries(models.map((m) => [m, { status: 'queued', message: 'Waiting…' }])),
  );
  const [running, setRunning] = useState(false);
  const cancelledRef = useRef(false);

  function setState(model: string, patch: Partial<ModelState>): void {
    setStates((prev) => ({ ...prev, [model]: { ...prev[model]!, ...patch } }));
  }

  async function pullOne(model: string): Promise<void> {
    return new Promise<void>((resolve) => {
      void ipc.ollama
        .pull(
          model,
          (p) => {
            setState(model, {
              status: 'pulling',
              message: p.status,
              total: p.total,
              completed: p.completed,
            });
          },
          (end) => {
            if (end.ok) {
              setState(model, { status: 'done', message: 'Done.' });
            } else {
              setState(model, { status: 'error', message: end.error ?? 'Failed.' });
            }
            resolve();
          },
        )
        .then(({ cancel }) => {
          setState(model, { cancel });
        });
    });
  }

  async function pullAll(): Promise<void> {
    setRunning(true);
    cancelledRef.current = false;
    for (const model of models) {
      if (cancelledRef.current) break;
      setState(model, { status: 'pulling', message: 'Starting…' });
      await pullOne(model);
    }
    setRunning(false);
  }

  function cancelAll(): void {
    cancelledRef.current = true;
    for (const model of models) {
      const s = states[model];
      s?.cancel?.();
    }
  }

  const allDone = models.every((m) => {
    const s = states[m];
    return s && (s.status === 'done' || s.status === 'error');
  });

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <motion.div
        className="w-[640px] max-w-[90vw] max-h-[90vh] rounded-lg border border-[var(--border)] bg-[var(--bg)] p-6 space-y-4 overflow-y-auto"
        variants={modalPanel}
      >
        <header>
          <h2 className="text-lg font-semibold">Pull required models</h2>
          <p className="text-sm text-[var(--ink-muted)] mt-1">
            Some models referenced by your agents aren't installed locally. Pull them now? Each
            model is multi-GB; this may take a while.
          </p>
        </header>

        <ul className="space-y-3">
          {models.map((m) => {
            const s = states[m]!;
            const pct =
              s.total && s.completed !== undefined
                ? Math.min(100, Math.floor((s.completed / s.total) * 100))
                : null;
            const color =
              s.status === 'done'
                ? 'var(--good)'
                : s.status === 'error'
                  ? 'var(--bad)'
                  : 'var(--accent)';
            return (
              <li key={m} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <code className="kbd">{m}</code>
                  <span className="text-xs" style={{ color }}>
                    {s.status === 'done'
                      ? 'done'
                      : s.status === 'error'
                        ? '× ' + s.message
                        : pct !== null
                          ? `${pct}%`
                          : s.message}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[var(--surface-2)] rounded">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${pct ?? (s.status === 'done' ? 100 : 0)}%`,
                      background: color,
                      transition: 'width 200ms ease',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex justify-end gap-2 pt-2">
          {running ? (
            <button type="button" className="btn" onClick={cancelAll}>
              Cancel
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>
              {allDone ? 'Close' : 'Skip for now'}
            </button>
          )}
          {!allDone ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void pullAll()}
              disabled={running}
            >
              {running ? 'Pulling…' : 'Pull all'}
            </button>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  );
}
