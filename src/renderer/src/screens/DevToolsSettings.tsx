// Settings managers for the vibe-dev pack: prompt snippets, custom commands,
// spend budget, and the environment doctor. Each section drives ipc.devtools.*
// directly. Design source: Claude Design handoff (devtools-settings.jsx).

import { useEffect, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import type { SnippetDto, UserCommandDto } from '@shared/ipc-channels';

/** Var descriptors referenced in a snippet body (builtins excluded). */
function snippetVars(body: string): Array<{ name: string; def: string }> {
  const out: Array<{ name: string; def: string }> = [];
  const seen = new Set<string>();
  const builtins = new Set(['date', 'time', 'datetime']);
  const re = /\{\{\s*([^}|]+?)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const name = m[1]!.trim();
    if (builtins.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, def: m[2] != null ? m[2].trim() : '' });
  }
  return out;
}

interface SnippetDraft {
  id?: string;
  name: string;
  label: string;
  body: string;
}

function SnippetsSection({ onToast }: { onToast: (m: string) => void }): JSX.Element {
  const [list, setList] = useState<SnippetDto[]>([]);
  const [editing, setEditing] = useState<SnippetDraft | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => void ipc.devtools.listSnippets().then((r) => setList(r.snippets));
  useEffect(() => { load(); }, []);

  const vars = editing ? snippetVars(editing.body) : [];

  const save = async (): Promise<void> => {
    if (!editing) return;
    setBusy(true);
    setErr('');
    const r = await ipc.devtools.saveSnippet(editing);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Could not save.'); return; }
    const was = editing.id;
    setEditing(null);
    load();
    onToast(was ? 'Snippet updated' : 'Snippet added');
  };
  const del = async (s: SnippetDto): Promise<void> => {
    await ipc.devtools.deleteSnippet(s.id);
    load();
    onToast('Snippet removed');
  };

  return (
    <section className="settings-section">
      <div className="head">
        <h3 className="row gap-2" style={{ alignItems: 'center' }}>
          Prompt snippets
        </h3>
        {!editing && (
          <button
            className="btn btn-sm"
            onClick={() => { setEditing({ name: '', label: '', body: '' }); setErr(''); }}
          >
            New snippet
          </button>
        )}
      </div>

      {!editing && (
        <div className="dev-list">
          {list.length === 0 && (
            <div className="dev-empty">No snippets yet. Type <span className="mono">:</span> in the composer to use one.</div>
          )}
          {list.map((s) => (
            <div key={s.id} className="dev-row">
              <div className="dev-row-main">
                <div className="row gap-2" style={{ alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--ink-strong)', fontSize: 13 }}>{s.label}</span>
                  <span className="mono" style={{ color: 'var(--ink-faint)', fontSize: 11 }}>:{s.name}</span>
                </div>
                <div className="dev-row-sub mono">{s.body}</div>
              </div>
              <div className="row gap-1">
                <button className="btn btn-sm btn-ghost" onClick={() => { setEditing({ ...s }); setErr(''); }}>Edit</button>
                <button className="btn btn-sm btn-ghost" onClick={() => void del(s)} title="Delete">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="dev-editor">
          <div className="dev-edit-grid">
            <label className="fill-field">
              <span className="mono">name</span>
              <input className="field" placeholder="pr-review" value={editing.name}
                onChange={(e) => setEditing((s) => (s ? { ...s, name: e.target.value } : s))} />
            </label>
            <label className="fill-field">
              <span className="mono">label</span>
              <input className="field" placeholder="PR review" value={editing.label}
                onChange={(e) => setEditing((s) => (s ? { ...s, label: e.target.value } : s))} />
            </label>
          </div>
          <label className="fill-field">
            <span className="mono">body <span className="dev-edit-hint">{'{{var}}'} · {'{{var|default}}'} · {'{{date}}'}</span></span>
            <textarea className="field dev-textarea" rows={4} placeholder="Review this PR for {{focus|correctness}}…" value={editing.body}
              onChange={(e) => setEditing((s) => (s ? { ...s, body: e.target.value } : s))} />
          </label>
          {vars.length > 0 && (
            <div className="dev-vars">
              <span className="dev-vars-label">vars</span>
              {vars.map((v) => (
                <span key={v.name} className="pill"><span>{v.name}{v.def ? ` = ${v.def}` : ''}</span></span>
              ))}
            </div>
          )}
          {err && <div className="dev-err">{err}</div>}
          <div className="row gap-2" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save snippet'}</button>
          </div>
        </div>
      )}
    </section>
  );
}

function CommandsSection({ onToast }: { onToast: (m: string) => void }): JSX.Element {
  const [rows, setRows] = useState<UserCommandDto[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { void ipc.devtools.listCommands().then((r) => setRows(r.commands)); }, []);

  const patch = (i: number, k: keyof UserCommandDto, v: string): void => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setDirty(true);
  };
  const add = (): void => { setRows((rs) => [...rs, { cmd: '/', label: '', hint: '', template: '{{input}}' }]); setDirty(true); };
  const remove = (i: number): void => { setRows((rs) => rs.filter((_, j) => j !== i)); setDirty(true); };

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    const r = await ipc.devtools.saveCommands(rows);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? 'Could not save.'); return; }
    setDirty(false);
    onToast('Commands saved');
  };

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Custom commands</h3>
        <button className="btn btn-sm" onClick={add}>Add command</button>
      </div>
      <p className="dev-section-note">
        Appear in the composer’s <span className="mono">/</span> popover next to the built-ins.{' '}
        <span className="mono">{'{{input}}'}</span> is replaced by whatever you type after the command.
      </p>

      <div className="dev-list">
        {rows.map((r, i) => (
          <div key={i} className="dev-cmd">
            <div className="dev-cmd-grid">
              <label className="fill-field">
                <span className="mono">cmd</span>
                <input className="field mono" placeholder="/plan" value={r.cmd} onChange={(e) => patch(i, 'cmd', e.target.value)} />
              </label>
              <label className="fill-field">
                <span className="mono">label</span>
                <input className="field" placeholder="Plan" value={r.label} onChange={(e) => patch(i, 'label', e.target.value)} />
              </label>
              <label className="fill-field">
                <span className="mono">hint</span>
                <input className="field" placeholder="Draft a step plan" value={r.hint} onChange={(e) => patch(i, 'hint', e.target.value)} />
              </label>
              <button className="btn btn-sm btn-ghost dev-cmd-del" onClick={() => remove(i)} title="Remove">✕</button>
            </div>
            <label className="fill-field">
              <span className="mono">template</span>
              <textarea className="field dev-textarea" rows={2} placeholder="Make a minimal plan for: {{input}}" value={r.template} onChange={(e) => patch(i, 'template', e.target.value)} />
            </label>
          </div>
        ))}
        {rows.length === 0 && <div className="dev-empty">No custom commands. The built-ins still work.</div>}
      </div>

      {err && <div className="dev-err">{err}</div>}
      <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : dirty ? 'Save commands' : 'Saved'}
        </button>
      </div>
    </section>
  );
}

function BudgetSection({ onToast }: { onToast: (m: string) => void }): JSX.Element {
  const [caps, setCaps] = useState({ perChatUsd: 0, perDayUsd: 0 });
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { void ipc.devtools.getBudgetCaps().then(setCaps); }, []);

  const patch = (k: 'perChatUsd' | 'perDayUsd', v: string): void => {
    setCaps((c) => ({ ...c, [k]: Number(v) || 0 }));
    setDirty(true);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    await ipc.devtools.setBudgetCaps(Number(caps.perChatUsd) || 0, Number(caps.perDayUsd) || 0);
    setBusy(false);
    setDirty(false);
    onToast('Budget saved');
  };

  const Row = ({ k, label, hint }: { k: 'perChatUsd' | 'perDayUsd'; label: string; hint: string }): JSX.Element => (
    <div className="settings-row" style={{ alignItems: 'center' }}>
      <div className="lab">{label} <span className="hint">{hint}</span></div>
      <div className="dev-usd">
        <span className="dev-usd-sign">$</span>
        <input className="field mono" type="number" min="0" step="1" value={caps[k]} onChange={(e) => patch(k, e.target.value)} placeholder="0" />
        <span className="dev-usd-tag">{Number(caps[k]) > 0 ? 'USD' : 'no limit'}</span>
      </div>
    </div>
  );

  return (
    <section className="settings-section">
      <div className="head"><h3>Spend budget</h3><span className="muted text-xs">Soft caps on cloud spend · 0 means no limit</span></div>
      <Row k="perChatUsd" label="Per chat" hint="Warns at 80%, blocks Send at 100%" />
      <Row k="perDayUsd" label="Per day" hint="Resets at local midnight" />
      <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
        <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? 'Saving…' : dirty ? 'Save budget' : 'Saved'}
        </button>
      </div>
    </section>
  );
}

function DoctorSection(): JSX.Element {
  const [report, setReport] = useState<Awaited<ReturnType<typeof ipc.devtools.runDoctor>> | null>(null);
  const [running, setRunning] = useState(false);

  const run = async (): Promise<void> => {
    setRunning(true);
    try { setReport(await ipc.devtools.runDoctor()); } catch { /* keep last */ }
    setRunning(false);
  };

  const dotClass = (s: string): string => (s === 'pass' ? 'good' : s === 'warn' ? '' : 'bad');
  const overallLabel = (o: string): string => (o === 'pass' ? 'All healthy' : o === 'warn' ? 'Healthy with warnings' : 'Needs attention');

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Environment doctor</h3>
        {report
          ? <span className={'pill ' + dotClass(report.overall)}><span className="dot" /><span>{overallLabel(report.overall)}</span></span>
          : <span className="muted text-xs">One-click setup health check</span>}
      </div>

      {!report && !running && (
        <button className="btn" onClick={() => void run()}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2a6 6 0 105.2 3" stroke="currentColor" strokeLinecap="round" /><path d="M8 5v3l2 1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Run diagnostics</span>
        </button>
      )}
      {running && (
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          <svg className="rm-spin" width="15" height="15" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5" stroke="var(--ink-faint)" strokeOpacity="0.35" /><path d="M7 2a5 5 0 0 1 5 5" stroke="currentColor" strokeLinecap="round" /></svg>
          <span className="muted text-sm">Running checks…</span>
        </div>
      )}

      {report && (
        <>
          <div className="doctor-list">
            {report.checks.map((c) => (
              <div key={c.id} className="doctor-row">
                <span className={'doctor-dot pill ' + dotClass(c.status)}><span className="dot" /></span>
                <div className="doctor-main">
                  <div className="doctor-top">
                    <span className="doctor-label">{c.label}</span>
                    <span className="doctor-detail mono">{c.detail}</span>
                  </div>
                  {c.status !== 'pass' && c.hint && <div className="doctor-hint">{c.hint}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => void run()} disabled={running}>Re-run</button>
          </div>
        </>
      )}
    </section>
  );
}

function BackupSection({ onToast }: { onToast: (m: string) => void }): JSX.Element {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);

  const doExport = async (): Promise<void> => {
    setBusy('export');
    try {
      const r = await ipc.backup.export();
      if (r.ok) onToast(`Backed up ${r.agentCount ?? 0} agents`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Export failed');
    }
    setBusy(null);
  };
  const doImport = async (): Promise<void> => {
    setBusy('import');
    try {
      const r = await ipc.backup.import();
      if (r.ok) onToast(`Restored ${r.agentsAdded ?? 0} agents · ${r.settingsRestored ?? 0} settings`);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Restore failed');
    }
    setBusy(null);
  };

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Backup &amp; restore</h3>
        <span className="muted text-xs">Agents + settings · secrets excluded</span>
      </div>
      <div className="settings-row" style={{ alignItems: 'center' }}>
        <div className="lab">
          Full setup
          <span className="hint">Export a portable JSON to move machines or restore later. API keys are never included.</span>
        </div>
        <div className="row gap-2">
          <button className="btn btn-sm" onClick={() => void doExport()} disabled={busy !== null}>
            {busy === 'export' ? 'Exporting…' : 'Export backup'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void doImport()} disabled={busy !== null}>
            {busy === 'import' ? 'Restoring…' : 'Restore…'}
          </button>
        </div>
      </div>
    </section>
  );
}

function CostDashboardSection(): JSX.Element {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof ipc.usage.summary>> | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    void ipc.usage.summary().then(setSummary);
    void ipc.chat.listAgents().then((r) => {
      const map: Record<string, string> = {};
      for (const a of r.agents) map[a.id] = a.name;
      setNames(map);
    });
  }, []);

  const usd = (n: number): string => (n < 0.01 ? '<$0.01' : '$' + n.toFixed(n < 1 ? 3 : 2));

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Cost dashboard</h3>
        <span className="muted text-xs">
          {summary ? `${usd(summary.totalUsd)} · ${summary.totalCalls} calls` : 'Loading…'}
        </span>
      </div>
      {summary && summary.totalCalls === 0 && (
        <div className="dev-empty">No usage recorded yet. Cloud model calls show up here.</div>
      )}
      {summary && summary.byAgent.length > 0 && (
        <div className="doctor-list">
          {summary.byAgent.slice(0, 8).map((a) => (
            <div key={a.agentId} className="doctor-row">
              <div className="doctor-main">
                <div className="doctor-top">
                  <span className="doctor-label">{names[a.agentId] ?? a.agentId}</span>
                  <span className="doctor-detail mono">
                    {a.calls} call{a.calls === 1 ? '' : 's'} · {(a.tokens / 1000).toFixed(1)}k tok
                  </span>
                </div>
              </div>
              <span className="mono" style={{ color: 'var(--ink-strong)', fontSize: 13 }}>{usd(a.costUsd)}</span>
            </div>
          ))}
        </div>
      )}
      {summary && summary.byModel.length > 0 && (
        <div className="dev-vars" style={{ marginTop: 10 }}>
          <span className="dev-vars-label">by model</span>
          {summary.byModel.slice(0, 6).map((m) => (
            <span key={m.model} className="pill"><span className="mono">{m.model}</span><span>· {usd(m.costUsd)}</span></span>
          ))}
        </div>
      )}
    </section>
  );
}

function ModelFallbackSection({ onToast }: { onToast: (m: string) => void }): JSX.Element {
  const [chain, setChain] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void ipc.settings.get('model_fallback_chain').then((r) => setChain(r.value ?? ''));
  }, []);

  const save = async (): Promise<void> => {
    setBusy(true);
    await ipc.settings.set('model_fallback_chain', chain.trim());
    setBusy(false);
    setDirty(false);
    onToast('Fallback chain saved');
  };

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Model fallback</h3>
        <span className="muted text-xs">Auto-retry on rate-limit / OOM / timeout</span>
      </div>
      <div className="settings-row" style={{ alignItems: 'center' }}>
        <div className="lab">
          Fallback chain
          <span className="hint">
            Comma-separated model ids tried in order if the primary fails before producing output.
          </span>
        </div>
        <div className="row gap-2" style={{ flex: 1 }}>
          <input
            className="field mono"
            style={{ flex: 1 }}
            placeholder="llama3.1, mistral, claude-haiku-4"
            value={chain}
            onChange={(e) => { setChain(e.target.value); setDirty(true); }}
          />
          <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>
    </section>
  );
}

export function DevToolsSettings(): JSX.Element {
  const [toast, setToast] = useState<string | null>(null);
  const notify = (m: string): void => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };
  return (
    <>
      <SnippetsSection onToast={notify} />
      <CommandsSection onToast={notify} />
      <BudgetSection onToast={notify} />
      <CostDashboardSection />
      <ModelFallbackSection onToast={notify} />
      <BackupSection onToast={notify} />
      <DoctorSection />
      {toast ? (
        <div className="rounded-md bg-[var(--good-soft)] text-[var(--good)] px-3 py-2 text-sm">{toast}</div>
      ) : null}
    </>
  );
}
