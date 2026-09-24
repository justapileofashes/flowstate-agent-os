// Channels (opt-in outward scopes), the email sender, BYOK integrations
// (secrets are write-only — only fingerprints come back), browse
// allow/block lists, and MCP tools granted to roles.

import { useState } from 'react';
import { CHANNEL_KEYS, ROLE_KEYS, type ChannelKey, type CompanyConfig, type IntegrationDto, type RoleKey } from '@shared/business/types';
import { biz, errText, useBiz, useBizLive } from './api';
import { CardHead, cleanList, ErrorLine, FieldLabel, Icon, ListEditor, Modal, Pill, ROLE_LABEL, Switch } from './ui';

const CHANNEL_INFO: Record<ChannelKey, { label: string; sub: string; providers: string }> = {
  email: { label: 'Email', sub: 'Outreach + support replies (queued for approval by default)', providers: 'Resend or SendGrid' },
  social: { label: 'Social', sub: 'Publish saved drafts (approval until enough clean publishes)', providers: 'X or a publishing webhook' },
  ads: { label: 'Ads', sub: 'Read performance; budget changes within caps', providers: 'Meta Ads' },
  crm: { label: 'CRM', sub: 'Push qualified leads to your CRM', providers: 'HubSpot' },
  code: { label: 'Code', sub: 'Pull requests on your repo; deploys always need you', providers: 'GitHub + a deploy hook' },
};

export type Patch = (fn: (c: CompanyConfig) => CompanyConfig) => void;

function Connect({ integ, onClose }: { integ: IntegrationDto; onClose: () => void }): JSX.Element {
  const { company } = useBizLive();
  const [secret, setSecret] = useState('');
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [shared, setShared] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      const r = await biz('credentials.save', { companyId: company.id, provider: integ.provider, secret, meta, shared, label: integ.label });
      if (r.error) setErr(r.error);
      else onClose();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${integ.connected ? 'Replace' : 'Connect'} ${integ.label}`}
      onClose={onClose}
      foot={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || secret.trim().length < 4} onClick={() => void save()}>
            {Icon.key}
            <span>Save securely</span>
          </button>
        </>
      }
    >
      <div className="biz-setting-sub" style={{ marginBottom: 12 }}>
        {integ.purpose}{' '}
        <a href={integ.docsUrl} target="_blank" rel="noreferrer">Get a key ↗</a>
      </div>
      <FieldLabel hint="encrypted with your OS keychain; never shown again">Secret</FieldLabel>
      <input className="field mono" type="password" autoComplete="off" autoFocus value={secret} onChange={(e) => setSecret(e.target.value)} />
      {integ.metaFields.map((f) => (
        <div key={f.key}>
          <FieldLabel>{f.label}</FieldLabel>
          <input className="field mono" value={meta[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} />
        </div>
      ))}
      <div className="biz-setting-row">
        <div>
          <div className="biz-setting-name">Share with all my companies</div>
          <div className="biz-setting-sub">Otherwise only this company can use it.</div>
        </div>
        <Switch on={shared} onChange={setShared} label="Share credential" />
      </div>
      <ErrorLine error={err} />
    </Modal>
  );
}

function Integrations(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error, reload } = useBiz('integrations.list', { companyId: company.id }, [version]);
  const [connecting, setConnecting] = useState<IntegrationDto | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; detail: string }>>({});
  return (
    <div className="card biz-card">
      <CardHead title="Integrations" sub="Bring your own keys. Stored encrypted; only a fingerprint is ever shown." />
      <ErrorLine error={error} />
      <div className="biz-integrations">
        {(data?.integrations ?? []).map((i) => (
          <div key={i.provider} className="biz-integ">
            <div className="biz-integ-main">
              <div className="row gap-2">
                <span className="biz-setting-name">{i.label}</span>
                {i.connected ? <Pill kind="good" label="connected" /> : <Pill label="not connected" />}
              </div>
              <div className="biz-setting-sub">{i.purpose}</div>
              {i.connected && <div className="faint mono biz-small">key {i.fingerprint}</div>}
              {tests[i.provider] && (
                <div className={`biz-small ${tests[i.provider]!.ok ? 'good' : 'bad'}`}>{tests[i.provider]!.detail}</div>
              )}
            </div>
            <div className="biz-integ-actions">
              <button className="btn btn-sm" onClick={() => setConnecting(i)}>{i.connected ? 'Replace' : 'Connect'}</button>
              {i.connected && (
                <>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      const r = await biz('credentials.test', { companyId: company.id, provider: i.provider });
                      setTests((t) => ({ ...t, [i.provider]: r }));
                    }}
                  >
                    Test
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      if (!i.credentialId) return;
                      await biz('credentials.delete', { companyId: company.id, credentialId: i.credentialId });
                      reload();
                    }}
                    title="Deletes the stored key. Also revoke it in the provider's dashboard."
                  >
                    Revoke
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {connecting && (
        <Connect
          integ={connecting}
          onClose={() => {
            setConnecting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function McpGrants({ draft, patch }: { draft: CompanyConfig; patch: Patch }): JSX.Element {
  const { data } = useBiz('mcp.tools', {}, []);
  const [tool, setTool] = useState('');
  const [role, setRole] = useState<RoleKey>('researcher');
  const [category, setCategory] = useState<'read' | 'external_write'>('read');
  const tools = data?.tools ?? [];
  return (
    <div className="card biz-card">
      <CardHead title="MCP tools" sub="Grant tools from your connected MCP servers to specific roles. Ungranted tools stay invisible." />
      {draft.mcpGrants.length === 0 && <div className="biz-empty-line muted">No grants.</div>}
      <div className="biz-history">
        {draft.mcpGrants.map((g, i) => (
          <div key={`${g.tool}-${i}`} className="biz-hrow">
            <span className="mono biz-small biz-ellipsis" style={{ flex: 1 }}>{g.tool}</span>
            <span className="biz-small">{g.roles.map((r) => ROLE_LABEL[r]).join(', ')}</span>
            <span className="biz-action-kind">{g.category === 'read' ? 'read-only' : 'writes (gated)'}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => patch((c) => ({ ...c, mcpGrants: c.mcpGrants.filter((_, j) => j !== i) }))} aria-label="Remove grant">
              {Icon.x}
            </button>
          </div>
        ))}
      </div>
      {tools.length ? (
        <div className="biz-grant-form">
          <select className="field" value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="">Choose a tool…</option>
            {tools.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <select className="field" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
            {ROLE_KEYS.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value as 'read' | 'external_write')}>
            <option value="read">read-only</option>
            <option value="external_write">writes (approval-gated)</option>
          </select>
          <button
            className="btn btn-sm"
            disabled={!tool}
            onClick={() => {
              patch((c) => ({ ...c, mcpGrants: [...c.mcpGrants, { tool, roles: [role], category }] }));
              setTool('');
            }}
          >
            Grant
          </button>
        </div>
      ) : (
        <div className="biz-setting-sub">No MCP servers connected. Add them under Connectors, then grant tools here.</div>
      )}
    </div>
  );
}

export function Connections({ draft, patch }: { draft: CompanyConfig; patch: Patch }): JSX.Element {
  return (
    <div className="biz-col">
      <div className="card biz-card">
        <CardHead title="Outward channels" sub="Off = agents can only draft for that channel. Turn one on after connecting its integration." />
        {CHANNEL_KEYS.map((k) => (
          <div key={k} className="biz-setting-row">
            <div>
              <div className="biz-setting-name">{CHANNEL_INFO[k].label}</div>
              <div className="biz-setting-sub">{CHANNEL_INFO[k].sub} · needs {CHANNEL_INFO[k].providers}</div>
            </div>
            <Switch on={draft.channels[k]} onChange={(v) => patch((c) => ({ ...c, channels: { ...c.channels, [k]: v } }))} label={CHANNEL_INFO[k].label} />
          </div>
        ))}
      </div>

      <div className="card biz-card">
        <CardHead title="Email sender" />
        <div className="biz-grid4">
          <label className="biz-numfield" style={{ gridColumn: 'span 2' }}>
            <span>From address (a domain verified with your provider)</span>
            <input className="field mono" value={draft.email.fromAddress} onChange={(e) => patch((c) => ({ ...c, email: { ...c.email, fromAddress: e.target.value } }))} placeholder="founder@yourdomain.com" />
          </label>
          <label className="biz-numfield" style={{ gridColumn: 'span 2' }}>
            <span>From name</span>
            <input className="field" value={draft.email.fromName} onChange={(e) => patch((c) => ({ ...c, email: { ...c.email, fromName: e.target.value } }))} placeholder="Ana at Acme" />
          </label>
        </div>
        <FieldLabel hint="appended to outreach that has no opt-out line">Opt-out footer</FieldLabel>
        <input className="field" value={draft.email.optOutFooter} onChange={(e) => patch((c) => ({ ...c, email: { ...c.email, optOutFooter: e.target.value } }))} />
      </div>

      <Integrations />

      <div className="card biz-card">
        <CardHead title="Browsing" sub="Private and local addresses are always blocked." />
        <FieldLabel hint="empty = any public site">Only these domains</FieldLabel>
        <ListEditor values={draft.browse.allowDomains} onChange={(v) => patch((c) => ({ ...c, browse: { ...c.browse, allowDomains: cleanList(v).length ? v : [] } }))} placeholder="example.com" max={100} />
        <FieldLabel>Never these domains</FieldLabel>
        <ListEditor values={draft.browse.blockDomains} onChange={(v) => patch((c) => ({ ...c, browse: { ...c.browse, blockDomains: cleanList(v).length ? v : [] } }))} placeholder="competitor.com" max={100} />
      </div>

      <McpGrants draft={draft} patch={patch} />
    </div>
  );
}
