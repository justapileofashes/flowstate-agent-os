// Company settings. Config edits collect in a draft and save as a new
// version of the single source of truth (with a note); history shows a
// field-level diff of every version. Roster, credentials and data actions
// save immediately.

import { useEffect, useState } from 'react';
import { APPROVAL_MATRIX_ROWS } from '@shared/business/policy';
import type { ActionCategory, CompanyConfig, ConfigVersionDto } from '@shared/business/types';
import { biz, errText, fmtAgo, fmtDateTime, useBiz, useBizLive } from './api';
import { Connections, type Patch } from './Connections';
import { Team } from './Team';
import { CardHead, cleanList, Empty, ErrorLine, FieldLabel, Icon, ListEditor, Modal, Segmented, Switch } from './ui';

type Section = 'profile' | 'guardrails' | 'connections' | 'team' | 'budgets' | 'history' | 'data';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'connections', label: 'Channels & keys' },
  { id: 'team', label: 'Team & models' },
  { id: 'budgets', label: 'Budgets & alerts' },
  { id: 'history', label: 'Config history' },
  { id: 'data', label: 'Data & safety' },
];

function cleanConfig(c: CompanyConfig): CompanyConfig {
  return {
    ...c,
    brandDos: cleanList(c.brandDos),
    brandDonts: cleanList(c.brandDonts),
    pricePoints: cleanList(c.pricePoints),
    goals: cleanList(c.goals),
    kpis: c.kpis.filter((k) => k.name.trim()),
    browse: { allowDomains: cleanList(c.browse.allowDomains), blockDomains: cleanList(c.browse.blockDomains) },
  };
}

function effectiveGate(cat: ActionCategory, c: CompanyConfig): string {
  const tier = c.autonomy;
  switch (cat) {
    case 'read':
    case 'draft':
    case 'internal':
      return 'runs freely';
    case 'publish':
      return tier === 'safe' ? 'needs you' : `auto after ${c.limits.publishCleanThreshold} clean publishes*`;
    case 'outbound':
      return tier === 'autonomous' ? `auto, ≤ ${c.limits.emailsPerDay}/day*` : 'needs you';
    case 'ad_budget':
      return tier === 'safe' ? 'needs you' : `auto within ±${c.limits.adBudgetChangePct}%*`;
    case 'external_write':
      return tier === 'safe' ? 'needs you' : 'auto*';
    case 'config_edit':
      return tier === 'safe' ? 'needs you' : 'applies after 1h unless you object';
    default:
      return 'always needs you';
  }
}

function num(v: string, lo: number, hi: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}

function Profile({ draft, patch }: { draft: CompanyConfig; patch: Patch }): JSX.Element {
  const text = (k: 'name' | 'niche' | 'valueProp' | 'mission' | 'icp' | 'brandVoice' | 'founderNotes') => ({
    value: draft[k],
    onChange: (e: { target: { value: string } }) => patch((c) => ({ ...c, [k]: e.target.value })),
  });
  return (
    <div className="card biz-card">
      <CardHead title="Company profile" sub="The single source of truth every agent reads at the start of every run" />
      <FieldLabel>Name</FieldLabel>
      <input className="field" {...text('name')} />
      <FieldLabel>Niche</FieldLabel>
      <input className="field" {...text('niche')} />
      <FieldLabel>Value proposition</FieldLabel>
      <textarea className="field biz-textarea" {...text('valueProp')} />
      <FieldLabel>Mission</FieldLabel>
      <textarea className="field biz-textarea" {...text('mission')} />
      <FieldLabel>Ideal customer (ICP)</FieldLabel>
      <textarea className="field biz-textarea" {...text('icp')} />
      <FieldLabel>Brand voice</FieldLabel>
      <input className="field" {...text('brandVoice')} />
      <div className="biz-two">
        <div>
          <FieldLabel>Brand dos</FieldLabel>
          <ListEditor values={draft.brandDos} onChange={(v) => patch((c) => ({ ...c, brandDos: v }))} placeholder="Lead with privacy" max={30} />
        </div>
        <div>
          <FieldLabel hint="short phrases are enforced literally">Brand don'ts</FieldLabel>
          <ListEditor values={draft.brandDonts} onChange={(v) => patch((c) => ({ ...c, brandDonts: v }))} placeholder="revolutionary" max={30} />
        </div>
      </div>
      <FieldLabel>Goals</FieldLabel>
      <ListEditor values={draft.goals} onChange={(v) => patch((c) => ({ ...c, goals: v }))} placeholder="Reach $1k MRR" />
      <FieldLabel hint="changes proposed by agents always need your approval">Pricing</FieldLabel>
      <ListEditor values={draft.pricePoints} onChange={(v) => patch((c) => ({ ...c, pricePoints: v }))} placeholder="Starter — $9/mo for 10k pageviews" max={20} />
      <div className="biz-two">
        <div>
          <FieldLabel>Website</FieldLabel>
          <input className="field mono" value={draft.links.site} onChange={(e) => patch((c) => ({ ...c, links: { ...c.links, site: e.target.value } }))} placeholder="acme.com" />
        </div>
        <div>
          <FieldLabel>Repository</FieldLabel>
          <input className="field mono" value={draft.links.repo} onChange={(e) => patch((c) => ({ ...c, links: { ...c.links, repo: e.target.value } }))} placeholder="github.com/acme/site" />
        </div>
      </div>
      <FieldLabel hint="context only you can give">Founder notes</FieldLabel>
      <textarea className="field biz-textarea" {...text('founderNotes')} />
    </div>
  );
}

function Guardrails({ draft, patch }: { draft: CompanyConfig; patch: Patch }): JSX.Element {
  const L = draft.limits;
  const setL = (k: keyof CompanyConfig['limits'], v: number): void => patch((c) => ({ ...c, limits: { ...c.limits, [k]: v } }));
  return (
    <div className="biz-col">
      <div className="card biz-card">
        <CardHead title="Autonomy" />
        <Segmented
          value={draft.autonomy}
          onChange={(v) => patch((c) => ({ ...c, autonomy: v }))}
          options={[
            { value: 'safe', label: 'Safe' },
            { value: 'assisted', label: 'Assisted' },
            { value: 'autonomous', label: 'Autonomous' },
          ]}
        />
        <div className="biz-table-wrap" style={{ marginTop: 14 }}>
          <table className="biz-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Risk</th>
                <th>With this tier</th>
              </tr>
            </thead>
            <tbody>
              {APPROVAL_MATRIX_ROWS.map((r) => (
                <tr key={r.category}>
                  <td>{r.label}</td>
                  <td className="faint">{r.risk}</td>
                  <td className={effectiveGate(r.category, draft) === 'needs you' || !r.configurable ? '' : 'good'}>
                    {effectiveGate(r.category, draft)}
                    {!r.configurable && r.category !== 'read' && <span className="faint"> {Icon.shield}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="biz-setting-sub" style={{ marginTop: 8 }}>
          * only for roles whose auto-approve ceiling allows it (Team & models). Every role starts at “never”.
        </div>
      </div>

      <div className="card biz-card">
        <CardHead title="Limits" sub="Enforced server-side, whatever an agent asks for" />
        <div className="biz-grid4">
          <label className="biz-numfield"><span>Emails per day</span><input className="field mono" type="number" value={L.emailsPerDay} onChange={(e) => setL('emailsPerDay', num(e.target.value, 0, 10_000))} /></label>
          <label className="biz-numfield"><span>Posts per day</span><input className="field mono" type="number" value={L.postsPerDay} onChange={(e) => setL('postsPerDay', num(e.target.value, 0, 500))} /></label>
          <label className="biz-numfield"><span>Pages browsed per day</span><input className="field mono" type="number" value={L.crawlPagesPerDay} onChange={(e) => setL('crawlPagesPerDay', num(e.target.value, 0, 10_000))} /></label>
          <label className="biz-numfield"><span>Clean publishes before auto</span><input className="field mono" type="number" value={L.publishCleanThreshold} onChange={(e) => setL('publishCleanThreshold', num(e.target.value, 0, 1000))} /></label>
          <label className="biz-numfield"><span>Ad change auto band (±%)</span><input className="field mono" type="number" value={L.adBudgetChangePct} onChange={(e) => setL('adBudgetChangePct', num(e.target.value, 0, 100))} /></label>
          <label className="biz-numfield"><span>Ad daily hard cap ($)</span><input className="field mono" type="number" value={L.adDailyCapUsd} onChange={(e) => setL('adDailyCapUsd', num(e.target.value, 0, 1_000_000))} /></label>
        </div>
      </div>

      <div className="card biz-card">
        <CardHead title="Validate before building" />
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Require validation</div>
            <div className="biz-setting-sub">Blocks coder, SDR and ads work until the idea is validated.</div>
          </div>
          <Switch on={draft.validation.required} onChange={(v) => patch((c) => ({ ...c, validation: { ...c.validation, required: v } }))} label="Require validation" />
        </div>
        <FieldLabel>Status</FieldLabel>
        <Segmented
          value={draft.validation.status}
          onChange={(v) => patch((c) => ({ ...c, validation: { ...c.validation, status: v } }))}
          options={[
            { value: 'pending', label: 'Pending' },
            { value: 'passed', label: 'Passed' },
            { value: 'waived', label: 'Waived' },
          ]}
        />
        {draft.validation.evidence && (
          <>
            <FieldLabel>Evidence you accepted</FieldLabel>
            <pre className="biz-action-pre">{draft.validation.evidence}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function Budgets({ draft, patch }: { draft: CompanyConfig; patch: Patch }): JSX.Element {
  const B = draft.budgets;
  const setB = (k: keyof CompanyConfig['budgets'], v: number): void => patch((c) => ({ ...c, budgets: { ...c.budgets, [k]: v } }));
  const N = draft.notifications;
  return (
    <div className="biz-col">
      <div className="card biz-card">
        <CardHead title="Budgets" sub="1 credit = $0.01 of cloud spend, or 4,000 tokens on a local model" />
        <div className="biz-grid4">
          <label className="biz-numfield"><span>Credits per cycle</span><input className="field mono" type="number" value={B.cycleCredits} onChange={(e) => setB('cycleCredits', num(e.target.value, 1, 100_000))} /></label>
          <label className="biz-numfield"><span>Credits per month</span><input className="field mono" type="number" value={B.monthlyCredits} onChange={(e) => setB('monthlyCredits', num(e.target.value, 1, 10_000_000))} /></label>
          <label className="biz-numfield"><span>USD cap per cycle (0 = none)</span><input className="field mono" type="number" step={0.5} value={B.cycleUsd} onChange={(e) => setB('cycleUsd', num(e.target.value, 0, 10_000))} /></label>
          <label className="biz-numfield"><span>USD cap per month (0 = none)</span><input className="field mono" type="number" value={B.monthlyUsd} onChange={(e) => setB('monthlyUsd', num(e.target.value, 0, 100_000))} /></label>
          <label className="biz-numfield"><span>Alert at (% of month)</span><input className="field mono" type="number" value={Math.round(B.alertRatio * 100)} onChange={(e) => setB('alertRatio', num(e.target.value, 10, 100) / 100)} /></label>
        </div>
      </div>
      <div className="card biz-card">
        <CardHead title="Notifications" />
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Desktop</div>
            <div className="biz-setting-sub">Cycle finished, approvals waiting, budget alerts — when Flowstate isn't focused.</div>
          </div>
          <Switch on={N.desktop} onChange={(v) => patch((c) => ({ ...c, notifications: { ...c.notifications, desktop: v } }))} label="Desktop notifications" />
        </div>
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Slack</div>
            <div className="biz-setting-sub">Needs the Slack alerts integration (incoming webhook).</div>
          </div>
          <Switch on={N.slack} onChange={(v) => patch((c) => ({ ...c, notifications: { ...c.notifications, slack: v } }))} label="Slack notifications" />
        </div>
        <FieldLabel hint="sent through your email provider after the evening summary">Daily digest email</FieldLabel>
        <input className="field mono" value={N.digestEmail} onChange={(e) => patch((c) => ({ ...c, notifications: { ...c.notifications, digestEmail: e.target.value } }))} placeholder="you@yourdomain.com" />
      </div>
    </div>
  );
}

function diffConfigs(a: CompanyConfig, b: CompanyConfig): Array<{ key: string; from: string; to: string }> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Array<{ key: string; from: string; to: string }> = [];
  for (const k of keys) {
    const x = JSON.stringify((a as Record<string, unknown>)[k] ?? null);
    const y = JSON.stringify((b as Record<string, unknown>)[k] ?? null);
    if (x !== y) out.push({ key: k, from: x, to: y });
  }
  return out;
}

function History(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error } = useBiz('companies.configHistory', { companyId: company.id }, [version]);
  const versions: ConfigVersionDto[] = data?.versions ?? [];
  return (
    <div className="card biz-card">
      <CardHead title="Config history" sub="Append-only — every edit, by you or an approved agent proposal" />
      <ErrorLine error={error} />
      {versions.map((v, i) => {
        const prev = versions[i + 1];
        const changes = prev ? diffConfigs(prev.config, v.config) : [];
        return (
          <details key={v.version} className="biz-version" open={i === 0}>
            <summary>
              <span className="mono">v{v.version}</span>
              <span className="biz-action-kind">{v.editedBy}</span>
              <span>{v.note || '—'}</span>
              <span className="faint biz-small" style={{ marginLeft: 'auto' }}>{fmtDateTime(v.editedAt)}</span>
            </summary>
            {prev ? (
              changes.length ? (
                <div className="biz-diff">
                  {changes.map((c) => (
                    <div key={c.key} className="biz-diff-row">
                      <span className="mono biz-diff-key">{c.key}</span>
                      <span className="biz-diff-from mono">{c.from.slice(0, 400)}</span>
                      <span className="biz-diff-to mono">{c.to.slice(0, 400)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="biz-setting-sub">No field changes.</div>
              )
            ) : (
              <div className="biz-setting-sub">First version.</div>
            )}
          </details>
        );
      })}
    </div>
  );
}

function Data(): JSX.Element {
  const { company, version, refresh } = useBizLive();
  const status = useBiz('status', {}, [version]);
  const audit = useBiz('audit.list', { companyId: company.id }, [version]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState('');
  const run = async (fn: () => Promise<string>): Promise<void> => {
    setErr('');
    setMsg('');
    try {
      setMsg(await fn());
      refresh();
    } catch (e) {
      setErr(errText(e));
    }
  };
  const enabled = status.data?.enabled ?? true;
  return (
    <div className="biz-col">
      <div className="card biz-card">
        <CardHead title="Your data" sub="Everything the team produced, as JSON + CSV. No lock-in." />
        <button
          className="btn btn-sm"
          onClick={() =>
            void run(async () => {
              const r = await biz('companies.export', { companyId: company.id });
              return r.canceled ? '' : r.path ? `Exported to ${r.path}` : r.error ?? '';
            })
          }
        >
          {Icon.download}
          <span>Export company</span>
        </button>
      </div>

      <div className="card biz-card">
        <CardHead title="Safety" />
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Emergency stop (all companies)</div>
            <div className="biz-setting-sub">Stops running cycles and pauses every scheduled job until you turn it back on.</div>
          </div>
          <Switch on={!enabled} onChange={(stop) => void run(async () => ((await biz('setEnabled', { enabled: !stop })).enabled ? 'Business agent running.' : 'Stopped. Nothing will run.'))} label="Emergency stop" />
        </div>
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">{company.status === 'paused' ? 'Resume this company' : 'Pause this company'}</div>
            <div className="biz-setting-sub">Paused companies skip scheduled cycles; you can still run one manually.</div>
          </div>
          <button className="btn btn-sm" onClick={() => void run(async () => (await biz('companies.setStatus', { companyId: company.id, status: company.status === 'paused' ? 'active' : 'paused' })).company.status)}>
            {company.status === 'paused' ? Icon.play : Icon.pause}
            <span>{company.status === 'paused' ? 'Resume' : 'Pause'}</span>
          </button>
        </div>
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Rotate encryption key</div>
            <div className="biz-setting-sub">
              Re-encrypts every stored key and queued action under a fresh data key.{' '}
              {status.data && !status.data.vaultAvailable && <span className="bad">OS keychain unavailable — keys can't be stored.</span>}
            </div>
          </div>
          <button className="btn btn-sm" onClick={() => void run(async () => { const r = await biz('vault.rotate', {}); return `Rotated: ${r.credentials} keys, ${r.actions} queued actions re-encrypted.`; })}>
            {Icon.key}
            <span>Rotate</span>
          </button>
        </div>
        <div className="biz-setting-row">
          <div>
            <div className="biz-setting-name">Archive or delete</div>
            <div className="biz-setting-sub">Archive hides the company and stops it. Delete removes all of its data permanently.</div>
          </div>
          <div className="row gap-2">
            <button className="btn btn-sm" onClick={() => void run(async () => (await biz('companies.setStatus', { companyId: company.id, status: 'archived' })).company.status)}>Archive</button>
            <button className="btn btn-sm btn-ghost bad" onClick={() => setDeleting(true)}>Delete…</button>
          </div>
        </div>
        {msg && <div className="biz-action-result">{msg}</div>}
        <ErrorLine error={err} />
      </div>

      <div className="card biz-card">
        <CardHead title="Audit log" sub="Every change, by whom" />
        {(audit.data?.entries ?? []).length === 0 && <Empty>Nothing yet.</Empty>}
        <div className="biz-history">
          {(audit.data?.entries ?? []).slice(0, 60).map((a) => (
            <div key={a.id} className="biz-hrow">
              <span className="faint mono biz-small" style={{ width: 90 }}>{fmtAgo(a.createdAt)}</span>
              <span className="biz-action-kind">{a.actorType}</span>
              <span className="mono biz-small">{a.action}</span>
              {a.resourceId && <span className="faint mono biz-small biz-ellipsis">{a.resourceId.slice(0, 8)}</span>}
            </div>
          ))}
        </div>
      </div>

      {deleting && (
        <Modal
          title={`Delete ${company.name}?`}
          onClose={() => setDeleting(false)}
          foot={
            <>
              <button className="btn btn-ghost" onClick={() => setDeleting(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={confirm !== company.name}
                onClick={async () => {
                  const r = await biz('companies.delete', { companyId: company.id, confirmName: confirm });
                  if (r.ok) {
                    setDeleting(false);
                    refresh();
                  } else setErr(r.error ?? 'failed');
                }}
              >
                Delete permanently
              </button>
            </>
          }
        >
          <div className="biz-setting-sub">This removes the company's config history, tasks, drafts, leads, memory, runs, ledger and stored keys. Export first if you want a copy.</div>
          <FieldLabel>Type the company name to confirm</FieldLabel>
          <input className="field" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={company.name} />
        </Modal>
      )}
    </div>
  );
}

export function BizSettings(): JSX.Element {
  const { company, refresh } = useBizLive();
  const [section, setSection] = useState<Section>('profile');
  const [draft, setDraft] = useState<CompanyConfig>(company.config);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => setDraft(company.config), [company.config]);
  const patch: Patch = (fn) => setDraft((d) => fn(d));
  const dirty = JSON.stringify(draft) !== JSON.stringify(company.config);

  const save = async (): Promise<void> => {
    setSaving(true);
    setErr('');
    try {
      await biz('companies.updateConfig', { companyId: company.id, config: cleanConfig(draft), ...(note.trim() ? { note: note.trim() } : {}) });
      setNote('');
      refresh();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="biz-settings">
      <nav className="biz-settings-nav" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button key={s.id} className={section === s.id ? 'on' : ''} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      <div className="biz-settings-body">
        {section === 'profile' && <Profile draft={draft} patch={patch} />}
        {section === 'guardrails' && <Guardrails draft={draft} patch={patch} />}
        {section === 'connections' && <Connections draft={draft} patch={patch} />}
        {section === 'team' && <Team draft={draft} patch={patch} />}
        {section === 'budgets' && <Budgets draft={draft} patch={patch} />}
        {section === 'history' && <History />}
        {section === 'data' && <Data />}
        {dirty && (
          <div className="biz-savebar">
            <span className="biz-savebar-text">Unsaved changes — saving creates config v{company.activeConfigVersion + 1}</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" />
            <button className="btn btn-sm btn-ghost" onClick={() => setDraft(company.config)}>Discard</button>
            <button className="btn btn-sm btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <ErrorLine error={err} />
          </div>
        )}
      </div>
    </div>
  );
}
