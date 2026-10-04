// Interactive terminal side-panel: xterm.js on top of a real pseudo-terminal
// in the main process (see TerminalService), scoped to the agent's workspace.
// Full-screen TUIs (Claude Code, Codex, Gemini CLI, …) work because they get a
// TTY, raw keystrokes and resize events. If the main process had to fall back
// to a piped shell, keystrokes are line-edited locally and sent on Enter.
//
// Visual: Flowstate v2 redesign (.term* classes in styles.css).

import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ipc } from '../lib/ipc';

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

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [mode, setMode] = useState<'pty' | 'pipe' | null>(null);
  const [exited, setExited] = useState<number | null | undefined>(undefined);
  const [generation, setGeneration] = useState(0); // bump to restart the session

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, ui-monospace, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowTransparency: false,
      theme: {
        background: '#0a0908',
        foreground: cssVar('--ink', '#f0ece2'),
        cursor: cssVar('--accent', '#e8e3d5'),
        selectionBackground: '#3a352e',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;
    try {
      fit.fit();
    } catch {
      // host not laid out yet; the ResizeObserver fits it shortly
    }

    let ptyMode = true;
    let line = ''; // local line buffer for the piped fallback
    let alive = true;

    // Ctrl+C copies when text is selected; Ctrl+V pastes (Windows habits).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.shiftKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'c' && term.hasSelection()) {
        void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        return false;
      }
      if (k === 'v') {
        void navigator.clipboard
          ?.readText()
          .then((t) => t && term.paste(t))
          .catch(() => {});
        return false;
      }
      return true;
    });

    const input = term.onData((data) => {
      if (ptyMode) {
        void ipc.terminal.input(id, data);
        return;
      }
      // Piped shell: no TTY echo, so edit the line locally.
      for (const ch of data) {
        if (ch === '\r') {
          term.write('\r\n');
          void ipc.terminal.input(id, line + '\r\n');
          line = '';
        } else if (ch === '\x7f' || ch === '\b') {
          if (line.length > 0) {
            line = line.slice(0, -1);
            term.write('\b \b');
          }
        } else if (ch === '\x03') {
          term.write('^C\r\n');
          line = '';
          void ipc.terminal.input(id, '\x03');
        } else if (ch >= ' ') {
          line += ch;
          term.write(ch);
        }
      }
    });

    const offData = ipc.terminal.onData((p) => {
      if (p.id !== id) return;
      term.write(ptyMode ? p.chunk : p.chunk.replace(/\r?\n/g, '\r\n'));
    });
    const offExit = ipc.terminal.onExit((p) => {
      if (p.id !== id) return;
      setExited(p.code);
      term.write(`\r\n\x1b[2m[session ended${p.code != null ? ` (code ${p.code})` : ''}]\x1b[0m\r\n`);
    });

    void ipc.terminal.start(id, cwd, { cols: term.cols, rows: term.rows }).then((r) => {
      if (!alive) return;
      ptyMode = r.pty;
      setMode(r.pty ? 'pty' : 'pipe');
      if (!r.pty) {
        term.write('\x1b[2m[piped shell: full-screen apps need the real terminal, which failed to load]\x1b[0m\r\n');
      }
      if (initialCommand && initialCommand.trim()) {
        // Give the shell a beat to print its prompt, then run the launch command.
        setTimeout(() => {
          if (!alive) return;
          if (!ptyMode) term.write(initialCommand + '\r\n');
          void ipc.terminal.input(id, initialCommand + (ptyMode ? '\r' : '\r\n'));
        }, 400);
      }
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      void ipc.terminal.resize(id, term.cols, term.rows);
    });
    ro.observe(host);
    term.focus();

    return () => {
      alive = false;
      ro.disconnect();
      input.dispose();
      offData();
      offExit();
      term.dispose();
      termRef.current = null;
      void ipc.terminal.kill(id);
    };
    // initialCommand only matters for the first launch of a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd, generation]);

  const clear = (): void => termRef.current?.clear();

  const copyAll = (): void => {
    const term = termRef.current;
    if (!term) return;
    let text = term.getSelection();
    if (!text) {
      const buf = term.buffer.active;
      const rows: string[] = [];
      for (let i = 0; i < buf.length; i++) rows.push(buf.getLine(i)?.translateToString(true) ?? '');
      text = rows.join('\n').replace(/\n+$/, '');
    }
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  const restart = (): void => {
    void ipc.terminal.kill(id);
    setExited(undefined);
    setGeneration((g) => g + 1);
  };

  return (
    <div className="term">
      <div className="term-head">
        <span className="term-mark">{GLYPH}</span>
        <span className="term-title">Terminal</span>
        <span className="term-cwd">{cwd}</span>
        <div className="term-actions">
          {mode === 'pipe' ? (
            <span className="pill" title="The native terminal module failed to load">
              <span>piped</span>
            </span>
          ) : null}
          {exited !== undefined ? (
            <>
              <span className="pill bad">
                <span className="dot" />
                <span>exited{exited != null ? ` ${exited}` : ''}</span>
              </span>
              <button type="button" className="term-ctl" onClick={restart} title="Start a new session">
                restart
              </button>
            </>
          ) : null}
          <button type="button" className="term-ctl" onClick={clear} title="Clear the screen">
            clear
          </button>
          <button type="button" className="term-ctl" onClick={copyAll} title="Copy selection or all output">
            copy
          </button>
          <button type="button" className="term-ctl" onClick={onClose} title="Close terminal">
            close
          </button>
        </div>
      </div>
      <div className="term-xterm" ref={hostRef} onClick={() => termRef.current?.focus()} />
    </div>
  );
}
