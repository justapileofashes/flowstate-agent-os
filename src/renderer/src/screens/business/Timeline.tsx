// Cycle timeline + run replay. Cycles → a cycle's plan and runs → one run as
// a plain-language story with a replay scrubber (state at any step), or the
// raw steps (prompt excerpt, redacted args/result, duration, cost). Built so
// a non-technical reviewer can follow every decision without reading logs.

import { useEffect, useState } from 'react';
import type { CycleDto, RunDto, StepDto } from '@shared/business/types';
import { biz, errText, fmtCredits, fmtDateTime, fmtDuration, fmtUsd, useBiz, useBizLive } from './api';
import { CardHead, CYCLE_PILL, Empty, ErrorLine, Icon, Markdown, Pill, RoleBadge, ROLE_LABEL, RUN_PILL, Segmented, STOP_LABEL } from './ui';

const PHASE_LABEL: Record<string, string> = {
  perceive: 'Perceive',
  reason: 'Reason',
  plan: 'Plan',
  act: 'Act',
  observe: 'Observe',
  stop: 'Stop',
};

function StepRow({ step }: { step: StepDto }): JSX.Element {
  const [open, setOpen] = useState(false);
  const title =
    step.phase === 'act'
      ? `${step.toolName ?? 'tool'}${step.stepKind === 'approval' ? ' → approval queue' : step.stepKind === 'guardrail' ? ' → blocked' : ''}`
      : step.stepKind === 'goal_check'
        ? 'Goal check'
        : (step.content ?? '').split('\n')[0]?.slice(0, 120) || PHASE_LABEL[step.phase];
  return (
    <div className={`biz-step-row phase-${step.phase} ${step.ok === false ? 'bad' : ''}`}>
      <button className="biz-step-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="biz-step-seq mono">{step.seqNo}</span>
        <span className="biz-step-phase">{PHASE_LABEL[step.phase]}</span>
        <span className="biz-step-title">{title}</span>
        <span className="biz-step-meta mono">
          {step.durationMs ? fmtDuration(step.durationMs) : ''}
          {step.credits ? ` · ${fmtCredits(step.credits)}cr` : ''}
        </span>
        <span className={`biz-chev ${open ? 'open' : ''}`}>{Icon.chev}</span>
      </button>
      {open && (
        <div className="biz-step-body">
          {step.model && (
            <div className="biz-kv"><span>model</span><span className="mono">{step.model} · {step.tokensIn}+{step.tokensOut} tok · {fmtUsd(step.costUsd)}</span></div>
          )}
          {step.promptSnippet && (
            <>
              <div className="biz-resolved-label">Prompt excerpt</div>
              <pre className="biz-action-pre mono">{step.promptSnippet}</pre>
            </>
          )}
          {step.content && step.phase !== 'act' && (
            <>
              <div className="biz-resolved-label">Output</div>
              <pre className="biz-action-pre mono">{step.content}</pre>
            </>
          )}
          {step.toolArgsRedacted && (
            <>
              <div className="biz-resolved-label">Arguments (redacted)</div>
              <pre className="biz-action-pre mono">{step.toolArgsRedacted}</pre>
            </>
          )}
          {step.toolResultRedacted && (
            <>
              <div className="biz-resolved-label">Result (redacted)</div>
              <pre className="biz-action-pre mono">{step.toolResultRedacted}</pre>
            </>
          )}
          {step.phase === 'act' && step.content && <div className="biz-setting-sub">Gate: {step.content}</div>}
        </div>
      )}
    </div>
  );
}

function RunView({ run, onRetried }: { run: RunDto; onRetried: () => void }): JSX.Element {
  const { company, version } = useBizLive();
  const [mode, setMode] = useState<'story' | 'steps'>('story');
  const steps = useBiz('runs.get', { companyId: company.id, runId: run.id }, [version]);
  const total = steps.data?.steps.length ?? 0;
  const [upto, setUpto] = useState<number>(0);
  useEffect(() => setUpto(total), [total]);
  const replay = useBiz('runs.replay', { companyId: company.id, runId: run.id, uptoSeq: upto || undefined }, [upto, version]);
  const [err, setErr] = useState('');
  const rep = replay.data && !('error' in replay.data) ? replay.data : null;

  const retry = async (): Promise<void> => {
    setErr('');
    try {
      const r = await biz('runs.retry', { companyId: company.id, runId: run.id, ...(upto && upto < total ? { fromSeq: upto } : {}) });
      if (r.error) setErr(r.error);
      else onRetried();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="biz-run">
      <div className="biz-run-head">
        <RoleBadge role={run.role} />
        <div className="biz-run-goal">
          <div className="biz-run-role">{ROLE_LABEL[run.role]}</div>
          <div className="biz-setting-sub">{run.goal}</div>
        </div>
        <Pill {...RUN_PILL[run.status]} />
      </div>
      <div className="biz-run-facts mono">
        <span>{run.iterationCount} steps</span>
        <span>{fmtCredits(run.credits)} credits</span>
        <span>{fmtUsd(run.costUsd)}</span>
        {run.endedAt && <span>{fmtDuration(run.endedAt - run.startedAt)}</span>}
        {run.stopReason && <span>stopped: {STOP_LABEL[run.stopReason]}</span>}
      </div>
      {run.errorMessage && <div className="biz-action-result fail">{run.errorMessage}</div>}
      {run.output && (
        <div className="biz-run-output">
          <div className="biz-resolved-label">Report</div>
          <Markdown text={run.output} />
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', margin: '14px 0 10px' }}>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'story', label: 'Story' },
            { value: 'steps', label: 'Raw steps' },
          ]}
        />
        {run.role !== 'ceo' && run.status !== 'running' && (
          <button className="btn btn-sm" onClick={() => void retry()} title={upto < total ? `Retry from step ${upto}` : 'Retry this run'}>
            {Icon.play}
            <span>{upto && upto < total ? `Retry from step ${upto}` : 'Retry'}</span>
          </button>
        )}
      </div>
      <ErrorLine error={err} />

      {mode === 'story' ? (
        <>
          {total > 1 && (
            <div className="biz-scrub">
              <input
                type="range"
                min={1}
                max={total}
                value={upto || total}
                onChange={(e) => setUpto(Number(e.target.value))}
                aria-label="Replay up to step"
              />
              <span className="mono faint">
                step {upto || total}/{total}
                {rep ? ` · ${fmtCredits(rep.creditsSoFar)}cr so far` : ''}
              </span>
            </div>
          )}
          <ol className="biz-story">
            {rep?.narrative.map((n) => (
              <li key={n.seqNo} className={`phase-${n.phase}`}>
                <span className="biz-story-phase">{PHASE_LABEL[n.phase] ?? n.phase}</span>
                <span>{n.text}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="biz-steps-list">
          {(steps.data?.steps ?? []).map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function CycleView({ cycle }: { cycle: CycleDto }): JSX.Element {
  const { company, version } = useBizLive();
  const { data } = useBiz('cycles.get', { companyId: company.id, cycleId: cycle.id }, [version]);
  const [runId, setRunId] = useState<string | null>(null);
  const runs = data?.runs ?? [];
  const current = data?.cycle ?? cycle;
  const selected = runs.find((r) => r.id === runId) ?? null;
  return (
    <div className="card biz-card">
      <CardHead
        title={`${current.kind[0]!.toUpperCase()}${current.kind.slice(1)} cycle`}
        sub={`${fmtDateTime(current.startedAt)} · ${current.triggerType} · config v${current.configVersion}`}
        right={<Pill {...CYCLE_PILL[current.status]} />}
      />
      <div className="biz-run-facts mono">
        <span>{fmtCredits(current.creditsSpent)} / {fmtCredits(current.creditsCap)} credits</span>
        <span>{fmtUsd(current.costUsd)}</span>
        {current.endedAt && <span>{fmtDuration(current.endedAt - current.startedAt)}</span>}
        {current.stopReason && <span>stop: {current.stopReason}</span>}
      </div>
      {current.error && <div className="biz-action-result fail">{current.error}</div>}

      {current.plan && (
        <>
          <div className="biz-resolved-label">Plan the CEO committed to</div>
          {current.plan.notes && <div className="biz-setting-sub" style={{ marginBottom: 8 }}>{current.plan.notes}</div>}
          <ol className="biz-plan">
            {current.plan.plan.map((p, i) => (
              <li key={i} className="biz-plan-item">
                <RoleBadge role={p.role} />
                <span className="biz-plan-title">{p.title}</span>
                {p.requires_approval && <span className="biz-action-kind">approval</span>}
                <span className="faint mono biz-plan-est">~{p.estimated_cost_credits}cr</span>
              </li>
            ))}
          </ol>
          {current.plan.dropped?.length ? (
            <details className="biz-dropped">
              <summary className="faint">{current.plan.dropped.length} dropped by guardrails</summary>
              <ul>
                {current.plan.dropped.map((d, i) => (
                  <li key={i}>
                    <span>{d.title}</span> <span className="faint">— {d.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}

      <div className="biz-resolved-label">Runs</div>
      {runs.length === 0 && <Empty>No runs recorded.</Empty>}
      <div className="biz-runlist">
        {runs.map((r) => (
          <button key={r.id} className={`biz-runrow ${r.id === runId ? 'on' : ''}`} onClick={() => setRunId(r.id === runId ? null : r.id)}>
            <RoleBadge role={r.role} />
            <span className="biz-runrow-goal">{r.role === 'ceo' ? 'Plan, dispatch and report' : r.goal}</span>
            <span className="faint mono">{fmtCredits(r.credits)}cr</span>
            <Pill {...RUN_PILL[r.status]} />
          </button>
        ))}
      </div>
      {selected && <RunView run={selected} onRetried={() => setRunId(null)} />}

      {current.summary && (
        <>
          <div className="biz-resolved-label">Report</div>
          <Markdown text={current.summary} />
        </>
      )}
    </div>
  );
}

export function Timeline(): JSX.Element {
  const { company, version } = useBizLive();
  const { data, error } = useBiz('cycles.list', { companyId: company.id, limit: 100 }, [version]);
  const cycles = data?.cycles ?? [];
  const [sel, setSel] = useState<string | null>(null);
  const selected = cycles.find((c) => c.id === sel) ?? cycles[0] ?? null;

  return (
    <div className="biz-split">
      <div className="card biz-card biz-cyclelist">
        <CardHead title="Cycles" sub={`${cycles.length} recorded`} />
        <ErrorLine error={error} />
        {cycles.length === 0 && <Empty>No cycles yet.</Empty>}
        <div className="biz-history">
          {cycles.map((c) => (
            <button key={c.id} className={`biz-cyclerow ${selected?.id === c.id ? 'on' : ''}`} onClick={() => setSel(c.id)}>
              <span className="biz-cyclerow-main">
                <span className="biz-cyclerow-kind">{c.kind === 'role' ? `${ROLE_LABEL[c.role ?? ''] ?? c.role} routine` : c.kind}</span>
                <span className="faint mono">{fmtDateTime(c.startedAt)}</span>
              </span>
              <span className="biz-cyclerow-side">
                <Pill {...CYCLE_PILL[c.status]} />
                <span className="faint mono">{fmtCredits(c.creditsSpent)}cr</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="biz-col">{selected ? <CycleView key={selected.id} cycle={selected} /> : <Empty>Select a cycle.</Empty>}</div>
    </div>
  );
}
