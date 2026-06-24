import { useState, type KeyboardEvent } from 'react';
import { ipc } from '../lib/ipc';
import { BrandMark } from '../lib/brand-mark';

interface Props {
  onRouted: (
    agentId: string,
    chatId: string,
    text: string,
    reasoning: string,
    fallback: boolean,
    swarm?: string[],
    team?: boolean,
  ) => void;
  /** Legacy hook from when Team Run lived in its own modal. Kept so the
   *  host can clear any stale team-prompt state when a route fires. */
  onTeamRun: (text: string) => void;
}

export function GlobalAskBox({ onRouted, onTeamRun }: Props): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    void submit();
  }

  async function submit(): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await ipc.chat.route(trimmed);
      onRouted(res.agentId, res.chatId, trimmed, res.reasoning, res.fallback, res.swarm, res.team);
      setText('');
      onTeamRun('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-5 h-5 flex items-center justify-center text-[var(--accent)]">
          <BrandMark size={18} />
        </span>
        <h2 className="text-base font-semibold tracking-tight">Ask anything</h2>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Describe a task — orchestrator picks the right agent and drops you straight into the session."
        rows={3}
        disabled={busy}
        className="field resize-none"
      />
      {error ? (
        <div className="mt-2 rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
          {error}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] text-[var(--ink-faint)]">
          One best-fit agent answers.
        </span>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || text.trim().length === 0}
          className="btn btn-primary"
        >
          {busy ? 'Routing…' : 'Send'}
        </button>
      </div>
    </section>
  );
}
