// Interactive terminal side-panel. Drives a piped OS shell in the main process
// (see TerminalService) scoped to the agent's workspace. Not a full PTY: no
// curses/full-screen apps, but commands, cd, and streamed output all work.
//
// Visual: Flowstate v2 redesign (.term* classes in styles.css). Streamed bytes
// are split into line rows so command echoes / errors / system notices can be
// toned differently.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';

// Strip ANSI escape sequences so output is readable in plain rows.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][AB012]/g;
function clean(s: string): string {
  return s.replace(ANSI, '').replace(/\r(?!\n)/g, '');
}

type LineKind = 'out' | 'cmd' | 'sys' | 'err' | 'good';
interface Line {
  kind: LineKind;
  text: string;
}

const MAX_LINES = 4000;

const GLYPH = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
    <path
      d="M4 5.5l2 1.5-2 1.5M7.2 8.8h2.6"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function TerminalPanel({
  id,
  cwd,
  onClose,
  initialCommand,
}: {
  id: string;
  cwd: string;
  onClose: () => void;
  /** If set, this command is run automatically once the session starts (used to
   *  launch a connected coding CLI). */
  initialCommand?: string;
}): JSX.Element {
  const [lines, setLines] = useState<Line[]>([
    { kind: 'sys', text: `Flowstate shell · ${cwd} · piped session` },
    initialCommand
      ? { kind: 'sys', text: `Launching ${initialCommand}…` }
      : { kind: 'sys', text: 'Runs locally on your machine. Type a command below.' },
  ]);
  const [pending, setPending] = useState(''); // in-progress (no trailing newline yet)
  const [input, setInput] = useState('');
  const [exited, setExited] = useState<number | null | undefined>(undefined);
  const history = useRef<string[]>([]);
  const histIdx = useRef<number>(-1);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const push = useCallback((arr: Line[]): void => {
    setLines((prev) => {
      const next = prev.concat(arr);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    const offData = ipc.terminal.onData((p) => {
      if (p.id !== id) return;
      setPending((prevPartial) => {
        const combined = prevPartial + clean(p.chunk);
        const parts = combined.split('\n');
        const tail = parts.pop() ?? '';
        if (parts.length > 0) push(parts.map((t) => ({ kind: 'out' as const, text: t })));
        return tail;
      });
    });
    const offExit = ipc.terminal.onExit((p) => {
      if (p.id !== id) return;
      setExited(p.code);
      push([{ kind: 'sys', text: `session ended${p.code != null ? ` (code ${p.code})` : ''}` }]);
    });
    void ipc.terminal.start(id, cwd);
    if (initialCommand && initialCommand.trim()) {
      // Give the shell a beat to spawn, then run the launch command.
      const cmd = initialCommand;
      setTimeout(() => {
        push([{ kind: 'cmd', text: cmd }]);
        void ipc.terminal.input(id, cmd + '\r\n');
      }, 250);
    }
    return () => {
      offData();
      offExit();
      void ipc.terminal.kill(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd]);

  // Auto-scroll on new output.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, pending]);

  const send = (): void => {
    if (exited !== undefined) return;
    const cmd = input;
    push([{ kind: 'cmd', text: cmd }]);
    void ipc.terminal.input(id, cmd + '\r\n');
    if (cmd.trim()) history.current.push(cmd);
    histIdx.current = history.current.length;
    setInput('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void ipc.terminal.input(id, '\x03');
      push([{ kind: 'err', text: '^C' }]);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const h = history.current;
      if (!h.length) return;
      histIdx.current = Math.max(0, histIdx.current - 1);
      setInput(h[histIdx.current] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const h = history.current;
      histIdx.current = Math.min(h.length, histIdx.current + 1);
      setInput(h[histIdx.current] ?? '');
    }
  };

  const clear = (): void => {
    setLines([]);
    setPending('');
  };

  const copyAll = (): void => {
    const text = lines
      .map((l) => (l.kind === 'cmd' ? '> ' + l.text : l.text))
      .concat(pending ? [pending] : [])
      .join('\n');
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const restart = (): void => {
    void ipc.terminal.kill(id);
    setLines([{ kind: 'sys', text: `Flowstate shell · ${cwd} · piped session` }]);
    setPending('');
    setExited(undefined);
    setInput('');
    void ipc.terminal.start(id, cwd);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="term">
      <div className="term-head">
        <span className="term-mark">{GLYPH}</span>
        <span className="term-title">Terminal</span>
        <span className="term-cwd">{cwd}</span>
        <div className="term-actions">
          {exited !== undefined ? (
            <span className="pill bad">
              <span className="dot" />
              <span>exited{exited != null ? ` ${exited}` : ''}</span>
            </span>
          ) : null}
          <button type="button" className="term-ctl" onClick={clear} title="Clear output">
            clear
          </button>
          <button type="button" className="term-ctl" onClick={copyAll} title="Copy all output">
            copy
          </button>
          <button type="button" className="term-ctl" onClick={onClose} title="Close terminal">
            close
          </button>
        </div>
      </div>

      <div
        className="term-out scroll"
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((l, i) => (
          <div key={i} className={'term-line ' + l.kind}>
            {l.kind === 'cmd' ? <span className="term-echo">{l.text}</span> : l.text || ' '}
          </div>
        ))}
        {pending ? <div className="term-line out">{pending}</div> : null}
      </div>

      <div className={'term-input' + (exited !== undefined ? ' is-off' : '')}>
        <span className="term-prompt">$</span>
        <input
          ref={inputRef}
          className="term-field"
          value={input}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          disabled={exited !== undefined}
          placeholder={exited !== undefined ? 'Session ended — restart to run more' : ''}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Terminal command input"
          autoFocus
        />
        {exited !== undefined ? (
          <button type="button" className="btn btn-sm" onClick={restart}>
            Restart
          </button>
        ) : null}
      </div>
    </div>
  );
}
