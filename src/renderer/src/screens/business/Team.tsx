// Team & schedule: the daily rhythm, the nine roles (enable, model tier,
// limits, auto-approve ceiling, extra cron schedule, standing instruction,
// run now), and which model each tier routes to — with live health.

import { useState } from 'react';
import { AUTO_APPROVE_LEVELS, MODEL_ALIASES, type AgentConfigDto, type AutoApproveLevel, type CompanyConfig, type ModelAlias } from '@shared/business/types';
import { biz, errText, useBiz, useBizLive } from './api';
import type { Patch } from './Connections';
import { CardHead, ErrorLine, FieldLabel, Icon, Pill, RoleBadge, ROLE_LABEL, Switch } from './ui';

const ALIAS_INFO: Record<ModelAlias, string> = {
  planner: 'Planning, CEO, SDR, support, ads — a fast reasoning model',
  writer: 'Customer-facing copy — your best writer',
  coding: 'The coder — a coding specialist',
  cheap: 'Research, finance, goal checks, reviews — cheapest competent model',
  embed: 'Memory embeddings — empty uses built-in offline hashing',
};

const AUTO_LABEL: Record<AutoApproveLevel, string> = { none: 'never', low: 'low risk', medium: 'up to medium' };

function AgentRow({ agent, onChange }: { agent: AgentConfigDto; onChange: () => void }): JSX.Element {
  const { company } = useBizLive();
  const [open, setOpen] = useState(false);
  const [cron, setCron] = useState(agent.scheduleCron);
  const [instruction, setInstruction] = useState(agent.standingInstruction);
  const [err, setErr] = useState('');
  const [ran, setRan] = useState('');
  const update = async (patch: Partial<Pick<AgentConfigDto, 'enabled' | 'scheduleCron' | 'modelAlias' | 'maxIterations' | 'costCapCredits' | 'autoApproveUpTo' | 'standingInstruction'>>): Promise<void> => {
    setErr('');
    try {
      const r = await biz('agents.update', { companyId: company.id, agentId: agent.id, ...patch });
      if (r.error) setErr(r.error);
      onChange();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className={`biz-agent ${agent.enabled ? '' : 'off'}`}>
      <div className="biz-agent-head">
        <RoleBadge role={agent.role} />
        <button className="biz-agent-name" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {ROLE_LABEL[agent.role]}
          <span className={`biz-chev ${open ? 'open' : ''}`}>{Icon.chev}</span>
        </button>
        <span className="faint mono biz-small">{agent.modelAlias}</span>
        {agent.scheduleCron && <span className="biz-action-kind" title="own schedule">{agent.scheduleCron}</span>}
        <span style={{ marginLeft: 'auto' }} className="row gap-2">
          {agent.role !== 'ceo' && (
            <button
              className="btn btn-sm btn-ghost"
              disabled={!agent.enabled}
              onClick={async () => {
                const r = await biz('agents.runRole', { companyId: company.id, role: agent.role });
                setRan(r.error ?? (r.alreadyRunning ? 'a cycle is already running' : 'started'));
              }}
            >
              {Icon.play}
              <span>Run now</span>
            </button>
          )}
          {agent.role !== 'ceo' && <Switch on={agent.enabled} onChange={(v) => void update({ enabled: v })} label={`Enable ${agent.role}`} />}
        </span>
      </div>
      {ran && <div className="biz-setting-sub">{ran}</div>}
      {open && (
        <div className="biz-agent-body">
          <div className="biz-grid4">
            <label className="biz-numfield">
              <span>Model tier</span>
              <select className="field" value={agent.modelAlias} onChange={(e) => void update({ modelAlias: e.target.value as ModelAlias })}>
                {MODEL_ALIASES.filter((a) => a !== 'embed').map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="biz-numfield">
              <span>Max steps per run</span>
              <input className="field mono" type="number" min={1} max={40} defaultValue={agent.maxIterations} onBlur={(e) => void update({ maxIterations: Math.max(1, Math.min(40, Number(e.target.value) || 1)) })} />
            </label>
            <label className="biz-numfield">
              <span>Credit cap per run</span>
              <input className="field mono" type="number" min={1} defaultValue={agent.costCapCredits} onBlur={(e) => void update({ costCapCredits: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
            <label className="biz-numfield">
              <span>Auto-approve</span>
              <select className="field" value={agent.autoApproveUpTo} onChange={(e) => void update({ autoApproveUpTo: e.target.value as AutoApproveLevel })}>
                {AUTO_APPROVE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {AUTO_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="biz-setting-sub">Auto-approve only applies within the company's autonomy tier; deploys, pricing, refunds and validation always wait for you.</div>
          {agent.role !== 'ceo' && (
            <>
              <FieldLabel hint='5-field cron, e.g. "0 */3 * * *" = every 3 hours; empty = only when the CEO dispatches it'>Own schedule</FieldLabel>
              <div className="biz-goalrow">
                <input className="field mono" value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 */3 * * *" />
                <button className="btn btn-sm" disabled={cron === agent.scheduleCron} onClick={() => void update({ scheduleCron: cron.trim() })}>Save</button>
              </div>
            </>
          )}
          <FieldLabel hint="added to this role's prompt every run">Standing instruction</FieldLabel>
          <textarea className="field biz-textarea" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Always write replies in Spanish for customers from Spain" />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}>
            <button className="btn btn-sm" disabled={instruction === agent.standingInstruction} onClick={() => void update({ standingInstruction: instruction })}>Save instruction</button>
          </div>
        </div>
      )}
      <ErrorLine error={err} />
    </div>
  );
}

export function Team({ draft, patch }: { draft: CompanyConfig; patch: Patch }): JSX.Element {
  const { company, version } = useBizLive();
  const agents = useBiz('agents.list', { companyId: company.id }, [version]);
  const models = useBiz('models.list', {}, []);
  const health = useBiz('models.health', { companyId: company.id }, [version]);
  const s = draft.schedule;
  return (
    <div className="biz-col">
      <div className="card biz-card">
        <CardHead title="Daily rhythm" />
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Run every day</div>
            <div className="biz-setting-sub">Morning: perceive → plan → dispatch. Evening: summary, lessons and a drift check.</div>
          </div>
          <Switch on={s.enabled} onChange={(v) => patch((c) => ({ ...c, schedule: { ...c.schedule, enabled: v } }))} label="Run every day" />
        </div>
        <div className="biz-grid4" style={{ opacity: s.enabled ? 1 : 0.45 }}>
          <label className="biz-numfield">
            <span>Morning plan</span>
            <input className="field mono" type="time" value={s.morning} disabled={!s.enabled} onChange={(e) => patch((c) => ({ ...c, schedule: { ...c.schedule, morning: e.target.value } }))} />
          </label>
          <label className="biz-numfield">
            <span>Evening summary</span>
            <input className="field mono" type="time" value={s.evening} disabled={!s.enabled} onChange={(e) => patch((c) => ({ ...c, schedule: { ...c.schedule, evening: e.target.value } }))} />
          </label>
          <label className="biz-numfield" style={{ gridColumn: 'span 2' }}>
            <span>Catch-up window if Flowstate was closed (minutes)</span>
            <input className="field mono" type="number" min={0} max={1440} value={s.catchUpMinutes} disabled={!s.enabled} onChange={(e) => patch((c) => ({ ...c, schedule: { ...c.schedule, catchUpMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) } }))} />
          </label>
        </div>
      </div>

      <div className="card biz-card">
        <CardHead title="Team" sub="Nine roles, each with a bounded set of skills. Changes save immediately." />
        <ErrorLine error={agents.error} />
        <div className="biz-agents">
          {(agents.data?.agents ?? []).map((a) => (
            <AgentRow key={a.id} agent={a} onChange={agents.reload} />
          ))}
        </div>
      </div>

      <div className="card biz-card">
        <CardHead title="Models" sub="Each tier routes to one model, then falls back down your fallback chain (Settings → Models) if a provider fails." />
        {MODEL_ALIASES.map((alias) => {
          const h = health.data?.aliases.find((x) => x.alias === alias);
          return (
            <div key={alias} className="biz-setting-row">
              <div style={{ minWidth: 0 }}>
                <div className="biz-setting-name">{alias}</div>
                <div className="biz-setting-sub">{ALIAS_INFO[alias]}</div>
                {h && alias !== 'embed' && (
                  <div className="row gap-2 biz-small" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                    <span className="faint mono">{h.chain.join(' → ') || 'no model'}</span>
                    {h.circuitOpen && <Pill kind="bad" label={`${h.provider} paused`} title="provider failing — circuit open for 60s" />}
                    {h.textProtocol && <Pill label="text tools" title="this model has no native tool calling; using the text protocol" />}
                  </div>
                )}
              </div>
              <select
                className="field biz-model-select"
                value={draft.models[alias]}
                onChange={(e) => patch((c) => ({ ...c, models: { ...c.models, [alias]: e.target.value } }))}
              >
                <option value="">{alias === 'embed' ? 'Built-in (offline)' : `Default${models.data?.defaultModel ? ` (${models.data.defaultModel})` : ''}`}</option>
                {alias === 'embed' && <option value="text-embedding-3-small">text-embedding-3-small (OpenAI)</option>}
                {(models.data?.models ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {draft.models[alias] && !(models.data?.models ?? []).includes(draft.models[alias]) && draft.models[alias] !== 'text-embedding-3-small' && (
                  <option value={draft.models[alias]}>{draft.models[alias]}</option>
                )}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
