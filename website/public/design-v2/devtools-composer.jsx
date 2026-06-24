/* global React, PackToast */
/* =========================================================
   devtools-composer.jsx — the vibe-dev composer.

   Five of the ten surfaces converge in the chat composer, so they
   live in one component that drives the typed ipc.devtools.* surface:

     · Surface 1  prompt snippets   (`:` popover + fill-in modal)
     · Surface 2  custom commands   (`/` popover, merged with builtins)
     · Surface 4  @file mentions    (autocomplete + resolved pill chips)
     · Surface 5  project context   (convention chip)
     · Surface 6  token preflight   (mono counter)
     · Surface 9  prompt history    (ArrowUp / ArrowDown recall)
     · Surface 3  budget guard      (pre-send check, warn note / block)

   Expansion math is the backend's job at send; here the prototype
   previews it so reviewers can see resolved text.
   ========================================================= */
const { useState: dcS, useEffect: dcE, useRef: dcR } = React;

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const kTok = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n));

const BUILTIN_CMDS = [
  { cmd: "/run",      hint: "Send to another agent" },
  { cmd: "/file",     hint: "Attach a file" },
  { cmd: "/snapshot", hint: "Take a workspace snapshot" },
  { cmd: "/clear",    hint: "Clear context, keep system prompt" }
];

/* ---------- small chips ---------- */
function MentionChip({ path, onRemove }) {
  const base = path.split("/").pop();
  return (
    <span className="mchip" title={path}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M7.5 3.5L4 7a1.6 1.6 0 102.3 2.3l3.2-3.2a2.4 2.4 0 10-3.4-3.4L2.7 5.9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
      <span className="mchip-name">{base}</span>
      <button onClick={onRemove} aria-label={`Remove ${base}`}>
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor" strokeWidth="1.3"/></svg>
      </button>
    </span>
  );
}

function ConvChip({ conv }) {
  const [open, setOpen] = dcS(false);
  const ref = dcR(null);
  dcE(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!conv.files || !conv.files.length) return null;
  const head = conv.files[0] + (conv.files.length > 1 ? ` +${conv.files.length - 1}` : "");
  return (
    <span className="conv-chip-wrap" ref={ref}>
      <button className={"conv-chip" + (open ? " on" : "")} onClick={() => setOpen(o => !o)} title="House style feeding this agent">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M3 1.5h4.5L9.5 3.5V10a.5.5 0 01-.5.5H3a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5Z" stroke="currentColor" strokeWidth="1"/><path d="M4.3 6h3.4 M4.3 8h2.2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/></svg>
        <span>convention: {head}</span>
      </button>
      {open && (
        <div className="conv-pop dropdown glass" style={{ bottom: "calc(100% + 6px)", top: "auto", left: 0, right: "auto", width: 320 }}>
          <div className="conv-pop-head">Feeding house style</div>
          {conv.files.map((f) => (
            <div key={f} className="conv-pop-file mono">{f}</div>
          ))}
          <div className="conv-pop-pre">{conv.preamble}</div>
        </div>
      )}
    </span>
  );
}

/* ---------- fill-in modal (Surface 1) ---------- */
function FillInModal({ snippet, onCancel, onInsert }) {
  const vars = window.devtoolsVars(snippet.body);
  const [vals, setVals] = dcS(() => {
    const o = {}; vars.forEach((v) => { o[v.name] = v.def || ""; }); return o;
  });
  const preview = window.devtoolsExpand(snippet.body, vals);
  const firstRef = dcR(null);
  dcE(() => { firstRef.current && firstRef.current.focus(); }, []);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal glass fill-modal" style={{ background: "rgba(20,17,14,0.9)" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="row gap-2" style={{ alignItems: "baseline" }}>
            <span style={{ color: "var(--ink-strong)", fontSize: 14 }}>{snippet.label}</span>
            <span className="mono" style={{ color: "var(--ink-faint)", fontSize: 11 }}>:{snippet.name}</span>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor"/></svg>
          </button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="fill-grid">
            {vars.map((v, i) => (
              <label key={v.name} className="fill-field">
                <span className="mono">{v.name}</span>
                <input
                  ref={i === 0 ? firstRef : null}
                  className="field"
                  value={vals[v.name]}
                  placeholder={v.def || "—"}
                  onChange={(e) => setVals((s) => ({ ...s, [v.name]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <div>
            <div className="fill-preview-label">Preview</div>
            <div className="fill-preview mono">{preview}</div>
          </div>
        </div>
        <div className="row" style={{ padding: "0 18px 18px", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onInsert(preview)}>Insert</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- main composer ---------- */
function DevComposer({ agent, chatId, onToast }) {
  const taRef = dcR(null);
  const [draft, setDraft] = dcS("");
  const [caret, setCaret] = dcS(0);
  const [dismissed, setDismissed] = dcS(false);     // popover dismissed via Esc until next type
  const pendingCaret = dcR(null);

  const [snippets, setSnippets] = dcS([]);
  const [commands, setCommands] = dcS([]);
  const [files, setFiles] = dcS([]);
  const [history, setHistory] = dcS([]);
  const histIdx = dcR(-1);
  const stash = dcR("");

  const [mentions, setMentions] = dcS({ paths: [], contextBlock: "" });
  const [conv, setConv] = dcS({ files: [], preamble: "" });
  const [pf, setPf] = dcS(null);
  const [budget, setBudget] = dcS({ level: "ok" });
  const [fill, setFill] = dcS(null);                // { snippet, start, end }
  const [sel, setSel] = dcS(0);                     // popover highlight

  /* load surfaces */
  dcE(() => {
    let on = true;
    const d = window.ipc.devtools, f = window.ipc.files;
    d.listSnippets().then((r) => on && setSnippets(r.snippets));
    d.listCommands().then((r) => on && setCommands(r.commands));
    f.list(agent && agent.name).then((r) => on && setFiles(r.files));
    d.getHistory().then((r) => on && setHistory(r.history));
    d.loadProjectContext(agent && agent.name).then((r) => on && setConv(r));
    d.evaluateBudget(chatId).then((r) => on && setBudget(r));
    return () => { on = false; };
  }, [agent, chatId]);

  /* apply pending caret after a programmatic draft change */
  dcE(() => {
    if (pendingCaret.current != null && taRef.current) {
      const p = pendingCaret.current; pendingCaret.current = null;
      taRef.current.focus();
      try { taRef.current.setSelectionRange(p, p); } catch (_) {}
      setCaret(p);
    }
  }, [draft]);

  /* live @mention resolution (debounced) */
  dcE(() => {
    const id = setTimeout(async () => {
      if (!/(^|\s)@\S/.test(draft)) { setMentions({ paths: [], contextBlock: "" }); return; }
      try { setMentions(await window.ipc.devtools.resolveMentions(agent && agent.name, draft)); } catch (_) {}
    }, 300);
    return () => clearTimeout(id);
  }, [draft, agent]);

  /* token preflight (debounced) */
  dcE(() => {
    const id = setTimeout(async () => {
      const ctxChars = (mentions.contextBlock ? mentions.contextBlock.length : 0) + (conv.preamble ? conv.preamble.length : 0);
      try { setPf(await window.ipc.devtools.preflight(draft, ctxChars, agent && agent.model)); } catch (_) {}
    }, 400);
    return () => clearTimeout(id);
  }, [draft, mentions, conv, agent]);

  /* ---- trigger detection from text before caret ---- */
  const upto = draft.slice(0, caret);
  let trig = null;
  if (!dismissed) {
    let m;
    if ((m = /(^|\s)\/(\w*)$/.exec(upto)))        trig = { kind: "slash", q: m[2], start: caret - m[2].length - 1 };
    else if ((m = /(^|\s):([\w-]*)$/.exec(upto))) trig = { kind: "snip",  q: m[2], start: caret - m[2].length - 1 };
    else if ((m = /(^|\s)@([^\s]*)$/.exec(upto))) trig = { kind: "at",    q: m[2], start: caret - m[2].length - 1 };
  }

  /* popover items for the active trigger */
  const items = (() => {
    if (!trig) return [];
    const q = trig.q.toLowerCase();
    if (trig.kind === "slash") {
      const custom = commands.map((c) => ({ key: c.cmd, token: c.cmd, hint: c.label || c.hint, template: c.template, custom: true }));
      const built = BUILTIN_CMDS.map((c) => ({ key: c.cmd, token: c.cmd, hint: c.hint }));
      return [...custom, ...built].filter((x) => x.token.toLowerCase().startsWith("/" + q)).slice(0, 8);
    }
    if (trig.kind === "snip") {
      return snippets.filter((s) => s.name.includes(q) || s.label.toLowerCase().includes(q))
        .map((s) => ({ key: s.id, token: ":" + s.name, hint: s.label, snippet: s })).slice(0, 8);
    }
    // @ files
    return files.filter((f) => f.toLowerCase().includes(q))
      .map((f) => ({ key: f, token: f, hint: f.includes("/") ? f.split("/").slice(0, -1).join("/") : "workspace" })).slice(0, 9);
  })();

  dcE(() => { setSel(0); }, [trig && trig.kind, trig && trig.q]);

  const insertAt = (start, end, text) => {
    const next = draft.slice(0, start) + text + draft.slice(end);
    pendingCaret.current = start + text.length;
    setDraft(next);
  };

  const pick = (it) => {
    if (!trig) return;
    if (trig.kind === "slash") {
      if (it.custom) {
        const idx = it.template.indexOf("{{input}}");
        const text = it.template.replace("{{input}}", "");
        insertAt(trig.start, caret, text);
        if (idx >= 0) pendingCaret.current = trig.start + idx;
      } else {
        insertAt(trig.start, caret, it.token + " ");
      }
    } else if (trig.kind === "snip") {
      const vars = window.devtoolsVars(it.snippet.body);
      if (vars.length) { setFill({ snippet: it.snippet, start: trig.start, end: caret }); return; }
      insertAt(trig.start, caret, window.devtoolsExpand(it.snippet.body, {}) + " ");
    } else {
      insertAt(trig.start, caret, "@" + it.token + " ");
    }
  };

  const removeMention = (p) => {
    const base = p.split("/").pop();
    const next = draft
      .replace(new RegExp("(^|\\s)@(" + escRe(p) + "|" + escRe(base) + ")(?=\\s|$)", "g"), "$1")
      .replace(/[ \t]{2,}/g, " ");
    setDraft(next);
  };

  const setDraftEnd = (text) => { pendingCaret.current = text.length; setDraft(text); };

  const send = async () => {
    const text = draft.trim();
    if (!text || budget.level === "block") return;
    try {
      const r = await window.ipc.devtools.pushHistory(text);
      setHistory(r.history);
    } catch (_) {}
    histIdx.current = -1; stash.current = "";
    setDraft(""); setMentions({ paths: [], contextBlock: "" }); setPf(null);
    onToast && onToast({
      kind: "ok",
      title: "Message sent",
      sub: mentions.paths.length ? `${mentions.paths.length} file${mentions.paths.length > 1 ? "s" : ""} attached · ${agent && agent.model}` : (agent && agent.model)
    });
    window.ipc.devtools.evaluateBudget(chatId).then(setBudget).catch(() => {});
  };

  const onKeyDown = (e) => {
    if (trig && items.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % items.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(items[sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setDismissed(true); return; }
    }
    if (e.key === "ArrowUp" && (draft === "" || histIdx.current >= 0) && history.length) {
      if (histIdx.current === -1) stash.current = draft;
      const ni = Math.min(histIdx.current + 1, history.length - 1);
      histIdx.current = ni; setDraftEnd(history[ni]); e.preventDefault(); return;
    }
    if (e.key === "ArrowDown" && histIdx.current >= 0) {
      const ni = histIdx.current - 1; histIdx.current = ni;
      setDraftEnd(ni < 0 ? stash.current : history[ni]); e.preventDefault(); return;
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const onChange = (e) => {
    setDraft(e.target.value);
    setCaret(e.target.selectionStart);
    setDismissed(false);
    if (histIdx.current >= 0) histIdx.current = -1;
  };
  const syncCaret = (e) => setCaret(e.target.selectionStart);

  const hasCtx = (conv.files && conv.files.length) || mentions.paths.length;

  return (
    <div className="composer-chat">
      {hasCtx ? (
        <div className="dev-ctx-row">
          <ConvChip conv={conv} />
          {mentions.paths.map((p) => (
            <MentionChip key={p} path={p} onRemove={() => removeMention(p)} />
          ))}
        </div>
      ) : null}

      {budget.level === "warn" && (
        <div className="budget-note" role="note">
          <span className="pill"><span className="dot"></span><span>budget</span></span>
          <span>{budget.message}</span>
        </div>
      )}
      {budget.level === "block" && (
        <div className="budget-note block" role="alert">
          <span className="pill bad"><span className="dot"></span><span>capped</span></span>
          <span>{budget.message} <a onClick={() => window.__flowGoSettings && window.__flowGoSettings()}>Adjust in Settings</a></span>
        </div>
      )}

      {trig && items.length > 0 && (
        <div className="dropdown glass dev-pop" style={{ top: "auto", bottom: "100%", right: "auto", left: 0, marginBottom: 8, minWidth: 320 }}>
          <div className="dev-pop-head">
            {trig.kind === "slash" ? "Commands" : trig.kind === "snip" ? "Snippets" : "Workspace files"}
          </div>
          {items.map((it, i) => (
            <div key={it.key} className={"dropdown-item" + (i === sel ? " sel" : "")}
                 onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); pick(it); }}>
              <span className="mono" style={{ color: "var(--ink)" }}>{it.token}</span>
              <span style={{ color: "var(--ink-faint)", marginLeft: "auto", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>{it.hint}</span>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={taRef}
        placeholder={`Message ${agent.name}…  ( / commands · : snippets · @ files )`}
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onKeyUp={syncCaret}
        onClick={syncCaret}
        onSelect={syncCaret}
      />

      <div className="composer-chat-bar">
        <button className="btn btn-sm btn-ghost" title="Attach">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3.5L4.5 8a2 2 0 102.83 2.83L11.5 6.5a3 3 0 10-4.24-4.24L3 6.5" stroke="currentColor"/></svg>
        </button>
        <button className="btn btn-sm btn-ghost" title="Commands" onClick={() => { setDraftEnd("/"); }}>/</button>

        <span className="dev-counter mono" title={pf && pf.message ? pf.message : "Estimated tokens for this send"}>
          {pf ? `~${kTok(pf.estTokens)}` : "~0"}
          {pf && (pf.level === "warn" || pf.level === "over") && (
            <span className={"dev-counter-flag " + pf.level}>{pf.level === "over" ? "over limit" : "near limit"}</span>
          )}
        </span>

        {history.length > 0 && draft === "" && (
          <span className="dev-hist-hint mono">↑ history</span>
        )}

        <span style={{ color: "var(--ink-faint)", fontFamily: "var(--font-mono)", fontSize: 11, marginLeft: "auto" }}>
          {agent.model}
        </span>
        <button className="btn btn-primary btn-sm" onClick={send} disabled={!draft.trim() || budget.level === "block"}>Send</button>
      </div>

      {fill && (
        <FillInModal
          snippet={fill.snippet}
          onCancel={() => setFill(null)}
          onInsert={(text) => { insertAt(fill.start, fill.end, text + " "); setFill(null); }}
        />
      )}
    </div>
  );
}

Object.assign(window, { DevComposer, FillInModal, MentionChip, ConvChip });
