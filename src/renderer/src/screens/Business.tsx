// Business — Polsia-style "run your business" autopilot. Setup wizard
// (profile null) → dashboard (goals, live feed, approval queue, briefing,
// sprint history). Visual port of .design-import/flowstate/project/business.jsx
// wired to ipc.business.* with the prototype's defensive fixes (guarded feed
// pushes, no optimistic-timeout approvals, error boundary).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import type {
  BusinessProfileDto,
  BusinessSprintDto,
  ProposedActionDto,
  BusinessFeedEventDto,
} from '@shared/ipc-channels';

const BIcon = {
  play: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M5 3.5l7 4.5-7 4.5z" stroke="currentColor" strokeLinejoin="round"/></svg>,
  plus: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 3v10 M3 8h10" stroke="currentColor" strokeLinecap="round"/></svg>,
  x: <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 3l10 10 M13 3L3 13" stroke="currentColor" strokeLinecap="round"/></svg>,
  check: <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M3 8.5l3.5 3.5 L13 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  clock: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><path d="M8 5v3l2 1.5" stroke="currentColor"/></svg>,
  chev: <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M4 6l4 4 4-4" stroke="currentColor"/></svg>,
};

const ROLE_META: Record<string, { glyph: string }> = {
  strategy: { glyph: 'ST' },
  marketing: { glyph: 'MK' },
  ops: { glyph: 'OP' },
};

function RoleBadge({ role }: { role: string }): JSX.Element {
  const m = ROLE_META[role.toLowerCase()] ?? { glyph: role.slice(0, 2).toUpperCase() };
  const title = role.charAt(0).toUpperCase() + role.slice(1);
  return (
    <span className="biz-rolebadge" title={title}>
      {m.glyph}
    </span>
  );
}

const ACTION_KIND: Record<string, string> = {
  email: 'Email',
  post: 'Post',
  code: 'Code',
  other: 'Action',
};

type PillKind = '' | 'good' | 'bad' | 'streaming';

const ACTION_STATUS: Record<string, { pill: PillKind; label: string }> = {
  proposed: { pill: '', label: 'proposed' },
  approved: { pill: 'good', label: 'approved' },
  executing: { pill: 'streaming', label: 'executing' },
  done: { pill: 'good', label: 'done' },
  failed: { pill: 'bad', label: 'failed' },
  rejected: { pill: '', label: 'rejected' },
};

const SPRINT_STATUS: Record<string, { pill: PillKind; label: string }> = {
  planning: { pill: 'streaming', label: 'planning' },
  running: { pill: 'streaming', label: 'running' },
  wrapping: { pill: 'streaming', label: 'wrapping' },
  done: { pill: 'good', label: 'done' },
  error: { pill: 'bad', label: 'error' },
};

function Pill({ kind, label }: { kind: PillKind; label: string }): JSX.Element {
  return (
    <span className={'pill ' + kind}>
      <span className="dot"></span>
      <span>{label}</span>
    </span>
  );
}

/* tiny markdown → JSX (headings, bold, list, paragraphs) */
function bizMarkdown(md: string | undefined): JSX.Element[] | null {
  if (!md) return null;
  const lines = md.split('\n');
  const out: JSX.Element[] = [];
  let list: JSX.Element[] = [];
  const flush = (key: string | number): void => {
    if (list.length) {
      out.push(
        <ul key={'ul' + key} className="biz-md-ul">
          {list}
        </ul>,
      );
      list = [];
    }
  };
  const fmt = (s: string): React.ReactNode[] => {
    const parts = s.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? (
        <strong key={i} style={{ color: 'var(--ink-strong)', fontWeight: 600 }}>
          {p.slice(2, -2)}
        </strong>
      ) : (
        <React.Fragment key={i}>{p}</React.Fragment>
      ),
    );
  };
  lines.forEach((ln, i) => {
    if (ln.startsWith('## ')) {
      flush(i);
      out.push(
        <div key={i} className="biz-md-h">
          {ln.slice(3)}
        </div>,
      );
    } else if (ln.startsWith('- ')) {
      list.push(<li key={i}>{fmt(ln.slice(2))}</li>);
    } else if (ln.trim() === '') {
      flush(i);
    } else {
      flush(i);
      out.push(
        <p key={i} className="biz-md-p">
          {fmt(ln)}
        </p>,
      );
    }
  });
  flush('end');
  return out;
}

/* =========================================================
   Error boundary (prototype's ScreenErrorBoundary fix)
   ========================================================= */
class BizErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="biz-page">
          <div className="card biz-card">
            <div className="fc-errline">Business screen crashed: {String(this.state.error)}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* =========================================================
   Setup wizard
   ========================================================= */
function BizSetup({
  initial,
  onSaved,
}: {
  initial: BusinessProfileDto | null;
  onSaved: () => void;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [product, setProduct] = useState(initial?.product ?? '');
  const [audience, setAudience] = useState(initial?.audience ?? '');
  const [goals, setGoals] = useState<string[]>(initial?.goals.length ? initial.goals : ['']);
  const [site, setSite] = useState(initial?.links.site ?? '');
  const [repo, setRepo] = useState(initial?.links.repo ?? '');
  const [time, setTime] = useState(initial?.schedule.time ?? '08:00');
  const [enabled, setEnabled] = useState(initial?.schedule.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setGoal = (i: number, v: string): void => setGoals((g) => g.map((x, j) => (j === i ? v : x)));
  const addGoal = (): void => setGoals((g) => [...g, '']);
  const rmGoal = (i: number): void => setGoals((g) => g.filter((_, j) => j !== i));

  const cleanGoals = goals.map((g) => g.trim()).filter(Boolean);
  const canSave = !!(name.trim() && product.trim() && audience.trim() && cleanGoals.length);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError('');
    try {
      await ipc.business.saveProfile({
        name: name.trim(),
        product: product.trim(),
        audience: audience.trim(),
        goals: cleanGoals,
        links: {
          ...(site.trim() ? { site: site.trim() } : {}),
          ...(repo.trim() ? { repo: repo.trim() } : {}),
        },
        schedule: { enabled, time },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="biz-setup">
      <div className="eyebrow">Business</div>
      <h2 className="section-title" style={{ fontSize: 32, marginTop: 8 }}>
        {initial ? 'Edit your autopilot' : 'Set up your autopilot'}
      </h2>
      <p className="muted mt-3" style={{ maxWidth: 540 }}>
        Tell Flowstate about your company once. Three role agents — <em className="ink">Strategy</em>,
        <em className="ink"> Marketing</em>, and <em className="ink"> Ops</em> — run a daily sprint and
        queue real actions for you to approve.
      </p>

      <div className="card biz-form">
        <div className="fc-field-label">Company name</div>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." />

        <div className="fc-field-label" style={{ marginTop: 16 }}>What you sell</div>
        <input className="field" value={product} onChange={(e) => setProduct(e.target.value)} placeholder="A privacy-first analytics SaaS" />

        <div className="fc-field-label" style={{ marginTop: 16 }}>Who it's for</div>
        <input className="field" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Indie SaaS founders" />

        <div className="fc-field-label" style={{ marginTop: 16 }}>Goals</div>
        <div className="biz-goals">
          {goals.map((g, i) => (
            <div key={i} className="biz-goalrow">
              <input className="field" value={g} onChange={(e) => setGoal(i, e.target.value)} placeholder={`Goal ${i + 1}`} />
              {goals.length > 1 && (
                <button className="btn btn-sm btn-ghost" onClick={() => rmGoal(i)}>
                  {BIcon.x}
                </button>
              )}
            </div>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={addGoal} style={{ alignSelf: 'flex-start' }}>
            {BIcon.plus}
            <span>Add goal</span>
          </button>
        </div>

        <div className="fc-row2" style={{ marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <div className="fc-field-label">
              Site <span className="faint">opt</span>
            </div>
            <input className="field mono" value={site} onChange={(e) => setSite(e.target.value)} placeholder="acme.com" />
          </div>
          <div style={{ flex: 1 }}>
            <div className="fc-field-label">
              Repo <span className="faint">opt</span>
            </div>
            <input className="field mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="github.com/acme/app" />
          </div>
        </div>

        <div className="biz-schedule">
          <div>
            <div className="fc-field-label">Daily sprint</div>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <input className="field mono" type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 110 }} />
              <button
                className={'biz-switch ' + (enabled ? 'on' : '')}
                onClick={() => setEnabled((e) => !e)}
                role="switch"
                aria-checked={enabled}
              >
                <span className="biz-switch-knob" />
              </button>
              <span className="muted text-sm">{enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>

        {error && <div className="fc-errline" style={{ marginTop: 12 }}>{error}</div>}

        <div className="row" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" disabled={!canSave || saving} onClick={() => void save()}>
            {saving ? 'Creating role agents…' : initial ? 'Save changes' : 'Create autopilot'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Approval queue card
   ========================================================= */
function BizActionCard({
  action,
  busy,
  onApprove,
  onReject,
}: {
  action: ProposedActionDto;
  busy: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const st = ACTION_STATUS[action.status] ?? ACTION_STATUS['proposed']!;
  const isCode = action.kind === 'code' || action.kind === 'email';
  const pending = action.status === 'proposed';

  return (
    <div className={'biz-action ' + (pending ? 'pending' : '')}>
      <div className="biz-action-head" onClick={() => setOpen((o) => !o)}>
        <span className={'biz-chev ' + (open ? 'open' : '')}>{BIcon.chev}</span>
        <RoleBadge role={action.role} />
        <span className="biz-action-kind">{ACTION_KIND[action.kind] ?? 'Action'}</span>
        <span className="biz-action-title">{action.title}</span>
        <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <Pill kind={st.pill} label={st.label} />
        </span>
      </div>
      {open && (
        <div className="biz-action-body">
          <div className={isCode ? 'biz-action-pre mono' : 'biz-action-text'}>{action.body}</div>
          {action.result && (
            <div className={'biz-action-result ' + (action.status === 'failed' ? 'fail' : '')}>
              {action.status === 'failed' ? '✕ ' : '→ '}
              {action.result}
            </div>
          )}
        </div>
      )}
      {pending && (
        <div className="biz-action-foot">
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => onReject(action.id)}>
            {BIcon.x}
            <span>Reject</span>
          </button>
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onApprove(action.id)}>
            {BIcon.check}
            <span>Approve</span>
          </button>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Dashboard
   ========================================================= */
const ACTIVE_STATUSES = new Set(['planning', 'running', 'wrapping']);

function BizDashboard({
  profile,
  onEditProfile,
}: {
  profile: BusinessProfileDto;
  onEditProfile: () => void;
}): JSX.Element {
  const [sprints, setSprints] = useState<BusinessSprintDto[]>([]);
  const [actions, setActions] = useState<ProposedActionDto[]>([]);
  const [feed, setFeed] = useState<BusinessFeedEventDto[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [runError, setRunError] = useState('');
  const feedRef = useRef<HTMLDivElement | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [s, a] = await Promise.all([ipc.business.sprints(), ipc.business.actions()]);
      setSprints(s.sprints.filter(Boolean));
      setActions(a.actions.filter(Boolean));
    } catch {
      // transient — feed subscription keeps retrying via events
    }
  }, []);

  // initial load + feed subscription
  useEffect(() => {
    void refresh();
    void ipc.business.feed().then((r) => setFeed(r.events.filter(Boolean))).catch(() => {});
    const unsubscribe = ipc.business.subscribeFeed((ev) => {
      if (!ev?.id) return; // guarded push (prototype crash fix)
      setFeed((f) => {
        if (f.some((x) => x.id === ev.id)) return f;
        const next = [...f, ev];
        return next.length > 500 ? next.slice(-500) : next;
      });
      // state-changing events → debounced re-fetch of sprints + actions
      if (ev.kind !== 'task-tool' && ev.kind !== 'phase') {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void refresh(), 500);
      }
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refresh]);

  // autoscroll feed
  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feed]);

  const activeSprint = sprints.find((s) => ACTIVE_STATUSES.has(s.status)) ?? sprints[sprints.length - 1];
  const running = !!sprints.find((s) => ACTIVE_STATUSES.has(s.status));
  const briefing = [...sprints].reverse().find((s) => s.briefing)?.briefing;
  const history = [...sprints].reverse().filter((s) => s.id !== activeSprint?.id);

  const runSprint = async (): Promise<void> => {
    setRunError('');
    try {
      const res = await ipc.business.runSprint();
      if (res.error) setRunError(res.error);
      await refresh();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  };

  const decide = async (id: string, decision: 'approve' | 'reject'): Promise<void> => {
    setBusyAction(id);
    try {
      if (decision === 'approve') await ipc.business.approve(id);
      else await ipc.business.reject(id);
    } finally {
      setBusyAction(null);
      await refresh();
    }
  };

  const pending = actions.filter((a) => a.status === 'proposed');
  const resolved = actions.filter((a) => a.status !== 'proposed');
  const sStat = SPRINT_STATUS[activeSprint?.status ?? 'done'] ?? SPRINT_STATUS['done']!;

  const fmtTs = (ts: number): string =>
    new Date(ts).toLocaleTimeString(undefined, { hour12: false });

  return (
    <div className="screen-enter biz-page">
      {/* header */}
      <div className="biz-header">
        <div>
          <div className="eyebrow">Business · autopilot</div>
          <h2 className="section-title" style={{ fontSize: 32, marginTop: 8 }}>{profile.name}</h2>
          <div className="biz-sched muted">
            {BIcon.clock}
            <span>Daily sprint {profile.schedule.enabled ? 'at ' + profile.schedule.time : 'paused'}</span>
            <button className="btn btn-sm btn-ghost" onClick={onEditProfile}>Edit</button>
          </div>
        </div>
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          {running && activeSprint && <Pill kind="streaming" label={`sprint ${activeSprint.status}`} />}
          <button className="btn btn-primary" disabled={running} onClick={() => void runSprint()}>
            {BIcon.play}
            <span>Run sprint now</span>
          </button>
        </div>
      </div>

      {runError && <div className="fc-errline" style={{ marginBottom: 12 }}>{runError}</div>}

      <div className="biz-grid">
        {/* left column */}
        <div className="biz-col">
          {/* goals */}
          <div className="card biz-card">
            <div className="biz-card-h">
              <span>Today's goals</span>
              <Pill kind={sStat.pill} label={sStat.label} />
            </div>
            {activeSprint && activeSprint.goals.length > 0 ? (
              <ul className="biz-goallist">
                {activeSprint.goals.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            ) : (
              <div className="biz-empty-line muted">No sprint yet — run one to get goals.</div>
            )}
          </div>

          {/* approval queue — centerpiece */}
          <div className="card biz-card">
            <div className="biz-card-h">
              <span>Approval queue</span>
              {pending.length > 0 && (
                <span className="pill">
                  <span>{pending.length} waiting</span>
                </span>
              )}
            </div>
            {pending.length === 0 && resolved.length === 0 && (
              <div className="biz-empty-line muted">No actions proposed yet.</div>
            )}
            <div className="biz-actions">
              {pending.map(
                (a) =>
                  a && (
                    <BizActionCard
                      key={a.id}
                      action={a}
                      busy={busyAction === a.id}
                      onApprove={(id) => void decide(id, 'approve')}
                      onReject={(id) => void decide(id, 'reject')}
                    />
                  ),
              )}
            </div>
            {resolved.length > 0 && (
              <>
                <div className="biz-resolved-label">Resolved</div>
                <div className="biz-actions">
                  {resolved.map(
                    (a) =>
                      a && (
                        <BizActionCard
                          key={a.id}
                          action={a}
                          busy={busyAction === a.id}
                          onApprove={(id) => void decide(id, 'approve')}
                          onReject={(id) => void decide(id, 'reject')}
                        />
                      ),
                  )}
                </div>
              </>
            )}
          </div>

          {/* briefing */}
          <div className="card biz-card">
            <div className="biz-card-h">
              <span>Latest briefing</span>
            </div>
            {briefing ? (
              <div className="biz-briefing">{bizMarkdown(briefing)}</div>
            ) : (
              <div className="biz-empty-line muted">The first briefing lands after a sprint completes.</div>
            )}
          </div>
        </div>

        {/* right column */}
        <div className="biz-col">
          {/* live feed */}
          <div className="card biz-card biz-feed-card">
            <div className="biz-card-h">
              <span>Live activity</span>
              <Pill kind="streaming" label="live" />
            </div>
            <div className="biz-feed scroll" ref={feedRef} role="log" aria-live="polite" aria-label="business activity feed">
              {feed.filter(Boolean).map((ev) => (
                <div key={ev.id} className={'biz-feed-line kind-' + ev.kind}>
                  <span className="biz-feed-t">{fmtTs(ev.ts)}</span>
                  {ev.role ? <RoleBadge role={ev.role} /> : <span className="biz-feed-sys">·</span>}
                  <span className="biz-feed-text">{ev.text}</span>
                </div>
              ))}
              {feed.length === 0 && (
                <div className="biz-feed-line">
                  <span className="biz-feed-sys">·</span>
                  <span className="biz-feed-text">Waiting for the first sprint…</span>
                </div>
              )}
            </div>
          </div>

          {/* sprint history */}
          <div className="card biz-card">
            <div className="biz-card-h">
              <span>Sprint history</span>
            </div>
            <div className="biz-history">
              {history.length === 0 && <div className="biz-empty-line muted">No past sprints yet.</div>}
              {history.map((h) => {
                const hs = SPRINT_STATUS[h.status] ?? SPRINT_STATUS['done']!;
                return (
                  <div key={h.id} className="biz-hrow">
                    <span className="biz-hdate">{new Date(h.startedAt).toLocaleDateString()}</span>
                    <Pill kind={hs.pill} label={hs.label} />
                    <span className="biz-hmeta mono">
                      {h.goals.length} goals · {h.tasks.length} tasks
                    </span>
                    {h.error && <span className="biz-herror">{h.error}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Business screen (wizard ↔ dashboard)
   ========================================================= */
export function Business(): JSX.Element {
  const [profile, setProfile] = useState<BusinessProfileDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await ipc.business.getProfile();
      setProfile(r.profile);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return <div className="biz-page" />;

  return (
    <BizErrorBoundary>
      {profile && !editing ? (
        <BizDashboard profile={profile} onEditProfile={() => setEditing(true)} />
      ) : (
        <BizSetup
          initial={profile}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </BizErrorBoundary>
  );
}
