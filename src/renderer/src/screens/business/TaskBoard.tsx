// Task board (kanban). Owner tasks created here are injected into the next
// cycle ahead of anything the CEO plans. Cards drag between columns.

import { useState } from 'react';
import { ROLE_KEYS, type RoleKey, type TaskDto, type TaskStatus } from '@shared/business/types';
import { biz, errText, fmtAgo, fmtCredits, useBiz, useBizLive } from './api';
import { Empty, ErrorLine, FieldLabel, Icon, Modal, Pill, RoleBadge, ROLE_LABEL, TASK_PILL } from './ui';

const COLUMNS: Array<{ id: string; label: string; statuses: TaskStatus[]; drop: TaskStatus }> = [
  { id: 'backlog', label: 'Backlog', statuses: ['backlog'], drop: 'backlog' },
  { id: 'todo', label: 'To do', statuses: ['todo'], drop: 'todo' },
  { id: 'progress', label: 'In progress', statuses: ['in_progress'], drop: 'in_progress' },
  { id: 'needs', label: 'Needs you', statuses: ['awaiting_approval'], drop: 'awaiting_approval' },
  { id: 'done', label: 'Done', statuses: ['done'], drop: 'done' },
  { id: 'closed', label: 'Closed', statuses: ['failed', 'rejected', 'skipped'], drop: 'skipped' },
];

const SOURCE_LABEL: Record<string, string> = { human: 'you', ceo: 'CEO', planner: 'planner', agent: 'agent', drift: 'drift check', system: 'system' };

function NewTask({ onClose }: { onClose: () => void }): JSX.Element {
  const { company } = useBizLive();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [role, setRole] = useState<RoleKey>('researcher');
  const [priority, setPriority] = useState(2);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await biz('tasks.create', { companyId: company.id, title: title.trim(), description: description.trim(), role, priority });
      onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New task for the team"
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || title.trim().length < 3} onClick={() => void save()}>
            Add to next cycle
          </button>
        </>
      }
    >
      <FieldLabel>Task</FieldLabel>
      <input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Research how Umami prices its cloud plan" />
      <FieldLabel hint="optional — the role sees exactly this">Details</FieldLabel>
      <textarea className="field biz-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="biz-grid4" style={{ marginTop: 4 }}>
        <label className="biz-numfield" style={{ gridColumn: 'span 2' }}>
          <span>Assign to</span>
          <select className="field" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {ROLE_KEYS.filter((r) => r !== 'ceo').map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="biz-numfield" style={{ gridColumn: 'span 2' }}>
          <span>Priority</span>
          <select className="field" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((p) => (
              <option key={p} value={p}>
                {p === 1 ? '1 — urgent' : p === 5 ? '5 — someday' : p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="biz-setting-sub">Owner tasks always make it into the next cycle's plan (budget and guardrails permitting).</div>
      <ErrorLine error={err} />
    </Modal>
  );
}

function TaskCard({ task, onChange, showStatus }: { task: TaskDto; onChange: () => void; showStatus: boolean }): JSX.Element {
  const { company } = useBizLive();
  const [open, setOpen] = useState(false);
  const update = async (patch: { status?: TaskStatus; priority?: number }): Promise<void> => {
    await biz('tasks.update', { companyId: company.id, taskId: task.id, ...patch });
    onChange();
  };
  return (
    <div
      className="biz-task"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/biz-task', task.id)}
      onClick={() => setOpen((o) => !o)}
    >
      <div className="biz-task-top">
        <RoleBadge role={task.assignedRole} />
        <span className="biz-task-p mono" title="priority">P{task.priority}</span>
        {task.approvalRequired && task.status !== 'awaiting_approval' && <span className="biz-action-kind">approval</span>}
        {showStatus && (
          <span style={{ marginLeft: 'auto' }}>
            <Pill {...TASK_PILL[task.status]} />
          </span>
        )}
      </div>
      <div className="biz-task-title">{task.title}</div>
      <div className="biz-task-meta faint">
        from {SOURCE_LABEL[task.source] ?? task.source} · {fmtAgo(task.updatedAt)}
        {task.estimatedCredits ? ` · ~${fmtCredits(task.estimatedCredits)}cr` : ''}
      </div>
      {open && (
        <div className="biz-task-body" onClick={(e) => e.stopPropagation()}>
          {task.description && <div className="biz-action-text">{task.description}</div>}
          {task.result && <div className={`biz-action-result ${task.status === 'failed' ? 'fail' : ''}`}>{task.result}</div>}
          {task.rejectedReason && <div className="biz-action-result fail">Rejected: {task.rejectedReason}</div>}
          <div className="row gap-2" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <select className="field biz-mini-select" value={task.status} onChange={(e) => void update({ status: e.target.value as TaskStatus })}>
              {Object.entries(TASK_PILL).map(([s, v]) => (
                <option key={s} value={s}>
                  {v.label}
                </option>
              ))}
            </select>
            <select className="field biz-mini-select" value={task.priority} onChange={(e) => void update({ priority: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((p) => (
                <option key={p} value={p}>
                  P{p}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm btn-ghost"
              onClick={async () => {
                await biz('tasks.delete', { companyId: company.id, taskId: task.id });
                onChange();
              }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function TaskBoard(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error, reload } = useBiz('tasks.list', { companyId: company.id }, [version]);
  const [creating, setCreating] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const tasks = data?.tasks ?? [];

  const drop = async (col: (typeof COLUMNS)[number], id: string): Promise<void> => {
    setOver(null);
    const t = tasks.find((x) => x.id === id);
    if (!t || col.statuses.includes(t.status)) return;
    await biz('tasks.update', { companyId: company.id, taskId: id, status: col.drop });
    reload();
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div className="biz-setting-sub">Drag cards between columns. Tasks you add run in the next cycle.</div>
        <button className="btn btn-sm btn-primary" onClick={() => setCreating(true)}>
          {Icon.plus}
          <span>New task</span>
        </button>
      </div>
      <ErrorLine error={error} />
      <div className="biz-kanban">
        {COLUMNS.map((col) => {
          const items = tasks.filter((t) => col.statuses.includes(t.status));
          return (
            <div
              key={col.id}
              className={`biz-kcol ${over === col.id ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => void drop(col, e.dataTransfer.getData('text/biz-task'))}
            >
              <div className="biz-kcol-head">
                <span>{col.label}</span>
                <span className="faint mono">{items.length}</span>
              </div>
              <div className="biz-kcol-body">
                {items.map((t) => (
                  <TaskCard key={t.id} task={t} onChange={reload} showStatus={col.id === 'closed'} />
                ))}
                {items.length === 0 && <div className="biz-kcol-empty faint">—</div>}
              </div>
            </div>
          );
        })}
      </div>
      {tasks.length === 0 && !error && <Empty>No tasks yet. The CEO adds them each cycle — or add your own.</Empty>}
      {creating && (
        <NewTask
          onClose={() => {
            setCreating(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
