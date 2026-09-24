// Create-a-company wizard: business → guardrails → schedule. Defaults are the
// safe ones (safe autonomy, validate-before-build on, every outward channel
// off) and each is explained where it's chosen.

import { useState } from 'react';
import type { AutonomyTier, CompanyConfigInput, CompanyDto } from '@shared/business/types';
import { biz, errText } from './api';
import { cleanList, ErrorLine, FieldLabel, Icon, ListEditor, Switch } from './ui';

const TIERS: Array<{ id: AutonomyTier; name: string; blurb: string }> = [
  {
    id: 'safe',
    name: 'Safe',
    blurb: 'Agents research, plan and draft. Every email, post, spend, deploy or price change waits for you.',
  },
  {
    id: 'assisted',
    name: 'Assisted',
    blurb: 'Small, bounded actions may run on their own: publishing after enough clean posts, ad changes within ±10%, CRM updates. Config edits apply after a 1-hour objection window.',
  },
  {
    id: 'autonomous',
    name: 'Autonomous',
    blurb: 'Also lets outreach email send within your daily cap. Deploys, pricing, refunds and validation always wait for you.',
  },
];

const CATCHUP = [
  { value: 15, label: '15 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: 'Rest of the day' },
];

export function Onboarding({ onCreated, onCancel }: { onCreated: (c: CompanyDto) => void; onCancel?: () => void }): JSX.Element {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [niche, setNiche] = useState('');
  const [valueProp, setValueProp] = useState('');
  const [icp, setIcp] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [goals, setGoals] = useState<string[]>(['']);
  const [autonomy, setAutonomy] = useState<AutonomyTier>('safe');
  const [validate, setValidate] = useState(true);
  const [cycleCredits, setCycleCredits] = useState(200);
  const [monthlyCredits, setMonthlyCredits] = useState(5000);
  const [cycleUsd, setCycleUsd] = useState(2);
  const [monthlyUsd, setMonthlyUsd] = useState(50);
  const [scheduleOn, setScheduleOn] = useState(true);
  const [morning, setMorning] = useState('07:00');
  const [evening, setEvening] = useState('19:00');
  const [catchUp, setCatchUp] = useState(15);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const step0ok = Boolean(name.trim() && valueProp.trim() && icp.trim() && cleanList(goals).length);

  const create = async (): Promise<void> => {
    setSaving(true);
    setError('');
    const config: CompanyConfigInput = {
      name: name.trim(),
      niche: niche.trim(),
      valueProp: valueProp.trim(),
      icp: icp.trim(),
      brandVoice: brandVoice.trim(),
      goals: cleanList(goals),
      autonomy,
      validation: { required: validate, status: validate ? 'pending' : 'waived' },
      budgets: { cycleCredits, monthlyCredits, cycleUsd, monthlyUsd },
      schedule: { enabled: scheduleOn, morning, evening, catchUpMinutes: catchUp },
    };
    try {
      const { company } = await biz('companies.create', { config });
      onCreated(company);
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const steps = ['Your business', 'Guardrails', 'Schedule'];

  return (
    <div className="biz-setup screen-enter">
      <div className="eyebrow">Business</div>
      <h2 className="section-title" style={{ fontSize: 32, marginTop: 8 }}>
        Hire an AI team to run it
      </h2>
      <p className="muted mt-3" style={{ maxWidth: 560 }}>
        A CEO agent plans every morning, nine specialist roles do the work, and anything that touches the outside
        world waits in your approval queue. You stay in control of spend, channels and autonomy.
      </p>

      <div className="biz-steps" aria-label="progress">
        {steps.map((s, i) => (
          <button key={s} className={`biz-step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => (i < step || (i === 1 && step0ok) ? setStep(i) : undefined)}>
            <span className="biz-step-n">{i < step ? Icon.check : i + 1}</span>
            <span>{s}</span>
          </button>
        ))}
      </div>

      <div className="card biz-form">
        {step === 0 && (
          <>
            <FieldLabel>Company name</FieldLabel>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Analytics" autoFocus />
            <FieldLabel hint="optional">Niche</FieldLabel>
            <input className="field" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Privacy-first web analytics" />
            <FieldLabel>What you sell (value proposition)</FieldLabel>
            <textarea className="field biz-textarea" value={valueProp} onChange={(e) => setValueProp(e.target.value)} placeholder="Cookie-free analytics that respects visitors and needs no consent banner" />
            <FieldLabel>Who it's for (ideal customer)</FieldLabel>
            <textarea className="field biz-textarea" value={icp} onChange={(e) => setIcp(e.target.value)} placeholder="Indie SaaS founders with 1k–50k monthly visitors who hate cookie banners" />
            <FieldLabel hint="optional">Brand voice</FieldLabel>
            <input className="field" value={brandVoice} onChange={(e) => setBrandVoice(e.target.value)} placeholder="Plain, friendly, no hype" />
            <FieldLabel>Goals</FieldLabel>
            <ListEditor values={goals} onChange={setGoals} placeholder="Reach $1k MRR" />
          </>
        )}

        {step === 1 && (
          <>
            <FieldLabel>Autonomy</FieldLabel>
            <div className="biz-tiers">
              {TIERS.map((t) => (
                <button key={t.id} className={`fc-kindopt biz-tier ${autonomy === t.id ? 'on' : ''}`} onClick={() => setAutonomy(t.id)}>
                  <span className="fc-kindopt-name">
                    {t.name}
                    {t.id === 'safe' && <span className="faint"> · recommended</span>}
                  </span>
                  <span className="biz-tier-blurb">{t.blurb}</span>
                </button>
              ))}
            </div>

            <div className="biz-setting-row">
              <div>
                <div className="biz-setting-name">Validate before building</div>
                <div className="biz-setting-sub">
                  Until you accept a validation report (problem, competitors, demand), no coding, outreach or ad
                  spend is planned. Most AI-run businesses fail here — this is on by default.
                </div>
              </div>
              <Switch on={validate} onChange={setValidate} label="Validate before building" />
            </div>

            <div className="biz-setting-row">
              <div>
                <div className="biz-setting-name">Outward channels</div>
                <div className="biz-setting-sub">
                  Email, social, ads, CRM and code are all <em className="ink">off</em>. Agents only draft until you
                  connect an integration and switch a channel on in Settings.
                </div>
              </div>
              {Icon.shield}
            </div>

            <FieldLabel hint="1 credit = $0.01 of cloud model spend, or 4,000 tokens on a local model">Budgets</FieldLabel>
            <div className="biz-grid4">
              <label className="biz-numfield">
                <span>Credits per cycle</span>
                <input className="field mono" type="number" min={1} value={cycleCredits} onChange={(e) => setCycleCredits(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="biz-numfield">
                <span>Credits per month</span>
                <input className="field mono" type="number" min={1} value={monthlyCredits} onChange={(e) => setMonthlyCredits(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="biz-numfield">
                <span>USD cap per cycle</span>
                <input className="field mono" type="number" min={0} step={0.5} value={cycleUsd} onChange={(e) => setCycleUsd(Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <label className="biz-numfield">
                <span>USD cap per month</span>
                <input className="field mono" type="number" min={0} step={1} value={monthlyUsd} onChange={(e) => setMonthlyUsd(Math.max(0, Number(e.target.value) || 0))} />
              </label>
            </div>
            <div className="biz-setting-sub" style={{ marginTop: 8 }}>
              You're alerted at 80% of the monthly budget; cycles pause at 100%. Failed actions are refunded.
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="biz-setting-row">
              <div>
                <div className="biz-setting-name">Run every day</div>
                <div className="biz-setting-sub">A morning plan dispatches the team; an evening summary reports back and checks for drift.</div>
              </div>
              <Switch on={scheduleOn} onChange={setScheduleOn} label="Run every day" />
            </div>
            <div className="biz-grid4" style={{ opacity: scheduleOn ? 1 : 0.45 }}>
              <label className="biz-numfield">
                <span>Morning plan</span>
                <input className="field mono" type="time" value={morning} disabled={!scheduleOn} onChange={(e) => setMorning(e.target.value)} />
              </label>
              <label className="biz-numfield">
                <span>Evening summary</span>
                <input className="field mono" type="time" value={evening} disabled={!scheduleOn} onChange={(e) => setEvening(e.target.value)} />
              </label>
              <label className="biz-numfield" style={{ gridColumn: 'span 2' }}>
                <span>If Flowstate was closed at that time, still run when it opens within</span>
                <select className="field" value={catchUp} disabled={!scheduleOn} onChange={(e) => setCatchUp(Number(e.target.value))}>
                  {CATCHUP.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="biz-review">
              <div className="biz-review-row"><span className="faint">Company</span><span>{name}</span></div>
              <div className="biz-review-row"><span className="faint">Autonomy</span><span>{TIERS.find((t) => t.id === autonomy)?.name}</span></div>
              <div className="biz-review-row"><span className="faint">Validate first</span><span>{validate ? 'yes' : 'no'}</span></div>
              <div className="biz-review-row"><span className="faint">Budget</span><span className="mono">{cycleCredits} / cycle · {monthlyCredits} / month</span></div>
            </div>
          </>
        )}

        <ErrorLine error={error} />
        <div className="row" style={{ marginTop: 22, justifyContent: 'space-between' }}>
          <div>
            {step > 0 ? (
              <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>
            ) : onCancel ? (
              <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            ) : null}
          </div>
          {step < 2 ? (
            <button className="btn btn-primary" disabled={step === 0 && !step0ok} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn btn-primary" disabled={saving} onClick={() => void create()}>
              {saving ? 'Creating…' : 'Create company'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

