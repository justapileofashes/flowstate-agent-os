/* global React */
const { useState: useS, useEffect: useE, useRef: useR, useMemo: useM } = React;

/* =========================================================
   Dashboard
   ========================================================= */
function Dashboard({ onOpenAgent, onTeamRun }) {
  const [mode, setMode] = useS("solo");
  const [task, setTask] = useS("");
  const agents = window.FLOW_DATA.agents;
  const groups = useM(() => {
    const m = {};
    for (const a of agents) (m[a.group] = m[a.group] || []).push(a);
    return m;
  }, [agents]);
  const [activeGroup, setActiveGroup] = useS("All");
  const filterChips = ["All", ...Object.keys(groups)];
  const filtered = activeGroup === "All" ? agents : groups[activeGroup];

  const greeting = useM(() => {
    const h = new Date().getHours();
    if (h < 6) return "Late night";
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  return (
    <div className="screen-enter" style={{
      minHeight: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      paddingTop: 24,
      paddingBottom: 24
    }}>
      <div className="hero" style={{ padding: "0 48px 24px" }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Wed · May 14 · 56 specialists</div>
        <h1>{greeting}. <span className="muted">What are we making?</span></h1>
      </div>

      <div className="composer">
        <textarea
          placeholder={mode === "solo"
            ? "Ask any agent — or describe a goal and we'll route it."
            : "Describe a goal. We'll decompose it and run a team in parallel."}
          value={task}
          onChange={e => setTask(e.target.value)}
        />
        <div className="composer-bar">
          <div className="toggle-group">
            <button className={mode === "solo" ? "on" : ""} onClick={() => setMode("solo")}>Solo</button>
            <button className={mode === "team" ? "on" : ""} onClick={() => setMode("team")}>Team</button>
          </div>

          <span style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {mode === "solo" ? "1 agent · routed" : "auto-orchestrated · parallel"}
          </span>

          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            onClick={() => mode === "team" ? onTeamRun(task) : onOpenAgent(agents[0])}
          >
            {mode === "team" ? "Plan & run team" : "Send"}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 6h6 M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Surface 3 — always-on system meters: what local models cost the machine. */}
      <ResourceMeters />

      {/* The space below is reserved for the live agent worldview —
          workstations + the mascots that visualize active runs. */}
    </div>
  );
}

/* =========================================================
   Chat surface
   ========================================================= */
const VIEWS = [
  { id: "conversation", label: "Conversation", k: "1" },
  { id: "preview",      label: "Preview",      k: "2" },
  { id: "artifact",     label: "Artifact",     k: "3" },
  { id: "changes",      label: "Changes",      k: "4" },
  { id: "terminal",     label: "Terminal",     k: "5" },
  { id: "files",        label: "Files",        k: "6" },
  { id: "tasks",        label: "Tasks",        k: "7" },
  { id: "plan",         label: "Plan",         k: "8" }
];

function ViewsButton({ value, onChange }) {
  const [open, setOpen] = useS(false);
  const ref = useR(null);
  useE(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const cur = VIEWS.find(v => v.id === value) || VIEWS[0];
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn btn-sm" onClick={() => setOpen(o => !o)}>
        <span style={{ color: "var(--ink-faint)" }}>View:</span>
        <span>{cur.label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" stroke="currentColor" fill="none" strokeWidth="1.2"/></svg>
      </button>
      {open && (
        <div className="dropdown glass">
          {VIEWS.map(v => (
            <div key={v.id} className="dropdown-item" onClick={() => { onChange(v.id); setOpen(false); }}>
              <span style={{ color: v.id === value ? "var(--accent)" : "currentColor" }}>{v.id === value ? "•" : " "}</span>
              <span>{v.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatSurface({ agent }) {
  const [view, setView] = useS("conversation");
  const [toast, setToast] = useS(null);

  // Build message thread relevant to the agent
  const thread = useM(() => buildThread(agent), [agent]);

  return (
    <div className="screen-enter col" style={{ height: "100%" }}>
      <header className="chat-header">
        <div className="left">
          <div className="a-icon" style={{ width: 26, height: 26, borderRadius: 7, background: "var(--surface-2)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--ink-muted)" }}>
            {agent.glyph}
          </div>
          <div>
            <div className="agent-name">{agent.name}</div>
            <div className="crumbs">{agent.model} · workspace · {agent.tags.join(" · ")}</div>
          </div>
          <span className="pill streaming" style={{ marginLeft: 12 }}>
            <span className="dot"></span><span>streaming</span>
          </span>
        </div>
        <div className="right">
          <span className="pill"><span>2,148 / 200k</span></span>
          <button className="btn btn-sm btn-ghost" title="Snapshots">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor"/><path d="M7 4v3l2 1" stroke="currentColor"/></svg>
            <span>Snapshots</span>
          </button>
          <ExportRunButton chatId={agent.name} hasMessages={thread.length > 0} onToast={setToast} />
          <button className="btn btn-sm btn-ghost" title="Files">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2.5" y="2.5" width="9" height="9" rx="1" stroke="currentColor"/><line x1="4.5" y1="6" x2="9.5" y2="6" stroke="currentColor"/><line x1="4.5" y1="9" x2="8" y2="9" stroke="currentColor"/></svg>
            <span>Files</span>
          </button>
          <ViewsButton value={view} onChange={setView} />
        </div>
      </header>

      <div className="scroll" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {view === "conversation" && <ConversationView thread={thread} />}
        {view === "preview"      && <PreviewView />}
        {view === "artifact"     && <ArtifactView />}
        {view === "changes"      && <ChangesView />}
        {view === "terminal"     && <TerminalView />}
        {view === "files"        && <FilesView />}
        {view === "tasks"        && <TasksView />}
        {view === "plan"         && <PlanView />}
      </div>

      <DevComposer agent={agent} chatId={agent.name} onToast={setToast} />

      <PackToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

function buildThread(agent) {
  return [
    { role: "user",  body: <p>Refactor <em className="ink">auth/refresh</em> to rotate refresh tokens on every use. Add tests for replay. Keep backwards compatible for 30 days.</p> },
    { role: "agent", body:
      <>
        <p>Got it. I'll do this in three passes so you can stop me between each:</p>
        <p style={{ paddingLeft: 12, borderLeft: "2px solid var(--border)", color: "var(--ink-muted)" }}>
          1.&nbsp; Add a <span className="mono">rotation_id</span> column to <span className="mono">refresh_tokens</span> with a backfill.<br/>
          2.&nbsp; Issue a new token on every refresh; mark the old one used.<br/>
          3.&nbsp; Reject any second use of a "used" token + log the IP.
        </p>
        <p>First — let me look at the current handler.</p>
        <div className="toolcall">
          <div className="toolcall-head">
            <span style={{ color: "var(--ink-muted)" }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ display: "inline-block", verticalAlign: -1, marginRight: 6 }}><path d="M2 4l4-2 4 2v4l-4 2-4-2V4z M6 2v4 M2 4l4 2 4-2" stroke="currentColor"/></svg>
              tool
            </span>
            <span className="name">read_file</span>
            <span style={{ marginLeft: "auto", color: "var(--ink-faint)", fontSize: 11 }}>0.4s</span>
          </div>
          <div className="args">path: "server/auth/refresh.py"</div>
        </div>
        <p>This is the routing logic today. Notice the same token is returned — that's what we're changing.</p>
        <div className="codeblock">
          <div className="codeblock-head">
            <span>server/auth/refresh.py</span>
            <span>python · 48 lines</span>
          </div>
          <pre>{`@router.post("/refresh")
async def refresh(req: RefreshRequest):
    `}<span className="tok-k">tok</span>{` = await db.get_token(req.refresh)
    `}<span className="tok-k">if</span>{` `}<span className="tok-k">not</span>{` `}<span className="tok-k">tok</span>{` `}<span className="tok-k">or</span>{` `}<span className="tok-k">tok</span>{`.expires < now():
        `}<span className="tok-k">raise</span>{` HTTPException(401, `}<span className="tok-s">"expired"</span>{`)
    `}<span className="tok-c"># BUG: reuses the same refresh token</span>{`
    `}<span className="tok-k">return</span>{` issue_access(`}<span className="tok-k">tok</span>{`.user_id), `}<span className="tok-k">tok</span>{`.refresh`}
          </pre>
        </div>
      </>
    },
    { role: "tool", body: <ToolApproval /> },
  ];
}

function ConversationView({ thread }) {
  return (
    <div className="chat-stream">
      {thread.map((m, i) => (
        <div className="msg" key={i}>
          <div className="avatar">{m.role === "user" ? "Y" : m.role === "agent" ? "▲" : "⚙"}</div>
          <div className="body">
            <div className="role">{m.role === "user" ? "you" : m.role === "agent" ? "architect" : "approval"}</div>
            <div className="text">{m.body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolApproval() {
  const [done, setDone] = useS(false);
  if (done) return <p className="muted">Approved — applied at 11:42:08.</p>;
  return (
    <div className="card" style={{ padding: 14, maxWidth: 540 }}>
      <div className="row gap-2" style={{ alignItems: "baseline" }}>
        <span className="mono" style={{ color: "var(--ink-strong)", fontSize: 13 }}>edit_file</span>
        <span style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>+18 -3</span>
        <span className="pill bad" style={{ marginLeft: "auto" }}><span className="dot"></span><span>needs approval</span></span>
      </div>
      <div className="mono mt-2" style={{ color: "var(--ink-muted)", fontSize: 12 }}>server/auth/refresh.py</div>
      <p className="muted mt-3" style={{ fontSize: 13 }}>
        Rotate refresh token. Add <span className="mono" style={{color: "var(--ink)"}}>rotation_id</span> check, mark used, return a new token.
      </p>
      <div className="row gap-2 mt-3" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setDone(true)}>Reject</button>
        <button className="btn btn-sm">View diff</button>
        <button className="btn btn-sm btn-primary" onClick={() => setDone(true)}>Approve</button>
      </div>
    </div>
  );
}

/* The non-conversation views */
function PreviewView() {
  return (
    <div style={{ padding: 24 }}>
      <div className="card" style={{ overflow: "hidden", maxWidth: 880, margin: "0 auto" }}>
        <div className="row" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span>localhost:5173/login</span>
          <span style={{ marginLeft: "auto" }}>preview · hot reload</span>
        </div>
        <div style={{ height: 380, background: "var(--surface-2)", display: "grid", placeItems: "center" }}>
          <div style={{ width: 320, padding: 24 }} className="card">
            <h3 style={{ margin: 0, color: "var(--ink-strong)", fontWeight: 400, fontSize: 18 }}>Sign in</h3>
            <p className="muted mt-2" style={{ fontSize: 12 }}>Now with rotating tokens.</p>
            <input className="field mt-3" placeholder="you@example.com" />
            <input className="field mt-2" placeholder="••••••••" type="password" />
            <button className="btn btn-primary mt-3" style={{ width: "100%", justifyContent: "center" }}>Continue</button>
          </div>
        </div>
      </div>
    </div>
  );
}
function ArtifactView() {
  return (
    <div style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
      <div className="eyebrow">artifact · md</div>
      <h2 style={{ fontWeight: 300, fontSize: 32, color: "var(--ink-strong)", marginTop: 8 }}>Refresh token rotation — rollout plan</h2>
      <p className="muted mt-3">A staged rollout in three windows so we can revert at any boundary. All steps are append-only on the DB side; no destructive migrations.</p>
      <h3 style={{ color: "var(--ink-strong)", fontWeight: 500, fontSize: 14, marginTop: 24, fontFamily: "var(--font-mono)", letterSpacing: ".08em", textTransform: "uppercase" }}>Phase 1 — schema</h3>
      <p className="muted mt-2">Add <span className="mono" style={{color:"var(--ink)"}}>rotation_id</span>, <span className="mono" style={{color:"var(--ink)"}}>used_at</span>, <span className="mono" style={{color:"var(--ink)"}}>replaces_id</span>. Backfill rotation_ids in batches of 5k.</p>
    </div>
  );
}
function ChangesView() {
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <div className="row gap-2 mb-4">
        <span className="pill"><span>3 files</span></span>
        <span className="pill good"><span className="dot"></span><span>+47</span></span>
        <span className="pill bad"><span className="dot"></span><span>−12</span></span>
        <span style={{ marginLeft: "auto" }} className="row gap-2">
          <button className="btn btn-sm btn-ghost">Discard</button>
          <button className="btn btn-sm">Stash</button>
          <button className="btn btn-sm btn-primary">Commit…</button>
        </span>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="row" style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", color: "var(--ink-muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          <span>server/auth/refresh.py</span>
          <span style={{ marginLeft: "auto", color: "var(--ink-faint)", fontSize: 11 }}>+18 −3</span>
        </div>
        <pre style={{ margin: 0, padding: 12, fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.6 }}>
{`  @router.post("/refresh")
  async def refresh(req: RefreshRequest):
      tok = await db.get_token(req.refresh)
- `}<span style={{ color: "var(--bad)" }}>{`     if not tok or tok.expires < now():`}</span>{`
+ `}<span style={{ color: "var(--good)" }}>{`     if not tok or tok.used_at or tok.expires < now():`}</span>{`
          raise HTTPException(401, "expired")
- `}<span style={{ color: "var(--bad)" }}>{`     return issue_access(tok.user_id), tok.refresh`}</span>{`
+ `}<span style={{ color: "var(--good)" }}>{`     async with db.transaction():`}</span>{`
+ `}<span style={{ color: "var(--good)" }}>{`         await db.mark_used(tok.id)`}</span>{`
+ `}<span style={{ color: "var(--good)" }}>{`         new = await db.issue_refresh(tok.user_id, replaces_id=tok.id)`}</span>{`
+ `}<span style={{ color: "var(--good)" }}>{`     return issue_access(tok.user_id), new.token`}</span>
{`</`}</pre>
      </div>
    </div>
  );
}
function TerminalView() {
  return <TerminalPanel />;
}
function FilesView() {
  const tree = [
    { name: "server/", depth: 0, kind: "dir", expanded: true },
    { name: "auth/", depth: 1, kind: "dir", expanded: true },
    { name: "refresh.py", depth: 2, kind: "file", changed: "+18 −3" },
    { name: "session.py", depth: 2, kind: "file" },
    { name: "models.py", depth: 2, kind: "file", changed: "+9" },
    { name: "db/", depth: 1, kind: "dir", expanded: true },
    { name: "migrations/", depth: 2, kind: "dir", expanded: true },
    { name: "0042_rotation.py", depth: 3, kind: "file", changed: "new" },
    { name: "tests/", depth: 0, kind: "dir", expanded: true },
    { name: "test_refresh.py", depth: 1, kind: "file", changed: "+32" }
  ];
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {tree.map((n, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", padding: `6px 14px 6px ${14 + n.depth * 16}px`,
            borderBottom: i < tree.length - 1 ? "1px solid var(--border)" : "0",
            fontFamily: "var(--font-mono)", fontSize: 12,
            color: n.kind === "dir" ? "var(--ink-muted)" : "var(--ink)"
          }}>
            <span style={{ color: "var(--ink-faint)", marginRight: 8 }}>{n.kind === "dir" ? "▾" : "·"}</span>
            <span>{n.name}</span>
            {n.changed && (
              <span style={{ marginLeft: "auto", color: n.changed === "new" ? "var(--good)" : "var(--ink-faint)", fontSize: 11 }}>{n.changed}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
function TasksView() {
  const tasks = [
    { t: "Schema migration: add rotation_id", s: "done" },
    { t: "Rotate token in handler", s: "doing" },
    { t: "Reject second-use + log", s: "doing" },
    { t: "Replay-attack tests", s: "queued" },
    { t: "Doc update auth.md", s: "queued" },
    { t: "Roll out behind feature flag", s: "queued" }
  ];
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
      {tasks.map((t, i) => (
        <div key={i} className="card-2" style={{ padding: 12, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 14, height: 14, borderRadius: 4,
            border: "1px solid var(--border-strong)",
            background: t.s === "done" ? "var(--good)" : "transparent",
            display: "grid", placeItems: "center", color: "#14110d", fontSize: 9
          }}>{t.s === "done" ? "✓" : ""}</span>
          <span style={{ color: t.s === "done" ? "var(--ink-faint)" : "var(--ink)", textDecoration: t.s === "done" ? "line-through" : "none" }}>{t.t}</span>
          <span className="pill" style={{ marginLeft: "auto" }}><span>{t.s}</span></span>
        </div>
      ))}
    </div>
  );
}
function PlanView() {
  const [tab, setTab] = useS("orchestrator");
  const tabs = ["orchestrator", "architect", "refactorer", "tester", "doc-writer"];
  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <div className="tabs mb-4">
        {tabs.map(t => (
          <button key={t} className={"tab " + (tab === t ? "on" : "")} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="card" style={{ padding: 20 }}>
        <div className="eyebrow">{tab}</div>
        <h3 style={{ fontWeight: 400, fontSize: 20, color: "var(--ink-strong)", marginTop: 6 }}>
          {tab === "orchestrator" ? "Plan: rotate refresh tokens, ship behind flag" : "Subtask"}
        </h3>
        <ol style={{ color: "var(--ink-muted)", paddingLeft: 20, marginTop: 14, lineHeight: 1.7 }}>
          <li><em style={{ color: "var(--ink)", fontStyle: "normal" }}>Architect</em> · sketch protocol + list affected files</li>
          <li><em style={{ color: "var(--ink)", fontStyle: "normal" }}>Refactorer</em> · apply rotation in handler</li>
          <li><em style={{ color: "var(--ink)", fontStyle: "normal" }}>Test engineer</em> · replay-attack tests + race guards</li>
          <li><em style={{ color: "var(--ink)", fontStyle: "normal" }}>Doc writer</em> · update auth.md + rollout guide</li>
          <li><em style={{ color: "var(--ink)", fontStyle: "normal" }}>Synthesizer</em> · merge findings + draft commit message</li>
        </ol>
      </div>
    </div>
  );
}

/* =========================================================
   Models page
   ========================================================= */
function ModelsPage() {
  const D = window.FLOW_DATA.models;
  const [chip, setChip] = useS("All");
  const chips = ["All", "Installed", "Local", "Code", "Reasoning"];

  return (
    <div className="screen-enter models-page">
      <div className="eyebrow">Hardware</div>
      <h2 className="section-title" style={{ marginBottom: 24, fontSize: 32 }}>This machine</h2>

      <div className="hw-card mb-6">
        {D.hardware.map(h => (
          <div className="hw-stat" key={h.label}>
            <div className="label">{h.label}</div>
            <div className="value">{h.value}</div>
            <div className="sub">{h.sub}</div>
          </div>
        ))}
      </div>

      <div className="row mb-4" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ fontWeight: 400, fontSize: 20, color: "var(--ink-strong)", margin: 0 }}>Recommended for you</h3>
        <span style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: 11 }}>based on 24 GB VRAM · 64 GB RAM</span>
      </div>

      <div className="recco-grid mb-6">
        {D.reccos.map(r => (
          <div className="recco-card" key={r.name}>
            <div className="slot">{r.slot}</div>
            <div className="mname">{r.name}</div>
            <div className="muted text-xs mt-1">{r.size} · {r.fit} fit</div>
            <div className="col gap-2 mt-3">
              <div className="model-bar">speed<div className="bar"><div className="fill" style={{ width: `${r.speed*100}%` }}/></div></div>
              <div className="model-bar">quality<div className="bar"><div className="fill" style={{ width: `${r.quality*100}%` }}/></div></div>
            </div>
            <button className="btn btn-primary mt-3" style={{ width: "100%", justifyContent: "center" }}>Use as default</button>
          </div>
        ))}
      </div>

      <div className="row mb-4" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ fontWeight: 400, fontSize: 20, color: "var(--ink-strong)", margin: 0 }}>All models</h3>
        <div className="row gap-2">
          {chips.map(c => (
            <button key={c} className={"btn btn-sm " + (chip === c ? "" : "btn-ghost")} onClick={() => setChip(c)}>{c}</button>
          ))}
        </div>
      </div>

      <div className="col gap-2">
        {D.list.map(m => (
          <div key={m.name} className="card" style={{ padding: 14, display: "grid", gridTemplateColumns: "1fr 100px 220px 140px", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ color: "var(--ink-strong)", fontWeight: 500 }}>{m.name}</div>
              <div className="muted text-xs">{m.size} · {m.fit} fit on this machine</div>
            </div>
            <div className="row gap-2"><span className="pill" style={m.installed ? { color: "var(--good)" } : null}>{m.installed ? "installed" : "available"}</span></div>
            <div className="col gap-1">
              <div className="model-bar">spd<div className="bar"><div className="fill" style={{ width: `${m.speed*100}%` }}/></div></div>
              <div className="model-bar">qty<div className="bar"><div className="fill" style={{ width: `${m.quality*100}%` }}/></div></div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              {m.installed ? (
                <button className="btn btn-sm">Manage</button>
              ) : m.progress ? (
                <div style={{ minWidth: 140 }}>
                  <div className="model-bar"><div className="bar"><div className="fill" style={{ width: `${m.progress*100}%`, background: "var(--accent)" }}/></div></div>
                  <div className="muted text-xs mt-1" style={{ textAlign: "right" }}>{Math.round(m.progress*100)}%</div>
                </div>
              ) : (
                <button className="btn btn-sm btn-primary">Download</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   Connectors page
   ========================================================= */
function ConnectorsPage() {
  const list = window.FLOW_DATA.connectors;
  const [chip, setChip] = useS("All");
  const chips = ["All", "Installed", "Productivity", "Code", "Chat", "Files"];
  return (
    <div className="screen-enter" style={{ padding: "32px 48px 80px", maxWidth: 1100, margin: "0 auto" }}>
      <div className="eyebrow">Connectors</div>
      <h2 className="section-title" style={{ marginBottom: 8, fontSize: 32 }}>One-click integrations</h2>
      <p className="muted mt-3" style={{ maxWidth: 560 }}>Agents call these as tools. Tokens stay on your machine; the agent only sees what you allow.</p>

      <div className="row gap-2 mt-6 mb-4" style={{ flexWrap: "wrap" }}>
        {chips.map(c => (
          <button key={c} className={"btn btn-sm " + (chip === c ? "" : "btn-ghost")} onClick={() => setChip(c)}>{c}</button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <input className="field" placeholder="Find a connector…" style={{ width: 240 }} />
        </div>
      </div>

      <div className="cnx-grid">
        {list.map(c => (
          <div className="cnx-card" key={c.name}>
            <div className="row gap-3">
              <div className="cnx-icon" style={{ color: "var(--ink-strong)" }}>
                <BrandLogo name={c.name} size={18} />
              </div>
              <div>
                <div className="nm">{c.name}</div>
                <div className="muted text-xs mono">{c.state}</div>
              </div>
            </div>
            <div className="ds">{c.desc}</div>
            <div className="row">
              <a className="btn btn-sm btn-ghost" href="#" onClick={e => e.preventDefault()}>
                Docs <svg width="10" height="10" viewBox="0 0 10 10" style={{ marginLeft: 2 }}><path d="M3 7L7 3 M4 3h3v3" stroke="currentColor" fill="none"/></svg>
              </a>
              <div style={{ flex: 1 }} />
              {c.state === "Installed" ? (
                <button className="btn btn-sm">Remove</button>
              ) : (
                <button className="btn btn-sm btn-primary">Install</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   Brain page
   ========================================================= */
function BrainPage() {
  const para = ["Projects", "Areas", "Resources", "Archive"];
  const [cat, setCat] = useS("Projects");
  const items = [
    { t: "Flowstate v2 design system", date: "Today", excerpt: "Tokens, components, motion. Replaces v1." },
    { t: "Auth rotation rollout plan", date: "Today", excerpt: "Three-window plan with rollback at each step." },
    { t: "Q3 OKRs", date: "Yesterday", excerpt: "1) Ship MCP marketplace 2) GPU mode 3) …" },
    { t: "Reading: DDIA Ch.5", date: "Wed", excerpt: "Replication tradeoffs · sync vs async · single leader …" }
  ];
  const [sel, setSel] = useS(items[0]);
  return (
    <div className="screen-enter" style={{ height: "100%", display: "grid", gridTemplateColumns: "320px 1fr" }}>
      <aside style={{ borderRight: "1px solid var(--border)", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div className="eyebrow">Brain</div>
          <div style={{ marginTop: 6, color: "var(--ink-strong)", fontSize: 20, fontWeight: 300, letterSpacing: "-0.015em" }}>1,284 notes</div>
          <div className="muted text-xs mt-1 mono">~/Documents/Flowstate Vault</div>
        </div>
        <input className="field" placeholder="Search notes…" />
        <input className="field" placeholder="Quick capture…" style={{ borderColor: "var(--accent)" }} />
        <div className="row gap-1" style={{ flexWrap: "wrap" }}>
          {para.map(c => (
            <button key={c} className={"btn btn-sm " + (cat === c ? "" : "btn-ghost")} onClick={() => setCat(c)}>{c}</button>
          ))}
        </div>
        <div className="scroll" style={{ flex: 1, overflowY: "auto", margin: "0 -8px" }}>
          {items.map((it, i) => (
            <div key={i} onClick={() => setSel(it)}
              style={{
                padding: "10px 12px", margin: "0 4px", borderRadius: 6, cursor: "pointer",
                background: sel.t === it.t ? "rgba(240,236,226,0.06)" : "transparent"
              }}>
              <div style={{ fontSize: 13, color: "var(--ink-strong)" }}>{it.t}</div>
              <div className="muted text-xs mt-1">{it.date} · {it.excerpt}</div>
            </div>
          ))}
        </div>
      </aside>
      <div className="scroll" style={{ padding: "40px 56px", overflowY: "auto" }}>
        <div className="muted text-xs mono">{sel.date}</div>
        <h1 style={{ fontWeight: 300, fontSize: 36, color: "var(--ink-strong)", letterSpacing: "-0.02em", margin: "8px 0 16px" }}>{sel.t}</h1>
        <p className="muted">{sel.excerpt}</p>
        <h3 style={{ color: "var(--ink-strong)", fontWeight: 500, fontSize: 13, marginTop: 28, fontFamily: "var(--font-mono)", letterSpacing: ".08em", textTransform: "uppercase" }}>Tokens</h3>
        <p className="muted">Warm-neutral monochrome. <span className="mono" style={{color: "var(--ink)"}}>--bg #0e0d0c</span>, <span className="mono" style={{color: "var(--ink)"}}>--ink #f0ece2</span>. Two accents only — platinum + a softer bone.</p>
        <h3 style={{ color: "var(--ink-strong)", fontWeight: 500, fontSize: 13, marginTop: 24, fontFamily: "var(--font-mono)", letterSpacing: ".08em", textTransform: "uppercase" }}>Open questions</h3>
        <ul className="muted" style={{ lineHeight: 1.7 }}>
          <li>Should the mascot speak proactively, or only on hover?</li>
          <li>Card vs. flat list for chat history — A/B with two users this week.</li>
        </ul>
      </div>
    </div>
  );
}

/* =========================================================
   Settings page
   ========================================================= */
function CloudProviderRow({ name, glyph, connected, plan }) {
  const [state, setState] = useS(connected ? "connected" : "idle");
  const [mode, setMode] = useS("oauth"); // "oauth" | "key"
  const [account, setAccount] = useS(connected);
  const [key, setKey] = useS("");

  const connect = () => {
    setState("connecting");
    setTimeout(() => {
      setAccount({ email: `you@${name.toLowerCase()}.com`, since: "Today" });
      setState("connected");
    }, 1200);
  };
  const disconnect = () => {
    setAccount(null);
    setState("idle");
    setMode("oauth");
    setKey("");
  };

  const tier = useTier();
  const { upsell } = useUpsell();
  const locked = !tierAtLeast(tier, "pro");

  if (locked) {
    return (
      <div className="settings-row" style={{ alignItems: "center", padding: "14px 0" }}>
        <div className="lab" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: "var(--surface-2)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--ink)" }}>
            <BrandLogo name={name} size={14} />
          </span>
          <span className="lock-dim" style={{ color: "var(--ink-strong)" }}>{name}</span>
          <LockBadge tier="pro" />
        </div>
        <div className="row gap-2" style={{ alignItems: "center" }}>
          <span className="muted text-xs">{plan}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => upsell("cloud")} title="Pro feature — click to upgrade">Connect</button>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-row" style={{ alignItems: "start", padding: "14px 0" }}>
      <div className="lab" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 7,
          background: "var(--surface-2)", border: "1px solid var(--border)",
          display: "grid", placeItems: "center",
          color: "var(--ink)"
        }}>
          <BrandLogo name={name} size={14} />
        </span>
        <span style={{ color: "var(--ink-strong)" }}>{name}</span>
      </div>

      <div className="col gap-2">
        {state === "connected" && account ? (
          <>
            <div className="card-2" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
              <span className="pill good"><span className="dot"></span><span>connected</span></span>
              <div className="col" style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: "var(--ink-strong)" }}>{account.email}</div>
                {plan && <div className="muted text-xs">{plan}</div>}
              </div>
              <div className="muted text-xs mono">since {account.since}</div>
              <button className="btn btn-sm btn-ghost" onClick={disconnect}>Disconnect</button>
            </div>
          </>
        ) : state === "connecting" ? (
          <div className="card-2" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="pill streaming"><span className="dot"></span><span>opening browser…</span></span>
            <span className="muted text-xs">Authorizing Flowstate to access {name}</span>
            <button className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setState("idle")}>Cancel</button>
          </div>
        ) : (
          <>
            <div className="tabs" style={{ alignSelf: "flex-start" }}>
              <button className={"tab " + (mode === "oauth" ? "on" : "")} onClick={() => setMode("oauth")}>Sign in</button>
              <button className={"tab " + (mode === "key" ? "on" : "")} onClick={() => setMode("key")}>API key</button>
            </div>
            {mode === "oauth" ? (
              <div className="row gap-3" style={{ alignItems: "center" }}>
                <button className="btn btn-primary btn-sm" onClick={connect}>
                  Connect with {name}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 6h6 M6 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2"/>
                  </svg>
                </button>
                <span className="muted text-xs">Opens your browser. We never see your password.</span>
              </div>
            ) : (
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <input
                  className="field"
                  type="password"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder={`Paste your ${name} API key…`}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={!key}
                  onClick={() => {
                    setAccount({ email: `${name.toLowerCase()} · api key`, since: "Today" });
                    setState("connected");
                  }}
                >Save</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* MCP servers — free includes 2; the 3rd trips a soft-cap nudge (Surface C) */
function McpSection() {
  const tier = useTier();
  const [nudge, setNudge] = useS(false);
  const locked = !tierAtLeast(tier, "pro");
  useE(() => { if (!locked) setNudge(false); }, [locked]);
  return (
    <div className="settings-section">
      <div className="head"><h3>MCP servers</h3><button className="btn btn-sm" onClick={() => locked ? setNudge(true) : null}>Add server</button></div>
      <div className="settings-row"><div className="lab mono" style={{color:"var(--ink)"}}>github-mcp</div><div className="row gap-2"><span className="pill good"><span className="dot"></span><span>running</span></span><button className="btn btn-sm btn-ghost">Edit</button></div></div>
      <div className="settings-row"><div className="lab mono" style={{color:"var(--ink)"}}>filesystem-mcp</div><div className="row gap-2"><span className="pill good"><span className="dot"></span><span>running</span></span><button className="btn btn-sm btn-ghost">Edit</button></div></div>
      {nudge && <SoftCapNudge featureKey="mcp" reason="Free includes 2 MCP servers." />}
    </div>
  );
}

function SettingsPage() {
  const tier = useTier();
  const cloudLocked = !tierAtLeast(tier, "pro");
  const [toast, setToast] = useS(null);
  return (
    <div className="screen-enter settings-page">
      <div className="eyebrow">Settings</div>
      <h2 className="section-title" style={{ marginBottom: 24, fontSize: 32 }}>Preferences</h2>

      <AccountSection />

      <div className="settings-section">
        <div className="head"><h3>Local runtime</h3><span className="pill good"><span className="dot"></span><span>Ollama 0.3.12 · ready</span></span></div>
        <div className="settings-row">
          <div className="lab">Host <span className="hint">Where the Ollama daemon is listening</span></div>
          <input className="field" defaultValue="http://127.0.0.1:11434" />
        </div>
        <div className="settings-row">
          <div className="lab">Orchestrator model <span className="hint">Plans tasks and routes between agents</span></div>
          <select className="field"><option>qwen2.5:32b (recommended)</option><option>claude-sonnet-4.5</option><option>gpt-5</option></select>
        </div>
      </div>

      <div className="settings-section">
        <div className="head">
          <h3>Cloud models</h3>
          {cloudLocked
            ? <span className="pill"><span className="dot" /><span>Pro feature</span></span>
            : <span className="muted text-xs">OAuth or API key. Tokens stay on this machine.</span>}
        </div>

        <CloudProviderRow
          name="Anthropic"
          glyph="✱"
          connected={{ email: "bryce@flowstate.dev", since: "Apr 12" }}
          plan="Claude Pro · Sonnet 4.5 · Opus 4"
        />

        <CloudProviderRow
          name="OpenAI"
          glyph="◌"
          connected={null}
          plan="GPT-5 · GPT-4.1 · o4"
        />

        <CloudProviderRow
          name="Google Gemini"
          glyph="◇"
          connected={null}
          plan="Gemini 2.5 Pro · Flash"
        />

        <CloudProviderRow
          name="Perplexity"
          glyph="◈"
          connected={null}
          plan="Sonar Pro · web-grounded answers"
        />

        <CloudProviderRow
          name="xAI"
          glyph="✕"
          connected={null}
          plan="Grok 4 · Grok 3 Mini"
        />

        <CloudProviderRow
          name="Mistral"
          glyph="◮"
          connected={null}
          plan="Large · Codestral · Pixtral"
        />

        <CloudProviderRow
          name="Cohere"
          glyph="◐"
          connected={null}
          plan="Command R+ · Aya"
        />

        <CloudProviderRow
          name="Groq"
          glyph="⚡"
          connected={null}
          plan="Llama 3.3 70B · Mixtral · super fast"
        />

        <CloudProviderRow
          name="Together"
          glyph="◇"
          connected={null}
          plan="Open-source models · pay per token"
        />

        <CloudProviderRow
          name="Fireworks"
          glyph="✦"
          connected={null}
          plan="Llama · Qwen · DeepSeek"
        />
      </div>

      <McpSection />

      <div className="settings-section">
        <div className="head"><h3>Workspaces</h3></div>
        <div className="settings-row"><div className="lab">Root folder <span className="hint">Each agent gets a sandboxed subfolder here</span></div><input className="field" defaultValue="C:\\Users\\bryce\\Flowstate" /></div>
      </div>

      <div className="settings-section">
        <div className="head"><h3>Appearance</h3></div>
        <div className="settings-row"><div className="lab">Reduce motion <span className="hint">Mascots stop walking; transitions become instant</span></div><div className="row"><input type="checkbox" /></div></div>
        <div className="settings-row"><div className="lab">Compact density <span className="hint">Tighter rows, smaller cards</span></div><div className="row"><input type="checkbox" /></div></div>
      </div>

      <NotificationsSection />

      <SnippetsSection onToast={setToast} />
      <CommandsSection onToast={setToast} />
      <BudgetSection onToast={setToast} />
      <DoctorSection />

      <PackToast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

Object.assign(window, {
  Dashboard, ChatSurface, ModelsPage, ConnectorsPage, BrainPage, SettingsPage, CloudProviderRow, VIEWS
});
