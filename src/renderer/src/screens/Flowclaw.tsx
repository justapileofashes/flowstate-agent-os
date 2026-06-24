// Flowclaw — control plane over self-hosted agent gateways (OpenClaw WS /
// Hermes REST), plus the Appliances tab (Meetings + Capture). Visual port of
// the Claude Design prototype (.design-import/flowstate/project/flowclaw.jsx +
// flowclaw-appliances.jsx) wired to the real IPC surfaces.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import { startSystemAudioCapture } from '../lib/capture';
import type { AgentDto } from '@shared/chat-types';
import type {
  FlowclawConnectionDto,
  FlowclawConnectionInputDto,
  FlowclawSkillsListResponse,
  FlowclawFilesListResponse,
  FlowclawSearchResponse,
  FlowclawMsgProvidersResponse,
  FlowclawMsgListResponse,
  RoutineDto,
  ZoomJobDto,
  CaptureJobDto,
} from '@shared/ipc-channels';

/* ---- kind metadata ---------------------------------------------------- */
const FC_KINDS = {
  openclaw: {
    label: 'OpenClaw',
    proto: 'WebSocket gateway',
    scheme: 'ws',
    defaultPort: 18789,
    authLabel: 'Bearer token',
    glyph: 'OC',
  },
  hermes: {
    label: 'Hermes Agent',
    proto: 'REST · OpenAI-compatible',
    scheme: 'http',
    defaultPort: 8080,
    authLabel: 'API key',
    glyph: 'HE',
  },
} as const;

type FcKind = keyof typeof FC_KINDS;

/* ---- small icons (16px stroke, currentColor) -------------------------- */
const FcIcon = {
  plug: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6 2v3 M10 2v3 M4 5h8v2a4 4 0 01-8 0V5Z M8 11v3" stroke="currentColor"/></svg>,
  bolt: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M9 2L4 9h3l-1 5 5-7H8l1-5Z" stroke="currentColor" strokeLinejoin="round"/></svg>,
  trash: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 5h10 M6 5V3h4v2 M5 5l.5 8h5l.5-8" stroke="currentColor"/></svg>,
  power: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 2v6 M5 4a5 5 0 105.9 0" stroke="currentColor"/></svg>,
  plus: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M8 3v10 M3 8h10" stroke="currentColor" strokeLinecap="round"/></svg>,
  play: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M5 3.5l7 4.5-7 4.5z" stroke="currentColor" strokeLinejoin="round"/></svg>,
  chevron: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6 4l4 4-4 4" stroke="currentColor"/></svg>,
  close: <svg viewBox="0 0 12 12" fill="none" width="12" height="12"><path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor"/></svg>,
  cam: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="2" y="4.5" width="8" height="7" rx="1.5" stroke="currentColor"/><path d="M10 7l4-2v6l-4-2z" stroke="currentColor" strokeLinejoin="round"/></svg>,
  mic: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><rect x="6" y="2" width="4" height="7" rx="2" stroke="currentColor"/><path d="M4 8a4 4 0 008 0 M8 12v2" stroke="currentColor"/></svg>,
  link: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6.5 9.5l3-3 M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1 M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" stroke="currentColor" strokeLinecap="round"/></svg>,
  open: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M6 4H4v8h8v-2 M9 3h4v4 M13 3l-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chat: <svg viewBox="0 0 16 16" fill="none" width="14" height="14"><path d="M3 4.5A1.5 1.5 0 014.5 3h7A1.5 1.5 0 0113 4.5v4A1.5 1.5 0 0111.5 10H6l-3 2.5V4.5Z" stroke="currentColor" strokeLinejoin="round"/></svg>,
  chev: <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M4 6l4 4 4-4" stroke="currentColor"/></svg>,
};

function StatusPill({ kind, label }: { kind: '' | 'good' | 'bad' | 'streaming'; label: string }): JSX.Element {
  return (
    <span className={'pill ' + kind}>
      <span className="dot"></span>
      <span>{label}</span>
    </span>
  );
}

function FcKindBadge({ kind }: { kind: FcKind }): JSX.Element {
  const k = FC_KINDS[kind] ?? FC_KINDS.openclaw;
  return (
    <span className="fc-kind">
      <span className="fc-kind-glyph">{k.glyph}</span>
      {k.label}
    </span>
  );
}

function parseBaseUrl(baseUrl: string): { scheme: string; host: string; port: string } | null {
  try {
    const u = new URL(baseUrl);
    return {
      scheme: u.protocol.replace(/:$/, ''),
      host: u.hostname,
      port: u.port || '',
    };
  } catch {
    return null;
  }
}

/* =========================================================
   Connection card
   ========================================================= */
function FcConnectionCard({
  conn,
  onToggle,
  onEdit,
  onRemove,
}: {
  conn: FlowclawConnectionDto;
  onToggle: (c: FlowclawConnectionDto) => void;
  onEdit: (c: FlowclawConnectionDto) => void;
  onRemove: (c: FlowclawConnectionDto) => void;
}): JSX.Element {
  const k = FC_KINDS[conn.kind] ?? FC_KINDS.openclaw;
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testError, setTestError] = useState('');

  const runTest = async (): Promise<void> => {
    setTestState('testing');
    setTestError('');
    try {
      const res = await ipc.flowclaw.test({ ...conn });
      setTestState(res.ok ? 'ok' : 'fail');
      if (!res.ok) setTestError(res.error ?? 'unreachable');
    } catch (err) {
      setTestState('fail');
      setTestError(err instanceof Error ? err.message : String(err));
    }
    setTimeout(() => setTestState('idle'), 2600);
  };

  const dim = !conn.enabled;

  return (
    <div className="card fc-conn" style={{ opacity: dim ? 0.55 : 1 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <FcKindBadge kind={conn.kind} />
        {conn.enabled ? (
          <StatusPill kind="good" label="enabled" />
        ) : (
          <StatusPill kind="" label="disabled" />
        )}
      </div>

      <div className="fc-conn-label">{conn.label}</div>
      <div className="fc-addr mono">{conn.baseUrl}</div>

      {testState === 'fail' && testError && <div className="fc-errline">{testError}</div>}

      <div className="fc-conn-meta">
        <span className="fc-meta-k">model</span>
        <span className="mono fc-meta-v">{conn.model ?? 'gateway default'}</span>
      </div>
      <div className="fc-conn-meta">
        <span className="fc-meta-k">auth</span>
        <span className="mono fc-meta-v">{k.authLabel} · •••• set</span>
      </div>

      <div className="fc-conn-actions">
        <button className="btn btn-sm" onClick={() => void runTest()} disabled={testState === 'testing'}>
          {FcIcon.bolt}
          <span>
            {testState === 'idle' && 'Test'}
            {testState === 'testing' && 'Testing…'}
            {testState === 'ok' && 'Reachable'}
            {testState === 'fail' && 'Failed'}
          </span>
        </button>
        {testState === 'ok' && <StatusPill kind="good" label="handshake ok" />}
        {testState === 'fail' && <StatusPill kind="bad" label="no route" />}

        <div style={{ flex: 1 }} />

        <button className="btn btn-sm btn-ghost" title={dim ? 'Enable' : 'Disable'} onClick={() => onToggle(conn)}>
          {FcIcon.power}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => onEdit(conn)}>Edit</button>
        <button className="btn btn-sm btn-ghost" title="Remove" onClick={() => onRemove(conn)}>
          {FcIcon.trash}
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   Add / Edit connection sheet
   ========================================================= */
function FcConnectionModal({
  initial,
  models,
  onClose,
  onSave,
}: {
  initial: FlowclawConnectionDto | null;
  models: string[];
  onClose: () => void;
  onSave: (c: FlowclawConnectionInputDto) => void;
}): JSX.Element {
  const isEdit = !!initial;
  const parsed = initial ? parseBaseUrl(initial.baseUrl) : null;
  const [kind, setKind] = useState<FcKind>(initial?.kind ?? 'openclaw');
  const [host, setHost] = useState(parsed?.host ?? '127.0.0.1');
  const [port, setPort] = useState(parsed?.port || String(FC_KINDS[initial?.kind ?? 'openclaw'].defaultPort));
  const [label, setLabel] = useState(initial?.label ?? '');
  const [secret, setSecret] = useState('');
  const [model, setModel] = useState(initial?.model ?? '');
  const [test, setTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const k = FC_KINDS[kind];

  // when kind changes on a new connection, reset the port default
  useEffect(() => {
    if (!isEdit) setPort(String(FC_KINDS[kind].defaultPort));
  }, [kind, isEdit]);

  const baseUrl = `${k.scheme}://${host}:${port}`;

  const buildDto = (): FlowclawConnectionInputDto => ({
    id: initial?.id ?? `conn-${Date.now()}`,
    kind,
    label: label || `${k.label} · ${host}`,
    baseUrl,
    enabled: initial?.enabled ?? true,
    ...(model ? { model } : {}),
    ...(secret ? { token: secret } : {}),
  });

  const runTest = async (): Promise<void> => {
    setTest('testing');
    try {
      const res = await ipc.flowclaw.test(buildDto());
      setTest(res.ok ? 'ok' : 'fail');
    } catch {
      setTest('fail');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal glass fc-modal"
        style={{ background: 'rgba(20,17,14,0.86)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="row gap-3">
            <span style={{ color: 'var(--ink-strong)', fontSize: 14, fontWeight: 500 }}>
              {isEdit ? 'Edit connection' : 'Add connection'}
            </span>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            {FcIcon.close}
            <span>Close</span>
          </button>
        </div>

        <div className="modal-body scroll">
          {/* kind picker */}
          <div className="fc-field-label">Gateway kind</div>
          <div className="fc-kindpick">
            {(Object.entries(FC_KINDS) as Array<[FcKind, (typeof FC_KINDS)[FcKind]]>).map(
              ([id, meta]) => (
                <button key={id} className={'fc-kindopt ' + (kind === id ? 'on' : '')} onClick={() => setKind(id)}>
                  <span className="fc-kind-glyph">{meta.glyph}</span>
                  <span>
                    <span className="fc-kindopt-name">{meta.label}</span>
                    <span className="fc-kindopt-sub mono">{meta.proto}</span>
                  </span>
                </button>
              ),
            )}
          </div>

          {/* host + port */}
          <div className="fc-row2">
            <div style={{ flex: 1 }}>
              <div className="fc-field-label">Host</div>
              <input className="field mono" value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" />
            </div>
            <div style={{ width: 110 }}>
              <div className="fc-field-label">Port</div>
              <input className="field mono" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>
          <div className="hint mono" style={{ marginTop: 6 }}>{baseUrl}</div>

          {/* label */}
          <div className="fc-field-label" style={{ marginTop: 16 }}>
            Label <span className="faint">(optional)</span>
          </div>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${k.label} · ${host}`} />

          {/* secret — write-only, masked */}
          <div className="fc-field-label" style={{ marginTop: 16 }}>{k.authLabel}</div>
          <input
            className="field mono"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={isEdit ? '•••••••• (leave blank to keep)' : 'Paste token…'}
            autoComplete="off"
          />
          <div className="hint">Stored encrypted by the main process. Never read back into the UI.</div>

          {/* model — datalist + free text */}
          <div className="fc-field-label" style={{ marginTop: 16 }}>Model</div>
          <input
            className="field mono"
            list="fc-models"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Pick a model or type an id…"
          />
          <datalist id="fc-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>

        <div className="fc-modal-foot">
          <button className="btn btn-sm" onClick={() => void runTest()} disabled={test === 'testing'}>
            {FcIcon.bolt}
            <span>{test === 'testing' ? 'Testing…' : 'Test connection'}</span>
          </button>
          {test === 'ok' && <StatusPill kind="good" label="handshake ok" />}
          {test === 'fail' && <StatusPill kind="bad" label="unreachable" />}
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => onSave(buildDto())}>
            {isEdit ? 'Save' : 'Add connection'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Tasks tab (Routines visual pattern)
   ========================================================= */
function scheduleLabel(s: RoutineDto['schedule']): string {
  switch (s.frequency) {
    case 'hourly':
      return 'Hourly';
    case 'daily':
      return `Daily${s.time ? ' · ' + s.time : ''}`;
    case 'weekdays':
      return `Weekdays${s.time ? ' · ' + s.time : ''}`;
    case 'weekly':
      return `Weekly${s.time ? ' · ' + s.time : ''}`;
    case 'interval':
      return `Every ${s.intervalMinutes ?? '?'} min`;
    case 'cron':
      return s.cron ?? 'cron';
    default:
      return '—';
  }
}

function FcTaskRow({
  task,
  connections,
  onOpen,
  onRunNow,
}: {
  task: RoutineDto;
  connections: FlowclawConnectionDto[];
  onOpen: (t: RoutineDto) => void;
  onRunNow: (t: RoutineDto) => void;
}): JSX.Element {
  const backendLabel = task.target
    ? (connections.find((c) => c.id === task.target?.connectionId)?.label ?? task.target.connectionId)
    : 'local · Ollama';
  const status = !task.enabled
    ? { pill: '' as const, label: 'paused' }
    : task.lastRunAt
      ? { pill: 'good' as const, label: 'ok' }
      : { pill: '' as const, label: 'never run' };

  return (
    <div className="card-2 fc-task" onClick={() => onOpen(task)}>
      <div className="fc-task-main">
        <div className="fc-task-name">{task.name}</div>
        <div className="fc-task-sub mono">
          <span>{backendLabel}</span>
          <span className="fc-dotsep">·</span>
          <span>{task.target?.model ?? 'agent model'}</span>
          <span className="fc-dotsep">·</span>
          <span>{scheduleLabel(task.schedule)}</span>
        </div>
      </div>
      <div className="fc-task-meta">
        <div className="fc-task-next">
          <span className="faint">next</span> {new Date(task.nextRunAt).toLocaleString()}
        </div>
        <StatusPill kind={status.pill} label={status.label} />
        <button
          className="btn btn-sm btn-ghost"
          title="Run now"
          onClick={(e) => {
            e.stopPropagation();
            onRunNow(task);
          }}
        >
          {FcIcon.play}
        </button>
      </div>
      <span className="fc-task-chev">{FcIcon.chevron}</span>
    </div>
  );
}

/* =========================================================
   Empty state
   ========================================================= */
function FcEmpty({ onAdd }: { onAdd: () => void }): JSX.Element {
  return (
    <div className="fc-empty">
      <div className="fc-empty-mark">{FcIcon.plug}</div>
      <div className="fc-empty-title">No gateways connected</div>
      <p className="muted" style={{ maxWidth: 380, textAlign: 'center' }}>
        Connect Flowstate to a self-hosted agent gateway — an <em className="ink">OpenClaw</em> WebSocket
        endpoint or a <em className="ink">Hermes</em> REST agent. Both can run local models through Ollama.
      </p>
      <button className="btn btn-primary" onClick={onAdd} style={{ marginTop: 16 }}>
        {FcIcon.plus}
        <span>Add your first connection</span>
      </button>
    </div>
  );
}

/* =========================================================
   Appliances — shared bits
   ========================================================= */
const AP_STATUS: Record<string, { pill: '' | 'good' | 'bad' | 'streaming'; label: string }> = {
  armed: { pill: '', label: 'armed' },
  waiting: { pill: 'streaming', label: 'waiting' },
  recording: { pill: 'streaming', label: 'recording' },
  downloading: { pill: 'streaming', label: 'downloading' },
  transcribing: { pill: 'streaming', label: 'transcribing' },
  summarizing: { pill: 'streaming', label: 'summarizing' },
  done: { pill: 'good', label: 'done' },
  error: { pill: 'bad', label: 'error' },
};

function ApStatusChip({ status }: { status: string }): JSX.Element {
  const s = AP_STATUS[status] ?? AP_STATUS['armed']!;
  return <StatusPill kind={s.pill} label={s.label} />;
}

function fmtBytes(n: number): string {
  if (!n) return '0 MB';
  return (n / 1_000_000).toFixed(1) + ' MB';
}

/* shared agent+connection+model selector row */
function ApTargetRow({
  agents,
  connections,
  models,
  agentId,
  setAgentId,
  connId,
  setConnId,
  model,
  setModel,
  listId,
}: {
  agents: AgentDto[];
  connections: FlowclawConnectionDto[];
  models: string[];
  agentId: string;
  setAgentId: (v: string) => void;
  connId: string;
  setConnId: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  listId: string;
}): JSX.Element {
  return (
    <div className="ap-target">
      <label className="ap-sel">
        <span className="fc-field-label">Agent</span>
        <select className="field" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </label>
      <label className="ap-sel">
        <span className="fc-field-label">Flowclaw connection</span>
        <select className="field" value={connId} onChange={(e) => setConnId(e.target.value)}>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="ap-sel">
        <span className="fc-field-label">
          Model <span className="faint">opt</span>
        </span>
        <input className="field mono" list={listId} value={model} onChange={(e) => setModel(e.target.value)} placeholder="default" />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>
    </div>
  );
}

/* shared job list (used by both cards) */
function ApJobList({
  jobs,
  onOpenChat,
  onOpenPath,
  onOpenShare,
}: {
  jobs: Array<{
    id: string;
    title: string;
    sub: string;
    status: string;
    error?: string;
    chatId?: string;
    path?: string;
    shareUrl?: string;
  }>;
  onOpenChat: (chatId: string) => void;
  onOpenPath: (path: string) => void;
  onOpenShare: (url: string) => void;
}): JSX.Element | null {
  if (!jobs.length) return null;
  return (
    <div className="ap-jobs">
      <div className="ap-jobs-label">Recent</div>
      {jobs.filter(Boolean).map((j) => (
        <div key={j.id} className="ap-job">
          <div className="ap-job-main">
            <div className="ap-job-title">{j.title}</div>
            <div className="ap-job-sub mono">
              {j.sub}
              {j.error ? <span style={{ color: 'var(--bad)' }}> · {j.error}</span> : null}
            </div>
          </div>
          <div className="ap-job-actions">
            {j.chatId && (
              <button className="btn btn-sm btn-ghost" title="Open chat" onClick={() => onOpenChat(j.chatId!)}>
                {FcIcon.chat}
              </button>
            )}
            {j.status === 'done' && j.path && (
              <button className="btn btn-sm btn-ghost" title="Open recording" onClick={() => onOpenPath(j.path!)}>
                {FcIcon.open}
              </button>
            )}
            {j.status === 'done' && j.shareUrl && (
              <button className="btn btn-sm btn-ghost" title="Share link" onClick={() => onOpenShare(j.shareUrl!)}>
                {FcIcon.link}
              </button>
            )}
            <ApStatusChip status={j.status} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================
   Meetings card — Zoom recorder (ipc.zoom.*)
   ========================================================= */
function MeetingsCard({
  agents,
  connections,
  models,
  onOpenChat,
}: {
  agents: AgentDto[];
  connections: FlowclawConnectionDto[];
  models: string[];
  onOpenChat: (chatId: string) => void;
}): JSX.Element {
  const [credsOpen, setCredsOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [creds, setCreds] = useState({ accountId: '', clientId: '', clientSecret: '' });
  const [credTest, setCredTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [credError, setCredError] = useState('');

  const [mode, setMode] = useState<'join' | 'new'>('join');
  const [meetingId, setMeetingId] = useState('');
  const [topic, setTopic] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [connId, setConnId] = useState(connections[0]?.id ?? '');
  const [model, setModel] = useState('');
  const [joinUrl, setJoinUrl] = useState<string | null>(null);
  const [arming, setArming] = useState(false);
  const [armError, setArmError] = useState('');
  const [jobs, setJobs] = useState<ZoomJobDto[]>([]);

  // creds saved? a passing auth test on mount means yes
  useEffect(() => {
    let alive = true;
    void ipc.zoom.test().then((r) => {
      if (alive && r.ok) setSaved(true);
      if (alive && !r.ok) setCredsOpen(true);
    }).catch(() => setCredsOpen(true));
    return () => {
      alive = false;
    };
  }, []);

  // poll jobs while mounted
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void ipc.zoom.jobs().then((r) => {
        if (alive) setJobs(r.jobs.filter(Boolean));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const saveCreds = async (): Promise<void> => {
    await ipc.zoom.saveCreds(creds);
    setSaved(true);
    setCredsOpen(false);
    setCreds({ accountId: '', clientId: '', clientSecret: '' });
  };

  const testCreds = async (): Promise<void> => {
    setCredTest('testing');
    setCredError('');
    try {
      const r = await ipc.zoom.test();
      setCredTest(r.ok ? 'ok' : 'fail');
      if (!r.ok) setCredError(r.error ?? 'auth failed');
    } catch (err) {
      setCredTest('fail');
      setCredError(err instanceof Error ? err.message : String(err));
    }
  };

  const arm = async (): Promise<void> => {
    setArming(true);
    setArmError('');
    setJoinUrl(null);
    try {
      const res = await ipc.zoom.record({
        ...(mode === 'join' ? { meetingId: meetingId.replace(/\s+/g, '') } : {}),
        ...(mode === 'new' ? { topic } : {}),
        agentId,
        connectionId: connId,
        ...(model ? { model } : {}),
      });
      if (res.error) setArmError(res.error);
      if (res.joinUrl) setJoinUrl(res.joinUrl);
    } catch (err) {
      setArmError(err instanceof Error ? err.message : String(err));
    } finally {
      setArming(false);
    }
  };

  return (
    <div className="card ap-card">
      <div className="ap-card-head">
        <div className="ap-card-title">
          <span className="ap-card-ic">{FcIcon.cam}</span>
          <div>
            <div className="ap-card-name">
              Meetings <span className="ap-sub">Zoom recorder</span>
            </div>
            <div className="hint">Joins as a participant, records, and summarizes into a chat.</div>
          </div>
        </div>
        {saved ? <StatusPill kind="good" label="credentials saved" /> : <StatusPill kind="bad" label="setup needed" />}
      </div>

      {/* credentials (collapsible) */}
      <button className="ap-collapse" onClick={() => setCredsOpen((o) => !o)}>
        <span className={'ap-chev ' + (credsOpen ? 'open' : '')}>{FcIcon.chev}</span>
        Server-to-Server OAuth credentials
      </button>
      {credsOpen && (
        <div className="ap-creds">
          <div className="fc-field-label">Account ID</div>
          <input className="field mono" value={creds.accountId} onChange={(e) => setCreds({ ...creds, accountId: e.target.value })} placeholder={saved ? '•••••••• (saved)' : 'Paste account id'} />
          <div className="fc-field-label" style={{ marginTop: 12 }}>Client ID</div>
          <input className="field mono" value={creds.clientId} onChange={(e) => setCreds({ ...creds, clientId: e.target.value })} placeholder={saved ? '•••••••• (saved)' : 'Paste client id'} />
          <div className="fc-field-label" style={{ marginTop: 12 }}>Client secret</div>
          <input className="field mono" type="password" value={creds.clientSecret} onChange={(e) => setCreds({ ...creds, clientSecret: e.target.value })} placeholder={saved ? '•••••••• (saved)' : 'Paste client secret'} autoComplete="off" />
          <div className="hint">From a Server-to-Server OAuth app in the Zoom Marketplace. Stored encrypted; never read back.</div>
          {credError && <div className="fc-errline">{credError}</div>}
          <div className="row gap-2" style={{ marginTop: 12 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={!creds.accountId || !creds.clientId || !creds.clientSecret}
              onClick={() => void saveCreds()}
            >
              Save
            </button>
            <button className="btn btn-sm" onClick={() => void testCreds()} disabled={credTest === 'testing'}>
              {FcIcon.link}
              <span>{credTest === 'testing' ? 'Testing…' : 'Test'}</span>
            </button>
            {credTest === 'ok' && <StatusPill kind="good" label="auth ok" />}
          </div>
        </div>
      )}

      {/* record form */}
      <div className="ap-divider" />
      <div className="ap-toggle">
        <button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>Record existing</button>
        <button className={mode === 'new' ? 'on' : ''} onClick={() => setMode('new')}>New meeting</button>
      </div>
      {mode === 'join' ? (
        <>
          <div className="fc-field-label" style={{ marginTop: 12 }}>Meeting ID</div>
          <input className="field mono" value={meetingId} onChange={(e) => setMeetingId(e.target.value)} placeholder="123 4567 8901" />
        </>
      ) : (
        <>
          <div className="fc-field-label" style={{ marginTop: 12 }}>Topic</div>
          <input className="field" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What's the meeting about?" />
        </>
      )}
      <ApTargetRow
        agents={agents}
        connections={connections}
        models={models}
        agentId={agentId}
        setAgentId={setAgentId}
        connId={connId}
        setConnId={setConnId}
        model={model}
        setModel={setModel}
        listId="ap-models-zoom"
      />
      {armError && <div className="fc-errline">{armError}</div>}
      <div className="row gap-2" style={{ marginTop: 12 }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => void arm()}
          disabled={arming || !agentId || !connId || (mode === 'join' ? !meetingId.trim() : !topic.trim())}
        >
          {FcIcon.cam}
          <span>{arming ? 'Arming…' : mode === 'new' ? 'Create & record' : 'Arm recorder'}</span>
        </button>
        {joinUrl && (
          <div className="ap-joinurl mono">
            {FcIcon.link}
            <span>{joinUrl}</span>
            <button className="btn btn-sm btn-ghost" title="Copy" onClick={() => void navigator.clipboard.writeText(joinUrl)}>
              copy
            </button>
          </div>
        )}
      </div>

      <ApJobList
        jobs={jobs.map((j) => ({
          id: j.id,
          title: j.topic,
          sub: new Date(j.createdAt).toLocaleString(),
          status: j.status,
          ...(j.error ? { error: j.error } : {}),
          ...(j.chatId ? { chatId: j.chatId } : {}),
          ...(j.recordingFiles?.[0] ? { path: j.recordingFiles[0] } : {}),
          ...(j.shareUrl ? { shareUrl: j.shareUrl } : {}),
        }))}
        onOpenChat={onOpenChat}
        onOpenPath={(p) => void ipc.zoom.openRecording(p)}
        onOpenShare={(u) => void navigator.clipboard.writeText(u)}
      />
    </div>
  );
}

/* =========================================================
   Capture card — system-audio recorder (ipc.capture.*)
   ========================================================= */
function CaptureCard({
  agents,
  connections,
  models,
  onOpenChat,
}: {
  agents: AgentDto[];
  connections: FlowclawConnectionDto[];
  models: string[];
  onOpenChat: (chatId: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [connId, setConnId] = useState(connections[0]?.id ?? '');
  const [model, setModel] = useState('');

  const [recording, setRecording] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [captureError, setCaptureError] = useState('');
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [jobs, setJobs] = useState<CaptureJobDto[]>([]);

  const [txOpen, setTxOpen] = useState(false);
  const [txMode, setTxMode] = useState<'openai' | 'cli'>('openai');
  const [txUrl, setTxUrl] = useState('https://api.openai.com/v1');
  const [txModel, setTxModel] = useState('whisper-1');
  const [txKey, setTxKey] = useState('');
  const [txCommand, setTxCommand] = useState('whisper {file} --model base --output_format txt');
  const [txTest, setTxTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [txError, setTxError] = useState('');

  // poll jobs while mounted
  useEffect(() => {
    let alive = true;
    const tick = (): void => {
      void ipc.capture.jobs().then((r) => {
        if (alive) setJobs(r.jobs.filter(Boolean));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 3_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (recording) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1_000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [recording]);

  const start = async (): Promise<void> => {
    setCaptureError('');
    try {
      const { captureId } = await ipc.capture.start({
        title: title.trim(),
        agentId,
        connectionId: connId,
        ...(model ? { model } : {}),
      });
      const handle = await startSystemAudioCapture(captureId);
      stopRef.current = handle.stop;
      setActiveId(captureId);
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : String(err));
    }
  };

  const stop = async (): Promise<void> => {
    setRecording(false);
    try {
      await stopRef.current?.();
    } catch (err) {
      setCaptureError(err instanceof Error ? err.message : String(err));
    }
    stopRef.current = null;
    setActiveId(null);
    setTitle('');
  };

  const saveTranscriber = async (): Promise<void> => {
    await ipc.capture.saveTranscriber({
      mode: txMode,
      ...(txMode === 'openai' ? { url: txUrl, model: txModel } : {}),
      ...(txMode === 'openai' && txKey ? { apiKey: txKey } : {}),
      ...(txMode === 'cli' ? { command: txCommand } : {}),
    });
    setTxKey('');
  };

  const testTranscriber = async (): Promise<void> => {
    setTxTest('testing');
    setTxError('');
    try {
      const r = await ipc.capture.testTranscriber();
      setTxTest(r.ok ? 'ok' : 'fail');
      if (!r.ok) setTxError(r.error ?? 'failed');
    } catch (err) {
      setTxTest('fail');
      setTxError(err instanceof Error ? err.message : String(err));
    }
  };

  const liveBytes = activeId ? (jobs.find((j) => j.id === activeId)?.bytes ?? 0) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="card ap-card">
      <div className="ap-card-head">
        <div className="ap-card-title">
          <span className="ap-card-ic">{FcIcon.mic}</span>
          <div>
            <div className="ap-card-name">
              Capture <span className="ap-sub">system audio</span>
            </div>
            <div className="hint">Record any call — Meet, Teams, webinars — by capturing system audio locally.</div>
          </div>
        </div>
        {recording && (
          <span className="pill streaming">
            <span className="dot dot-pulse"></span>
            <span>recording</span>
          </span>
        )}
      </div>

      {!recording ? (
        <>
          <div className="fc-field-label" style={{ marginTop: 4 }}>Title</div>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What are you recording?" />
          <ApTargetRow
            agents={agents}
            connections={connections}
            models={models}
            agentId={agentId}
            setAgentId={setAgentId}
            connId={connId}
            setConnId={setConnId}
            model={model}
            setModel={setModel}
            listId="ap-models-capture"
          />
          {captureError && <div className="fc-errline">{captureError}</div>}
          <button
            className="btn btn-sm btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => void start()}
            disabled={!title.trim() || !agentId || !connId}
          >
            {FcIcon.mic}
            <span>Start capture</span>
          </button>
        </>
      ) : (
        <div className="ap-recording">
          <div className="ap-rec-dot">
            <span className="dot dot-pulse"></span>
          </div>
          <div className="ap-rec-time mono">{mm}:{ss}</div>
          <div className="ap-rec-size mono">{fmtBytes(liveBytes)}</div>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm" onClick={() => void stop()}>Stop</button>
        </div>
      )}

      {/* transcriber settings */}
      <div className="ap-divider" />
      <button className="ap-collapse" onClick={() => setTxOpen((o) => !o)}>
        <span className={'ap-chev ' + (txOpen ? 'open' : '')}>{FcIcon.chev}</span>
        Transcriber settings
      </button>
      {txOpen && (
        <div className="ap-creds">
          <div className="ap-toggle" style={{ marginBottom: 12 }}>
            <button className={txMode === 'openai' ? 'on' : ''} onClick={() => setTxMode('openai')}>OpenAI</button>
            <button className={txMode === 'cli' ? 'on' : ''} onClick={() => setTxMode('cli')}>CLI</button>
          </div>
          {txMode === 'openai' ? (
            <>
              <div className="fc-field-label">Endpoint</div>
              <input className="field mono" value={txUrl} onChange={(e) => setTxUrl(e.target.value)} />
              <div className="fc-field-label" style={{ marginTop: 12 }}>Model</div>
              <input className="field mono" value={txModel} onChange={(e) => setTxModel(e.target.value)} />
              <div className="fc-field-label" style={{ marginTop: 12 }}>
                API key <span className="faint">opt</span>
              </div>
              <input className="field mono" type="password" value={txKey} onChange={(e) => setTxKey(e.target.value)} placeholder="•••••••• (write-only)" autoComplete="off" />
            </>
          ) : (
            <>
              <div className="fc-field-label">Command template</div>
              <input className="field mono" value={txCommand} onChange={(e) => setTxCommand(e.target.value)} />
              <div className="hint">
                Use <span className="mono" style={{ color: 'var(--ink)' }}>{'{file}'}</span> where the audio path goes.
              </div>
            </>
          )}
          {txError && <div className="fc-errline">{txError}</div>}
          <div className="row gap-2" style={{ marginTop: 12 }}>
            <button className="btn btn-sm btn-primary" onClick={() => void saveTranscriber()}>Save</button>
            <button className="btn btn-sm" onClick={() => void testTranscriber()} disabled={txTest === 'testing'}>
              {txTest === 'testing' ? 'Testing…' : 'Test'}
            </button>
            {txTest === 'ok' && <StatusPill kind="good" label="reachable" />}
          </div>
        </div>
      )}

      <div className="hint ap-consent">
        Recording calls may require participant consent depending on your jurisdiction and the host's
        terms. You are responsible for obtaining consent.
      </div>

      <ApJobList
        jobs={jobs.map((j) => ({
          id: j.id,
          title: j.title,
          sub: `${new Date(j.createdAt).toLocaleString()} · ${fmtBytes(j.bytes)}`,
          status: j.status,
          ...(j.error ? { error: j.error } : {}),
          ...(j.chatId ? { chatId: j.chatId } : {}),
          ...(j.status === 'done' ? { path: j.audioPath } : {}),
        }))}
        onOpenChat={onOpenChat}
        onOpenPath={(p) => void navigator.clipboard.writeText(p)}
        onOpenShare={() => {}}
      />
    </div>
  );
}

/* =========================================================
   Capabilities tab — OpenClaw gateway surfaces
   #1 Run · #3 Skills · #4 Memory · #5 Files · #6 Search · #7 Chat
   (OpenClaw-only; Hermes is a plain chat endpoint with no gateway RPC.)
   ========================================================= */
const CAP_TABS = [
  { id: 'run', label: 'Run' },
  { id: 'skills', label: 'Skills' },
  { id: 'memory', label: 'Memory' },
  { id: 'files', label: 'Files' },
  { id: 'search', label: 'Search' },
  { id: 'chat', label: 'Chat' },
] as const;
type CapTab = (typeof CAP_TABS)[number]['id'];

/* ---- #1 Run -------------------------------------------------------------- */
function RunPanel({ connId }: { connId: string }): JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ prompt: string; text: string; error?: boolean }>>([]);

  const run = async (): Promise<void> => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      const res = await ipc.flowclaw.runTask(connId, p, model.trim() || undefined);
      const text = res.ok ? (res.text ?? '(no output)') : (res.error ?? 'run failed');
      setHistory((h) => [{ prompt: p, text, error: !res.ok }, ...h].slice(0, 20));
      if (res.ok) setPrompt('');
    } catch (err) {
      setHistory((h) => [{ prompt: p, text: err instanceof Error ? err.message : String(err), error: true }, ...h]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fc-cap-panel">
      <div className="fc-field-label">Prompt</div>
      <textarea
        className="field"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask the agent to do something autonomously…"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run();
        }}
      />
      <div className="fc-row2" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div className="fc-field-label">Model <span className="faint">(optional override)</span></div>
          <input className="field mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder="connection default" />
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => void run()} disabled={busy || !prompt.trim()}>
          {FcIcon.play}
          <span>{busy ? 'Running…' : 'Run'}</span>
        </button>
      </div>
      <div className="fc-runlog" aria-live="polite">
        {busy && <div className="fc-term fc-term-busy mono">running…<span className="fc-cursor">▌</span></div>}
        {history.map((h, i) => (
          <div key={i} className="fc-runentry">
            <div className="fc-runprompt mono">› {h.prompt}</div>
            <div className={'fc-term mono' + (h.error ? ' fc-term-err' : '')}>{h.text}</div>
          </div>
        ))}
        {!busy && history.length === 0 && <p className="muted">Run output appears here. Ctrl/⌘+Enter to run.</p>}
      </div>
    </div>
  );
}

/* ---- #3 Skills ---------------------------------------------------------- */
function SkillsPanel({ connId }: { connId: string }): JSX.Element {
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<FlowclawSkillsListResponse['skills']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState<string | null>(null);

  const load = useCallback(async (q: string): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const res = await ipc.flowclaw.listSkills(connId, q.trim() || undefined);
      setSkills(res.skills);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connId]);

  useEffect(() => {
    const t = setTimeout(() => void load(query), 280);
    return () => clearTimeout(t);
  }, [query, load]);

  const install = async (id: string): Promise<void> => {
    setInstalling(id);
    try {
      await ipc.flowclaw.installSkill(connId, id);
      setSkills((s) => s.map((k) => (k.id === id ? { ...k, installed: true } : k)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="fc-cap-panel">
      <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 5,000+ community skills…" />
      {error && <div className="fc-errline" style={{ marginTop: 10 }}>{error}</div>}
      <div className="fc-skill-grid" aria-live="polite">
        {loading && skills.length === 0 && <p className="muted">Searching…</p>}
        {!loading && skills.length === 0 && !error && <p className="muted">No skills found.</p>}
        {skills.map((s) => (
          <div key={s.id} className="fc-skill card">
            <div className="fc-skill-name">{s.name}</div>
            {s.description && <div className="fc-skill-desc">{s.description}</div>}
            <div className="fc-skill-foot">
              {s.installed ? (
                <StatusPill kind="good" label="Installed" />
              ) : (
                <button className="btn btn-sm" onClick={() => void install(s.id)} disabled={installing === s.id}>
                  {installing === s.id ? 'Installing…' : 'Install'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- #4 Memory ---------------------------------------------------------- */
function MemoryPanel({ connId }: { connId: string }): JSX.Element {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [got, setGot] = useState<{ key: string; value: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [keys, setKeys] = useState<string[]>([]);

  const get = async (k: string): Promise<void> => {
    const key2 = k.trim();
    if (!key2) return;
    setBusy(true);
    setError('');
    try {
      const res = await ipc.flowclaw.memoryGet(connId, key2);
      setGot({ key: key2, value: res.value });
      setKey(key2);
      setKeys((prev) => (prev.includes(key2) ? prev : [key2, ...prev].slice(0, 12)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const set = async (): Promise<void> => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      await ipc.flowclaw.memorySet(connId, k, value);
      setSaved(true);
      setKeys((prev) => (prev.includes(k) ? prev : [k, ...prev].slice(0, 12)));
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fc-cap-panel">
      <div className="fc-row2" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div className="fc-field-label">Key</div>
          <input className="field mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="user.preferences" />
        </div>
        <button className="btn btn-sm" onClick={() => void get(key)} disabled={busy || !key.trim()}>Get</button>
      </div>
      {keys.length > 0 && (
        <div className="fc-modeltags">
          {keys.map((k) => (
            <button key={k} className="fc-modeltag mono" onClick={() => void get(k)}>{k}</button>
          ))}
        </div>
      )}
      {got && (
        <div className="fc-term mono" style={{ marginTop: 12 }} aria-live="polite">
          {got.value === null ? <span className="faint">(not set)</span> : got.value}
        </div>
      )}
      <div className="fc-field-label" style={{ marginTop: 16 }}>Value</div>
      <textarea className="field" rows={3} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value to store under this key…" />
      <div className="row gap-3" style={{ marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-sm btn-primary" onClick={() => void set()} disabled={busy || !key.trim()}>Set</button>
        {saved && <StatusPill kind="good" label="saved" />}
      </div>
      {error && <div className="fc-errline" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}

/* ---- #5 Files ----------------------------------------------------------- */
function FilesPanel({ connId }: { connId: string }): JSX.Element {
  const [path, setPath] = useState('.');
  const [files, setFiles] = useState<FlowclawFilesListResponse['files']>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [viewing, setViewing] = useState<{ path: string; content: string } | null>(null);

  const list = useCallback(async (p: string): Promise<void> => {
    setLoading(true);
    setError('');
    setViewing(null);
    try {
      const res = await ipc.flowclaw.listFiles(connId, p);
      setFiles(res.files);
      setPath(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [connId]);

  useEffect(() => { void list('.'); }, [list]);

  const open = async (f: FlowclawFilesListResponse['files'][number]): Promise<void> => {
    if (f.kind === 'dir') { void list(f.path); return; }
    setLoading(true);
    setError('');
    try {
      const res = await ipc.flowclaw.readFile(connId, f.path);
      setViewing({ path: f.path, content: res.content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const parent = path !== '.' && path !== '' ? path.replace(/\/?[^/]+\/?$/, '') || '.' : null;

  return (
    <div className="fc-cap-panel">
      <div className="row gap-3" style={{ alignItems: 'center', marginBottom: 10 }}>
        <span className="fc-meta-k">40 GB workspace</span>
        <span className="fc-dotsep">·</span>
        <span className="mono text-xs" style={{ color: 'var(--ink-muted)' }}>{path}</span>
      </div>
      {error && <div className="fc-errline" style={{ marginBottom: 10 }}>{error}</div>}
      {viewing ? (
        <>
          <div className="row gap-3" style={{ marginBottom: 8, alignItems: 'center' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setViewing(null)}>{FcIcon.chevron}<span>Back</span></button>
            <span className="mono text-xs" style={{ color: 'var(--ink-muted)' }}>{viewing.path}</span>
          </div>
          <pre className="fc-term mono fc-fileview" aria-label={`Contents of ${viewing.path}`}>{viewing.content}</pre>
        </>
      ) : (
        <div className="fc-file-list" aria-live="polite">
          {parent && (
            <button className="fc-filerow" onClick={() => void list(parent)}>
              <span className="fc-file-glyph">{FcIcon.chevron}</span><span className="mono">..</span>
            </button>
          )}
          {loading && files.length === 0 && <p className="muted">Loading…</p>}
          {!loading && files.length === 0 && !error && <p className="muted">Empty.</p>}
          {files.map((f) => (
            <button key={f.path} className="fc-filerow" onClick={() => void open(f)}>
              <span className="fc-file-glyph">{f.kind === 'dir' ? '▸' : '·'}</span>
              <span className="mono fc-file-name">{f.path.split('/').pop() || f.path}</span>
              <span className="fc-file-size mono">{f.size === undefined ? '' : fmtBytes(f.size)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- #6 Search ---------------------------------------------------------- */
const SEARCH_SOURCES = ['', 'Web', 'Yahoo Finance', 'X / Twitter'] as const;
function SearchPanel({ connId }: { connId: string }): JSX.Element {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [results, setResults] = useState<FlowclawSearchResponse['results']>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ran, setRan] = useState(false);

  const run = async (): Promise<void> => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await ipc.flowclaw.search(connId, q, source || undefined);
      setResults(res.results);
      setRan(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fc-cap-panel">
      <div className="fc-row2" style={{ alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div className="fc-field-label">Query</div>
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Live search across real-time sources…"
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
          />
        </div>
        <div style={{ width: 150 }}>
          <div className="fc-field-label">Source</div>
          <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>
            {SEARCH_SOURCES.map((s) => <option key={s} value={s}>{s || 'Any'}</option>)}
          </select>
        </div>
        <button className="btn btn-sm btn-primary" onClick={() => void run()} disabled={busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {error && <div className="fc-errline" style={{ marginTop: 10 }}>{error}</div>}
      <div className="fc-search-results" aria-live="polite">
        {ran && !busy && results.length === 0 && !error && <p className="muted">No results.</p>}
        {results.map((r, i) => (
          <div key={i} className="fc-result">
            <div className="fc-result-title">{r.title || r.url || 'Untitled'}</div>
            {r.snippet && <div className="fc-result-snippet">{r.snippet}</div>}
            {r.url && <div className="fc-result-url mono">{r.url}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- #7 Chat — connect messaging apps + send --------------------------- */
type MsgProvider = FlowclawMsgProvidersResponse['providers'][number];
type MsgConn = FlowclawMsgListResponse['connections'][number];

// Used when the gateway doesn't advertise providers (older builds): the common
// bot-token-based messaging apps. The connect RPC still drives the gateway.
const FALLBACK_PROVIDERS: MsgProvider[] = [
  { id: 'telegram', name: 'Telegram', credentialFields: [{ key: 'botToken', label: 'Bot token', secret: true }] },
  { id: 'discord', name: 'Discord', credentialFields: [{ key: 'botToken', label: 'Bot token', secret: true }] },
  { id: 'slack', name: 'Slack', credentialFields: [{ key: 'botToken', label: 'Bot token', secret: true }] },
  { id: 'whatsapp', name: 'WhatsApp', credentialFields: [{ key: 'token', label: 'Access token', secret: true }] },
];

function ChatPanel({ connId }: { connId: string }): JSX.Element {
  const [providers, setProviders] = useState<MsgProvider[]>(FALLBACK_PROVIDERS);
  const [apps, setApps] = useState<MsgConn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // connect form
  const [provider, setProvider] = useState(FALLBACK_PROVIDERS[0]!.id);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [connecting, setConnecting] = useState(false);

  // send form
  const [channel, setChannel] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [log, setLog] = useState<Array<{ channel: string; text: string }>>([]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [p, c] = await Promise.allSettled([
        ipc.flowclaw.msgProviders(connId),
        ipc.flowclaw.msgList(connId),
      ]);
      if (p.status === 'fulfilled' && p.value.providers.length) setProviders(p.value.providers);
      if (c.status === 'fulfilled') setApps(c.value.connections);
      // Surface the connections error (the linking surface is what matters here).
      if (c.status === 'rejected') setError(c.reason instanceof Error ? c.reason.message : String(c.reason));
    } finally {
      setLoading(false);
    }
  }, [connId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const activeProvider = providers.find((p) => p.id === provider) ?? providers[0];
  const fields = activeProvider?.credentialFields ?? [{ key: 'token', label: 'Token', secret: true }];

  const connect = async (): Promise<void> => {
    if (connecting || !activeProvider) return;
    setConnecting(true);
    setError('');
    try {
      await ipc.flowclaw.msgConnect(connId, activeProvider.id, creds, label.trim() || undefined);
      setCreds({});
      setLabel('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async (id: string): Promise<void> => {
    try {
      await ipc.flowclaw.msgDisconnect(connId, id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const send = async (): Promise<void> => {
    const ch = channel.trim();
    const t = text.trim();
    if (!ch || !t || sending) return;
    setSending(true);
    setError('');
    try {
      await ipc.flowclaw.sendMessage(connId, ch, t);
      setLog((l) => [{ channel: ch, text: t }, ...l].slice(0, 30));
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // Build the channel datalist from every connected app's channels.
  const channelOptions = apps.flatMap((a) =>
    (a.channels ?? []).map((ch) => ({ id: ch.id, label: `${a.label || a.provider} · ${ch.name || ch.id}` })),
  );

  return (
    <div className="fc-cap-panel">
      {/* connected apps */}
      <div className="fc-field-label" style={{ margin: 0 }}>Connected apps</div>
      <div className="fc-msg-apps" aria-live="polite">
        {loading && apps.length === 0 && <p className="muted">Loading…</p>}
        {!loading && apps.length === 0 && <p className="muted">No messaging apps linked yet. Connect one below.</p>}
        {apps.map((a) => (
          <div key={a.id} className="fc-msg-app">
            <div className="fc-msg-app-main">
              <span className="fc-msg-app-name">{a.label || a.provider}</span>
              <span className="fc-msg-app-prov mono">{a.provider}</span>
              {a.channels && a.channels.length > 0 && (
                <span className="fc-msg-app-ch mono">{a.channels.length} channel{a.channels.length === 1 ? '' : 's'}</span>
              )}
            </div>
            <StatusPill kind={a.status === 'connected' ? 'good' : a.status === 'error' ? 'bad' : ''} label={a.status ?? 'linked'} />
            <button className="btn btn-sm btn-ghost" onClick={() => void disconnect(a.id)}>Disconnect</button>
          </div>
        ))}
      </div>

      {/* connect a new app */}
      <div className="fc-field-label" style={{ marginTop: 18 }}>Connect an app</div>
      <div className="fc-row2">
        <div style={{ flex: 1 }}>
          <select className="field" value={provider} onChange={(e) => { setProvider(e.target.value); setCreds({}); }}>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" />
        </div>
      </div>
      {fields.map((f) => (
        <input
          key={f.key}
          className="field mono"
          style={{ marginTop: 10 }}
          type={f.secret ? 'password' : 'text'}
          autoComplete="off"
          value={creds[f.key] ?? ''}
          onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
          placeholder={f.label}
        />
      ))}
      <div className="row gap-3" style={{ marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-sm btn-primary" onClick={() => void connect()} disabled={connecting || fields.some((f) => !creds[f.key])}>
          {FcIcon.plug}<span>{connecting ? 'Connecting…' : 'Connect'}</span>
        </button>
        <span className="hint" style={{ margin: 0 }}>Credentials go straight to the gateway — never stored by Flowstate.</span>
      </div>

      {/* send a message */}
      <div className="fc-field-label" style={{ marginTop: 20 }}>Send a message</div>
      <input
        className="field mono"
        list="fc-msg-channels"
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        placeholder="Channel — pick a linked channel or type one (telegram:@group)"
      />
      <datalist id="fc-msg-channels">
        {channelOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </datalist>
      <textarea className="field" style={{ marginTop: 10 }} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message to deliver…" />
      <div className="row gap-3" style={{ marginTop: 10, alignItems: 'center' }}>
        <button className="btn btn-sm" onClick={() => void send()} disabled={sending || !channel.trim() || !text.trim()}>
          {FcIcon.chat}<span>{sending ? 'Sending…' : 'Send'}</span>
        </button>
      </div>

      {error && <div className="fc-errline" style={{ marginTop: 12 }}>{error}</div>}
      <div className="fc-chat-log" aria-live="polite">
        {log.map((m, i) => (
          <div key={i} className="fc-chat-sent">
            <span className="fc-chat-ch mono">{m.channel}</span>
            <span className="fc-chat-txt">{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Capabilities container -------------------------------------------- */
function FcCapabilities({ connections }: { connections: FlowclawConnectionDto[] }): JSX.Element {
  // Capabilities 3–7 are OpenClaw-only; gate to enabled OpenClaw connections.
  const openclaw = connections.filter((c) => c.kind === 'openclaw');
  const [connId, setConnId] = useState(openclaw[0]?.id ?? '');
  const [cap, setCap] = useState<CapTab>('run');

  useEffect(() => {
    if (!openclaw.some((c) => c.id === connId)) setConnId(openclaw[0]?.id ?? '');
  }, [openclaw, connId]);

  if (openclaw.length === 0) {
    return (
      <div className="fc-cap-empty card">
        <p className="muted" style={{ maxWidth: 480 }}>
          Skills, memory, files, search and chat require an enabled <strong>OpenClaw</strong> gateway.
          Add one in the Connections tab to drive these capabilities. Hermes connections expose chat
          runs only.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="fc-cap-bar">
        <span className="fc-field-label" style={{ margin: 0 }}>Gateway</span>
        <select className="field" style={{ width: 'auto', minWidth: 200 }} value={connId} onChange={(e) => setConnId(e.target.value)}>
          {openclaw.map((c) => (
            <option key={c.id} value={c.id}>{c.label || c.baseUrl}</option>
          ))}
        </select>
      </div>
      <div className="fc-subtabs">
        {CAP_TABS.map((t) => (
          <button key={t.id} className={'fc-subtab ' + (cap === t.id ? 'on' : '')} onClick={() => setCap(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {connId && (
        <>
          {cap === 'run' && <RunPanel key={connId} connId={connId} />}
          {cap === 'skills' && <SkillsPanel key={connId} connId={connId} />}
          {cap === 'memory' && <MemoryPanel key={connId} connId={connId} />}
          {cap === 'files' && <FilesPanel key={connId} connId={connId} />}
          {cap === 'search' && <SearchPanel key={connId} connId={connId} />}
          {cap === 'chat' && <ChatPanel key={connId} connId={connId} />}
        </>
      )}
    </div>
  );
}

/* =========================================================
   Flowclaw screen
   ========================================================= */
export function Flowclaw({
  agents,
  onOpenChat,
  onGoRoutines,
}: {
  agents: AgentDto[];
  onOpenChat: (agent: AgentDto, chatId?: string) => void;
  onGoRoutines?: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<'connections' | 'capabilities' | 'tasks' | 'appliances'>('connections');
  const [conns, setConns] = useState<FlowclawConnectionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<RoutineDto[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [editing, setEditing] = useState<FlowclawConnectionDto | 'new' | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [c, r] = await Promise.all([ipc.flowclaw.list(), ipc.routines.list()]);
      setConns(c.connections.filter(Boolean));
      setTasks(r.items.filter(Boolean));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void ipc.chat
      .listModels()
      .then((r) => setModels(r.models.map((m) => m.name)))
      .catch(() => {});
  }, [refresh]);

  const onSave = async (conn: FlowclawConnectionInputDto): Promise<void> => {
    try {
      await ipc.flowclaw.save(conn);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const onToggle = async (conn: FlowclawConnectionDto): Promise<void> => {
    await ipc.flowclaw.save({ ...conn, enabled: !conn.enabled });
    await refresh();
  };
  const onRemove = async (conn: FlowclawConnectionDto): Promise<void> => {
    if (!window.confirm(`Remove connection "${conn.label}"?`)) return;
    await ipc.flowclaw.remove(conn.id);
    await refresh();
  };
  const onRunNow = async (task: RoutineDto): Promise<void> => {
    await ipc.routines.runNow(task.id);
    await refresh();
  };
  const openTaskChat = (task: RoutineDto): void => {
    if (!task.lastChatId) return;
    const agent = agents.find((a) => a.id === task.agentId);
    if (agent) onOpenChat(agent, task.lastChatId);
  };
  const openChatById = (chatId: string): void => {
    // resolve owner agent lazily — first agent fallback keeps the click useful
    const agent = agents[0];
    if (agent) onOpenChat(agent, chatId);
  };

  const enabledConns = conns.filter((c) => c.enabled);
  const enabledCount = enabledConns.length;

  return (
    <div className="screen-enter flowclaw-page">
      <div className="fc-head">
        <div>
          <div className="eyebrow">Flowclaw</div>
          <h2 className="section-title" style={{ fontSize: 32, marginTop: 8 }}>Agent gateways</h2>
          <p className="muted mt-3" style={{ maxWidth: 560 }}>
            A control plane over self-hosted gateways. Connect OpenClaw or Hermes, pick a model
            per connection — including local Ollama models — and schedule tasks against any backend.
          </p>
        </div>
      </div>

      <div className="fc-tabbar">
        <div className="tabs">
          <button className={'tab ' + (tab === 'connections' ? 'on' : '')} onClick={() => setTab('connections')}>
            Connections <span className="faint">{conns.length}</span>
          </button>
          <button className={'tab ' + (tab === 'capabilities' ? 'on' : '')} onClick={() => setTab('capabilities')}>
            Capabilities
          </button>
          <button className={'tab ' + (tab === 'tasks' ? 'on' : '')} onClick={() => setTab('tasks')}>
            Tasks <span className="faint">{tasks.length}</span>
          </button>
          <button className={'tab ' + (tab === 'appliances' ? 'on' : '')} onClick={() => setTab('appliances')}>
            Appliances <span className="faint">2</span>
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {tab === 'connections' && (
          <>
            <span className="muted text-xs mono">{enabledCount}/{conns.length} enabled</span>
            <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
              {FcIcon.plus}
              <span>Add connection</span>
            </button>
          </>
        )}
        {tab === 'tasks' && onGoRoutines && (
          <button className="btn btn-sm btn-primary" onClick={onGoRoutines}>
            {FcIcon.plus}
            <span>New task</span>
          </button>
        )}
      </div>

      {error && <div className="fc-errline" style={{ marginBottom: 12 }}>{error}</div>}

      {tab === 'connections' &&
        (loading ? null : conns.length === 0 ? (
          <FcEmpty onAdd={() => setEditing('new')} />
        ) : (
          <div className="fc-conn-grid">
            {conns.map((c) => (
              <FcConnectionCard
                key={c.id}
                conn={c}
                onToggle={(x) => void onToggle(x)}
                onEdit={setEditing}
                onRemove={(x) => void onRemove(x)}
              />
            ))}
          </div>
        ))}

      {tab === 'capabilities' && <FcCapabilities connections={enabledConns} />}

      {tab === 'tasks' && (
        <div className="fc-task-list">
          {tasks.length === 0 && (
            <p className="muted">No tasks yet. Create one in Routines and point it at a gateway connection.</p>
          )}
          {tasks.map((t) => (
            <FcTaskRow
              key={t.id}
              task={t}
              connections={conns}
              onOpen={openTaskChat}
              onRunNow={(x) => void onRunNow(x)}
            />
          ))}
        </div>
      )}

      {tab === 'appliances' && (
        <div className="ap-grid">
          <MeetingsCard agents={agents} connections={enabledConns} models={models} onOpenChat={openChatById} />
          <CaptureCard agents={agents} connections={enabledConns} models={models} onOpenChat={openChatById} />
        </div>
      )}

      {editing && (
        <FcConnectionModal
          initial={editing === 'new' ? null : editing}
          models={models}
          onClose={() => setEditing(null)}
          onSave={(c) => void onSave(c)}
        />
      )}
    </div>
  );
}
