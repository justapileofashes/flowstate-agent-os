// Routines — Claude-Code-style scheduled agents. Pick an agent + prompt +
// a friendly schedule (hourly / daily / weekdays / weekly / interval / raw
// cron). The backend ticker fires each routine on schedule, spinning up a
// fresh chat per run. Click a routine's last run to open that session.

import { useEffect, useState, type JSX } from 'react';
import type { AgentDto } from '@shared/chat-types';
import type { RoutineDto, RoutineSchedule } from '@shared/ipc-channels';
import { ipc } from '../lib/ipc';
import { AgentAvatar } from '../lib/agent-icons';

interface Props {
  agents: AgentDto[];
  onOpenChat: (agent: AgentDto, chatId: string) => void;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeSchedule(s: RoutineSchedule): string {
  switch (s.frequency) {
    case 'hourly':
      return `Hourly at :${(s.time?.split(':')[1] ?? '00').padStart(2, '0')}`;
    case 'daily':
      return `Every day at ${s.time ?? '09:00'}`;
    case 'weekdays':
      return `Weekdays at ${s.time ?? '09:00'}`;
    case 'weekly':
      return `Every ${DOW[s.dayOfWeek ?? 1]} at ${s.time ?? '09:00'}`;
    case 'interval':
      return `Every ${s.intervalMinutes ?? 60} min`;
    case 'cron':
      return `Cron: ${s.cron ?? ''}`;
    default:
      return 'Custom';
  }
}

function fmtWhen(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}

export function Routines({ agents, onOpenChat }: Props): JSX.Element {
  const [items, setItems] = useState<RoutineDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RoutineDto | null>(null);

  async function refresh(): Promise<void> {
    const r = await ipc.routines.list();
    setItems(r.items.sort((a, b) => a.nextRunAt - b.nextRunAt));
  }

  useEffect(() => {
    void refresh();
    // Poll so next/last-run timestamps + fire results stay fresh.
    const id = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(id);
  }, []);

  async function toggle(r: RoutineDto): Promise<void> {
    await ipc.routines.toggle(r.id, !r.enabled);
    void refresh();
  }
  async function remove(r: RoutineDto): Promise<void> {
    await ipc.routines.delete(r.id);
    void refresh();
  }
  async function runNow(r: RoutineDto): Promise<void> {
    const res = await ipc.routines.runNow(r.id);
    if (res.ok && res.chatId) {
      const agent = agents.find((a) => a.id === r.agentId);
      if (agent) onOpenChat(agent, res.chatId);
    }
    void refresh();
  }

  return (
    <div
      className="screen-enter h-full overflow-y-auto"
      style={{ padding: '32px 48px 80px', maxWidth: 980, margin: '0 auto' }}
    >
      <header className="row mb-6" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">Routines</div>
          <h2 className="section-title" style={{ fontSize: 32, marginBottom: 6 }}>
            Scheduled agents
          </h2>
          <p className="muted text-sm" style={{ maxWidth: 560 }}>
            Run an agent automatically on a schedule. Each run opens a fresh session you can
            review later. Routines fire while Flowstate is open.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          + New routine
        </button>
      </header>

      {showForm ? (
        <RoutineForm
          agents={agents}
          existing={editing}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowForm(false);
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {items.length === 0 && !showForm ? (
        <div
          className="card"
          style={{ padding: 28, textAlign: 'center', color: 'var(--ink-muted)' }}
        >
          No routines yet. Create one to have an agent run on a schedule —
          e.g. <em className="ink">“Summarise overnight AI news every weekday at 8am.”</em>
        </div>
      ) : null}

      <div className="col gap-2 mt-4">
        {items.map((r) => {
          const agent = agents.find((a) => a.id === r.agentId);
          return (
            <div
              key={r.id}
              className="card"
              style={{
                padding: 14,
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="row gap-2" style={{ alignItems: 'center' }}>
                  {agent ? <AgentAvatar agent={agent} size={20} /> : null}
                  <span style={{ color: 'var(--ink-strong)', fontWeight: 500 }}>{r.name}</span>
                  <span className={r.enabled ? 'pill good' : 'pill'} style={{ height: 18 }}>
                    <span className="dot" />
                    <span>{r.enabled ? 'active' : 'paused'}</span>
                  </span>
                </div>
                <div className="muted text-xs mt-1" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {agent?.name ?? 'unknown agent'} · {r.prompt}
                </div>
                <div className="mono text-xs mt-1" style={{ color: 'var(--ink-faint)', fontSize: 10 }}>
                  {describeSchedule(r.schedule)} · next {fmtWhen(r.nextRunAt)} · last{' '}
                  {fmtWhen(r.lastRunAt)} · {r.runCount} run{r.runCount === 1 ? '' : 's'}
                </div>
              </div>
              <div className="row gap-2">
                {r.lastChatId && agent ? (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => onOpenChat(agent, r.lastChatId!)}
                    title="Open the most recent run"
                  >
                    Last run
                  </button>
                ) : null}
                <button type="button" className="btn btn-sm" onClick={() => void runNow(r)}>
                  Run now
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setEditing(r);
                    setShowForm(true);
                  }}
                >
                  Edit
                </button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void toggle(r)}>
                  {r.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'var(--bad)' }}
                  onClick={() => void remove(r)}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoutineForm({
  agents,
  existing,
  onCancel,
  onSaved,
}: {
  agents: AgentDto[];
  existing: RoutineDto | null;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [name, setName] = useState(existing?.name ?? '');
  const [agentId, setAgentId] = useState(existing?.agentId ?? agents[0]?.id ?? '');
  const [prompt, setPrompt] = useState(existing?.prompt ?? '');
  const [frequency, setFrequency] = useState<RoutineSchedule['frequency']>(
    existing?.schedule.frequency ?? 'daily',
  );
  const [time, setTime] = useState(existing?.schedule.time ?? '09:00');
  const [dayOfWeek, setDayOfWeek] = useState(existing?.schedule.dayOfWeek ?? 1);
  const [intervalMinutes, setIntervalMinutes] = useState(existing?.schedule.intervalMinutes ?? 60);
  const [cron, setCron] = useState(existing?.schedule.cron ?? '0 9 * * 1-5');

  function buildSchedule(): RoutineSchedule {
    switch (frequency) {
      case 'hourly':
        return { frequency, time };
      case 'daily':
        return { frequency, time };
      case 'weekdays':
        return { frequency, time };
      case 'weekly':
        return { frequency, time, dayOfWeek };
      case 'interval':
        return { frequency, intervalMinutes };
      case 'cron':
        return { frequency, cron };
      default:
        return { frequency: 'daily', time };
    }
  }

  async function save(): Promise<void> {
    if (name.trim().length === 0 || prompt.trim().length === 0 || !agentId) return;
    const schedule = buildSchedule();
    if (existing) {
      await ipc.routines.update({ id: existing.id, name, prompt, agentId, schedule });
    } else {
      await ipc.routines.create({ name, agentId, prompt, schedule });
    }
    onSaved();
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div className="eyebrow" style={{ marginBottom: 12 }}>
        {existing ? 'Edit routine' : 'New routine'}
      </div>
      <div className="col gap-3">
        <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
          <div className="lab">Name</div>
          <input
            className="field"
            placeholder="e.g. Morning AI news digest"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
          <div className="lab">Agent</div>
          <select className="field" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr', alignItems: 'start' }}>
          <div className="lab">
            Prompt
            <span className="hint">What the agent should do each run.</span>
          </div>
          <textarea
            className="field"
            style={{ minHeight: 60, resize: 'vertical', paddingTop: 8 }}
            placeholder="Search the web for the latest AI developments and write a concise digest."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>
        <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
          <div className="lab">Frequency</div>
          <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
            {(['daily', 'weekdays', 'weekly', 'hourly', 'interval', 'cron'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={'btn btn-sm ' + (frequency === f ? '' : 'btn-ghost')}
                onClick={() => setFrequency(f)}
              >
                {f === 'interval' ? 'Every N min' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Frequency-specific controls */}
        {(frequency === 'daily' || frequency === 'weekdays' || frequency === 'hourly') ? (
          <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
            <div className="lab">{frequency === 'hourly' ? 'Minute' : 'Time'}</div>
            <input
              type="time"
              className="field"
              style={{ width: 140 }}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        ) : null}
        {frequency === 'weekly' ? (
          <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
            <div className="lab">Day + time</div>
            <div className="row gap-2">
              <select
                className="field"
                style={{ width: 120 }}
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {DOW.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="time"
                className="field"
                style={{ width: 140 }}
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          </div>
        ) : null}
        {frequency === 'interval' ? (
          <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
            <div className="lab">Interval (minutes)</div>
            <input
              type="number"
              className="field"
              style={{ width: 120 }}
              min={1}
              max={60 * 24 * 30}
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
            />
          </div>
        ) : null}
        {frequency === 'cron' ? (
          <div className="settings-row" style={{ gridTemplateColumns: '160px 1fr' }}>
            <div className="lab">
              Cron
              <span className="hint">m h dom mon dow</span>
            </div>
            <input
              className="field mono"
              placeholder="0 9 * * 1-5"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
            />
          </div>
        ) : null}

        <div className="row gap-2" style={{ justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="button" className="btn btn-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void save()}
            disabled={name.trim().length === 0 || prompt.trim().length === 0 || !agentId}
          >
            {existing ? 'Save changes' : 'Create routine'}
          </button>
        </div>
      </div>
    </div>
  );
}
