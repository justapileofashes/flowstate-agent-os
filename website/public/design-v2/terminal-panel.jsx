/* =========================================================
   Flowstate — interactive Terminal view
   A line-oriented shell panel for the agent workspace.

   Visual refinement of src/renderer/src/chat/TerminalPanel.tsx.
   The prototype simulates the shell locally; in the app the
   ipc.terminal.* bridge streams real stdout/stderr.
   ========================================================= */
/* global React */
const { useState: tpS, useEffect: tpE, useRef: tpR, useCallback: tpCb } = React;

const TERM_REDUCE =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* --- a tiny simulated workspace so commands feel real --- */
const TERM_FS = {
  "server/auth/refresh.py": 48,
  "server/auth/session.py": 96,
  "server/auth/models.py": 31,
  "server/db/migrations/0042_rotation.py": 22,
  "tests/test_refresh.py": 64
};

const TERM_GLYPH = (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.1"/>
    <path d="M4 5.5l2 1.5-2 1.5M7.2 8.8h2.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

/* Each command returns an array of output lines (strings), or a
   generator-ish list of {text, delay} for streamed output. */
function termRun(raw, { setLines, setExit, clear }) {
  const [cmd, ...args] = raw.trim().split(/\s+/);
  const a = args.join(" ");
  const out = (text, cls) => ({ kind: cls || "out", text });

  switch (cmd) {
    case "help":
      return [
        out("Flowstate shell — runs locally in the agent workspace.", "sys"),
        out("commands  help · pwd · ls · cat <file> · echo <x> · pytest · git · clear · exit", "sys")
      ];
    case "pwd":
      return [out("~/flow")];
    case "whoami":
      return [out("architect")];
    case "date":
      return [out(new Date().toString())];
    case "echo":
      return [out(a || "")];
    case "ls":
    case "dir": {
      const top = new Set();
      Object.keys(TERM_FS).forEach(p => top.add(p.split("/")[0] + "/"));
      return [out([...top].join("   "))];
    }
    case "ll": {
      return Object.entries(TERM_FS).map(([p, n]) =>
        out(`-rw-r--r--   ${String(n).padStart(4)} loc   ${p}`));
    }
    case "cat": {
      if (!a) return [out("cat: missing file operand", "err")];
      if (a in TERM_FS)
        return [
          out(`# ${a} — ${TERM_FS[a]} lines (truncated)`, "sys"),
          out("@router.post(\"/refresh\")"),
          out("async def refresh(req: RefreshRequest):"),
          out("    tok = await db.get_token(req.refresh)"),
          out("    ...")
        ];
      return [out(`cat: ${a}: No such file or directory`, "err")];
    }
    case "git": {
      if (args[0] === "status")
        return [
          out("On branch auth/refresh-rotation", "sys"),
          out("Changes not staged for commit:"),
          out("  modified:   server/auth/refresh.py", "out"),
          out("  modified:   server/auth/models.py", "out"),
          out("  new file:   server/db/migrations/0042_rotation.py", "good"),
          out("3 files changed, +47 −12")
        ];
      if (args[0] === "diff")
        return [
          out("- return issue_access(tok.user_id), tok.refresh", "err"),
          out("+ async with db.transaction():", "good"),
          out("+     await db.mark_used(tok.id)", "good")
        ];
      return [out(`git: '${args[0] || ""}' is not a tracked subcommand here`, "err")];
    }
    case "clear":
    case "cls":
      clear();
      return [];
    case "exit":
      setExit(0);
      return [out("session ended.", "sys")];
    case "":
      return [];
    default:
      // streamed commands
      if (cmd === "pytest")
        return {
          stream: [
            { text: "============== test session starts ==============", cls: "sys", delay: 120 },
            { text: "collected 20 items", cls: "sys", delay: 220 },
            { text: "tests/test_refresh.py ....................", cls: "good", delay: 520 },
            { text: "", delay: 80 },
            { text: "============== 20 passed in 1.43s ==============", cls: "good", delay: 160 }
          ]
        };
      if (cmd === "alembic")
        return {
          stream: [
            { text: "INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.", delay: 260 },
            { text: "INFO  [alembic.runtime.migration] Will assume transactional DDL.", delay: 300 },
            { text: "INFO  [alembic.runtime.migration] Running upgrade abc123 -> def456, add rotation_id", cls: "good", delay: 420 }
          ]
        };
      return [out(`${cmd}: command not found`, "err")];
  }
}

function TerminalPanel() {
  const seedLines = [
    { kind: "sys", text: "Flowstate shell · ~/flow · piped session" },
    { kind: "sys", text: "Type 'help' for commands. This runs locally on your machine." }
  ];
  const [lines, setLines] = tpS(seedLines);
  const [value, setValue] = tpS("");
  const [running, setRunning] = tpS(false);
  const [exitCode, setExitCode] = tpS(null);
  const histRef = tpR([]);          // command history
  const histIdx = tpR(-1);
  const interrupt = tpR(false);
  const outRef = tpR(null);
  const inputRef = tpR(null);

  const exited = exitCode !== null;

  // auto-scroll to bottom on new output
  tpE(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, running]);

  const push = tpCb((arr) => setLines(prev => [...prev, ...arr]), []);
  const clear = tpCb(() => setLines([]), []);

  async function streamOut(steps) {
    setRunning(true);
    for (const s of steps) {
      if (interrupt.current) {
        push([{ kind: "err", text: "^C  interrupted" }]);
        break;
      }
      await new Promise(r => setTimeout(r, TERM_REDUCE ? 0 : s.delay || 160));
      push([{ kind: s.cls || "out", text: s.text }]);
    }
    interrupt.current = false;
    setRunning(false);
  }

  async function execute(raw) {
    const trimmed = raw.trim();
    // echo the typed command
    push([{ kind: "cmd", text: trimmed }]);
    if (trimmed) {
      histRef.current = [...histRef.current, trimmed];
      histIdx.current = histRef.current.length;
    }
    const result = termRun(raw, { setLines, setExit: setExitCode, clear });
    if (result && result.stream) {
      await streamOut(result.stream);
    } else if (Array.isArray(result) && result.length) {
      push(result);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (running || exited) return;
      const v = value;
      setValue("");
      execute(v);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = histRef.current;
      if (!h.length) return;
      histIdx.current = Math.max(0, histIdx.current - 1);
      setValue(h[histIdx.current] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = histRef.current;
      if (histIdx.current >= h.length - 1) { histIdx.current = h.length; setValue(""); return; }
      histIdx.current = Math.min(h.length - 1, histIdx.current + 1);
      setValue(h[histIdx.current] || "");
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      if (running) { interrupt.current = true; }
      else { push([{ kind: "cmd", text: value }, { kind: "err", text: "^C" }]); setValue(""); }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clear();
    }
  }

  function copyAll() {
    const text = lines.map(l => (l.kind === "cmd" ? "> " + l.text : l.text)).join("\n");
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch (e) {}
  }

  function restart() {
    setLines(seedLines);
    setExitCode(null);
    setValue("");
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  }

  return (
    <div className="term">
      {/* 1 — header bar */}
      <div className="term-head">
        <span className="term-mark">{TERM_GLYPH}</span>
        <span className="term-title">Terminal</span>
        <span className="term-cwd">~/flow</span>
        {running && (
          <span className="term-run" aria-live="polite">
            <i></i><i></i><i></i><span>running</span>
          </span>
        )}
        <div className="term-actions">
          {exited && <span className="pill bad"><span className="dot"></span><span>exited {exitCode}</span></span>}
          <button className="term-ctl" onClick={clear} title="Clear output (Ctrl L)">clear</button>
          <button className="term-ctl" onClick={copyAll} title="Copy all output">copy</button>
        </div>
      </div>

      {/* 2 — output */}
      <div className="term-out scroll" ref={outRef} onClick={() => inputRef.current && inputRef.current.focus()}>
        {lines.map((l, i) => (
          <div key={i} className={"term-line " + l.kind}>
            {l.kind === "cmd" ? <span className="term-echo">{l.text}</span> : l.text || "\u00a0"}
          </div>
        ))}
        {running && <div className="term-line out term-cursor"><span className="term-blink">▌</span></div>}
      </div>

      {/* 3 — input row */}
      <div className={"term-input" + (exited ? " is-off" : "")}>
        <span className="term-prompt">$</span>
        <input
          ref={inputRef}
          className="term-field"
          value={value}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          disabled={exited}
          placeholder={exited ? "Session ended — restart to run more" : (running ? "running… Ctrl C to interrupt" : "")}
          onChange={e => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Terminal command input"
        />
        {exited && <button className="btn btn-sm" onClick={restart}>Restart</button>}
      </div>
    </div>
  );
}

Object.assign(window, { TerminalPanel });
