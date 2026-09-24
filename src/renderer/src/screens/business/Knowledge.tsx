// Knowledge: lessons the team proposes (you activate — agents only
// propose), the immutable operating rules + your own constraints, and the
// semantic memory the planner recalls from.

import { useState } from 'react';
import type { KnowledgeCategory, LearnedRuleDto } from '@shared/business/types';
import { biz, errText, fmtAgo, useBiz, useBizLive } from './api';
import { CardHead, Empty, ErrorLine, Icon, Segmented } from './ui';

const PROPOSER: Record<LearnedRuleDto['proposedBy'], string> = {
  rejection: 'from your rejection',
  kaizen: 'from the cycle review',
  agent: 'from a skill outcome',
  user: 'added by you',
};

type NoteCategory = Exclude<KnowledgeCategory, 'summary'>;

const CATEGORIES: NoteCategory[] = ['market', 'competitor', 'pricing', 'customer', 'support', 'validation', 'finance', 'note', 'other'];

function Rule({ rule, onChange }: { rule: LearnedRuleDto; onChange: () => void }): JSX.Element {
  const { company } = useBizLive();
  const set = async (status: LearnedRuleDto['status']): Promise<void> => {
    await biz('rules.setStatus', { companyId: company.id, ruleId: rule.id, status });
    onChange();
  };
  return (
    <div className={`biz-rule ${rule.polarity}`}>
      <div className="biz-rule-text">
        <span className="biz-rule-pol">{rule.polarity === 'avoid' ? 'Avoid' : 'Do'}</span>
        <span>
          When {rule.condition} → {rule.action}
        </span>
      </div>
      <div className="biz-setting-sub">
        {PROPOSER[rule.proposedBy]} · confidence {Math.round(rule.confidence * 100)}% · {fmtAgo(rule.createdAt)}
        {rule.rationale ? ` · ${rule.rationale}` : ''}
      </div>
      <div className="row gap-2" style={{ marginTop: 8 }}>
        {rule.status === 'proposed' && (
          <>
            <button className="btn btn-sm btn-primary" onClick={() => void set('active')}>
              {Icon.check}
              <span>Activate</span>
            </button>
            <button className="btn btn-sm" onClick={() => void set('rejected')}>Dismiss</button>
          </>
        )}
        {rule.status === 'active' && (
          <button className="btn btn-sm" onClick={() => void set('proposed')}>Deactivate</button>
        )}
        <button
          className="btn btn-sm btn-ghost"
          onClick={async () => {
            await biz('rules.delete', { companyId: company.id, ruleId: rule.id });
            onChange();
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export function Knowledge(): JSX.Element {
  const { company, version } = useBizLive();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const { data, error, reload } = useBiz('knowledge.list', { companyId: company.id, ...(q ? { query: q } : {}) }, [version]);
  const [ruleTab, setRuleTab] = useState<'proposed' | 'active'>('proposed');
  const [constraint, setConstraint] = useState('');
  const [note, setNote] = useState('');
  const [cat, setCat] = useState<NoteCategory>('note');
  const [err, setErr] = useState('');
  const rules = (data?.rules ?? []).filter((r) => r.status === ruleTab);
  const proposedCount = (data?.rules ?? []).filter((r) => r.status === 'proposed').length;

  return (
    <div className="biz-grid">
      <div className="biz-col">
        <div className="card biz-card">
          <CardHead
            title="Lessons"
            sub="The team proposes; nothing changes behaviour until you activate it"
            right={
              <Segmented
                value={ruleTab}
                onChange={setRuleTab}
                options={[
                  { value: 'proposed', label: `Proposed${proposedCount ? ` · ${proposedCount}` : ''}` },
                  { value: 'active', label: 'Active' },
                ]}
              />
            }
          />
          <ErrorLine error={error} />
          {rules.length === 0 && <Empty>{ruleTab === 'proposed' ? 'No proposals. Rejections and cycle reviews create them.' : 'No active lessons yet.'}</Empty>}
          <div className="biz-rules">
            {rules.map((r) => (
              <Rule key={r.id} rule={r} onChange={reload} />
            ))}
          </div>
        </div>

        <div className="card biz-card">
          <CardHead title="Operating rules" sub="Loaded into every agent prompt; they override lessons" />
          <ol className="biz-constitution">
            {(data?.constraints ?? []).map((c) => (
              <li key={c.id} className={c.immutable ? 'locked' : ''}>
                <span>{c.rule}</span>
                {c.immutable ? (
                  <span className="faint" title="built-in, cannot be changed">{Icon.shield}</span>
                ) : (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      await biz('constraints.delete', { companyId: company.id, id: c.id });
                      reload();
                    }}
                    aria-label="Remove rule"
                  >
                    {Icon.x}
                  </button>
                )}
              </li>
            ))}
          </ol>
          <div className="biz-goalrow" style={{ marginTop: 10 }}>
            <input className="field" value={constraint} onChange={(e) => setConstraint(e.target.value)} placeholder="Add your own rule, e.g. Never mention competitors by name" />
            <button
              className="btn btn-sm"
              disabled={constraint.trim().length < 5}
              onClick={async () => {
                try {
                  await biz('constraints.add', { companyId: company.id, rule: constraint.trim() });
                  setConstraint('');
                  reload();
                } catch (e) {
                  setErr(errText(e));
                }
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>

      <div className="biz-col">
        <div className="card biz-card">
          <CardHead title="Memory" sub="What the team knows — recalled by similarity when planning" />
          <form
            className="biz-goalrow"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(query.trim());
            }}
          >
            <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory…" />
            <button className="btn btn-sm" type="submit" aria-label="Search">{Icon.search}</button>
            {q && (
              <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setQuery(''); setQ(''); }}>Clear</button>
            )}
          </form>
          <div className="biz-memories">
            {(data?.memories ?? []).map((m) => (
              <div key={m.id} className="biz-memory">
                <div className="row gap-2">
                  <span className="biz-action-kind">{m.category}</span>
                  {m.score !== undefined && <span className="faint mono biz-small">{m.score.toFixed(2)}</span>}
                  <span className="faint biz-small" style={{ marginLeft: 'auto' }}>{fmtAgo(m.createdAt)}</span>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      await biz('knowledge.delete', { companyId: company.id, id: m.id });
                      reload();
                    }}
                    aria-label="Delete memory"
                  >
                    {Icon.x}
                  </button>
                </div>
                <div className="biz-memory-text">{m.content}</div>
                {m.source && <div className="faint biz-small biz-ellipsis">{m.source}</div>}
              </div>
            ))}
            {(data?.memories ?? []).length === 0 && <Empty>{q ? 'Nothing matches.' : 'Memory is empty.'}</Empty>}
          </div>
          <div className="biz-resolved-label">Teach it something</div>
          <textarea className="field biz-textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Our best customers come from indie hacker communities, not LinkedIn" />
          <div className="row gap-2" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <select className="field biz-mini-select" value={cat} onChange={(e) => setCat(e.target.value as NoteCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              className="btn btn-sm btn-primary"
              disabled={note.trim().length < 5}
              onClick={async () => {
                try {
                  await biz('knowledge.add', { companyId: company.id, content: note.trim(), category: cat });
                  setNote('');
                  reload();
                } catch (e) {
                  setErr(errText(e));
                }
              }}
            >
              Save
            </button>
          </div>
          <ErrorLine error={err} />
        </div>
      </div>
    </div>
  );
}
