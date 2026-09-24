// What the team produced: drafts (never published by saving), the lead
// pipeline, and the support inbox (tickets the support role triages).

import { useState } from 'react';
import type { DraftDto, LeadDto, TicketDto } from '@shared/business/types';
import { biz, errText, fmtAgo, useBiz, useBizLive } from './api';
import { CardHead, Empty, ErrorLine, FieldLabel, Icon, Modal, Pill, RoleBadge, Segmented, type PillKind } from './ui';

const DRAFT_PILL: Record<DraftDto['status'], { kind: PillKind; label: string }> = {
  draft: { kind: '', label: 'draft' },
  queued: { kind: 'streaming', label: 'queued' },
  published: { kind: 'good', label: 'published' },
  discarded: { kind: '', label: 'discarded' },
};

function Drafts(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error, reload } = useBiz('drafts.list', { companyId: company.id }, [version]);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const drafts = data?.drafts ?? [];
  return (
    <div className="card biz-card">
      <CardHead title="Drafts" sub="Saved for your review — saving never publishes" />
      <ErrorLine error={error} />
      {drafts.length === 0 && <Empty>No drafts yet.</Empty>}
      <div className="biz-actions">
        {drafts.map((d) => {
          const violations = Array.isArray(d.meta['brandViolations']) ? (d.meta['brandViolations'] as string[]) : [];
          return (
            <div key={d.id} className={`biz-action ${d.status === 'discarded' ? 'dim' : ''}`}>
              <div className="biz-action-head" onClick={() => setOpen(open === d.id ? null : d.id)}>
                <span className={`biz-chev ${open === d.id ? 'open' : ''}`}>{Icon.chev}</span>
                <RoleBadge role={typeof d.meta['role'] === 'string' ? (d.meta['role'] as string) : null} />
                <span className="biz-action-kind">{d.kind}{d.channel ? ` · ${d.channel}` : ''}</span>
                <span className="biz-action-title">{d.title}</span>
                {violations.length > 0 && <span className="biz-action-kind bad" title={`brand don'ts: ${violations.join(', ')}`}>off-brand</span>}
                <span style={{ marginLeft: 'auto', flexShrink: 0 }} className="row gap-2">
                  <span className="faint mono biz-small">{fmtAgo(d.createdAt)}</span>
                  <Pill {...DRAFT_PILL[d.status]} />
                </span>
              </div>
              {open === d.id && (
                <div className="biz-action-body">
                  <div className="biz-email-body">{d.body}</div>
                  {typeof d.meta['publishedRef'] === 'string' && <div className="biz-action-result">→ {d.meta['publishedRef'] as string}</div>}
                  <div className="row gap-2" style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(d.body).then(() => {
                          setCopied(d.id);
                          setTimeout(() => setCopied(null), 1_500);
                        });
                      }}
                    >
                      {copied === d.id ? 'Copied' : 'Copy'}
                    </button>
                    {d.status !== 'published' && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={async () => {
                          await biz('drafts.update', { companyId: company.id, draftId: d.id, status: d.status === 'discarded' ? 'draft' : 'discarded' });
                          reload();
                        }}
                      >
                        {d.status === 'discarded' ? 'Restore' : 'Discard'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LEAD_STATUSES: LeadDto['status'][] = ['new', 'contacted', 'replied', 'qualified', 'unsubscribed', 'lost'];

function Leads(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error, reload } = useBiz('leads.list', { companyId: company.id }, [version]);
  const leads = data?.leads ?? [];
  return (
    <div className="card biz-card">
      <CardHead title="Leads" sub="Qualified by the SDR with an ICP reason and a real signal" />
      <ErrorLine error={error} />
      {leads.length === 0 ? (
        <Empty>No leads yet. Turn on the email channel and connect a provider to let the SDR prospect.</Empty>
      ) : (
        <div className="biz-table-wrap">
          <table className="biz-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Why they fit</th>
                <th>Signal</th>
                <th>Last contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div>{l.name || l.email}</div>
                    <div className="faint mono biz-small">{l.email}{l.companyName ? ` · ${l.companyName}` : ''}</div>
                  </td>
                  <td className="biz-small">{l.icpReason}</td>
                  <td className="biz-small">{l.signal}</td>
                  <td className="faint mono biz-small">{fmtAgo(l.lastContactedAt)}</td>
                  <td>
                    <select
                      className="field biz-mini-select"
                      value={l.status}
                      onChange={async (e) => {
                        await biz('leads.setStatus', { companyId: company.id, leadId: l.id, status: e.target.value as LeadDto['status'] });
                        reload();
                      }}
                    >
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const TICKET_PILL: Record<TicketDto['status'], { kind: PillKind; label: string }> = {
  open: { kind: 'bad', label: 'open' },
  pending: { kind: '', label: 'reply drafted' },
  closed: { kind: 'good', label: 'closed' },
};

function Tickets(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error, reload } = useBiz('tickets.list', { companyId: company.id }, [version]);
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState('');
  const [customer, setCustomer] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<TicketDto['priority']>('normal');
  const [err, setErr] = useState('');
  const tickets = data?.tickets ?? [];
  const add = async (): Promise<void> => {
    try {
      await biz('tickets.add', { companyId: company.id, subject: subject.trim(), body, customer: customer.trim(), priority });
      setAdding(false);
      setSubject('');
      setBody('');
      setCustomer('');
      reload();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <div className="card biz-card">
      <CardHead
        title="Support inbox"
        sub="The support role triages these and drafts replies"
        right={
          <button className="btn btn-sm" onClick={() => setAdding(true)}>
            {Icon.plus}
            <span>Add ticket</span>
          </button>
        }
      />
      <ErrorLine error={error} />
      {tickets.length === 0 && <Empty>No tickets. Paste customer emails here, or grant an inbox MCP tool to the support role in Settings.</Empty>}
      <div className="biz-history">
        {tickets.map((t) => (
          <div key={t.id} className="biz-hrow">
            <span className={`biz-prio p-${t.priority}`}>{t.priority}</span>
            <span className="biz-ticket-main">
              <span>{t.subject}</span>
              <span className="faint biz-small">{t.customer || 'unknown customer'} · {fmtAgo(t.createdAt)}{t.tags.length ? ` · ${t.tags.join(', ')}` : ''}</span>
            </span>
            <Pill {...TICKET_PILL[t.status]} />
            {t.status !== 'closed' && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  await biz('tickets.update', { companyId: company.id, ticketId: t.id, status: 'closed' });
                  reload();
                }}
              >
                Close
              </button>
            )}
          </div>
        ))}
      </div>
      {adding && (
        <Modal
          title="Add a support ticket"
          onClose={() => setAdding(false)}
          foot={
            <>
              <button className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={subject.trim().length < 2} onClick={() => void add()}>Add</button>
            </>
          }
        >
          <FieldLabel>Subject</FieldLabel>
          <input className="field" autoFocus value={subject} onChange={(e) => setSubject(e.target.value)} />
          <FieldLabel hint="optional">Customer</FieldLabel>
          <input className="field" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="name or email" />
          <FieldLabel>Message</FieldLabel>
          <textarea className="field biz-textarea tall" value={body} onChange={(e) => setBody(e.target.value)} />
          <FieldLabel>Priority</FieldLabel>
          <Segmented
            value={priority}
            onChange={setPriority}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
          />
          <ErrorLine error={err} />
        </Modal>
      )}
    </div>
  );
}

export function Outputs(): JSX.Element {
  const [tab, setTab] = useState<'drafts' | 'leads' | 'tickets'>('drafts');
  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'drafts', label: 'Drafts' },
            { value: 'leads', label: 'Leads' },
            { value: 'tickets', label: 'Support inbox' },
          ]}
        />
      </div>
      {tab === 'drafts' ? <Drafts /> : tab === 'leads' ? <Leads /> : <Tickets />}
    </div>
  );
}
