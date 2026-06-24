'use client';

import { FeatureCard, type Feature } from './FeatureCard';
import { Reveal } from './Reveal';

const FEATURES: Feature[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    copy: 'Every agent at a glance. One command center — live status rings, run counts, memory usage.',
  },
  {
    id: 'team',
    name: 'Multi-agent team runs',
    copy: 'Fan out. Coordinate. Converge — all locally. Orchestrate parallel agents on a single task.',
  },
  {
    id: 'flowclaw',
    name: 'Flowclaw',
    copy: 'Your own gateway. Your own models. Zero cloud dependency — a control plane over OpenClaw and Hermes.',
  },
  {
    id: 'business',
    name: 'Business autopilot',
    copy: 'Automate the repetitive. Own the output. Scheduled workflows that run your business tasks unattended.',
  },
  {
    id: 'trading',
    name: 'Trading',
    copy: 'Market signals, local inference. No data leaves your machine — research, analyse and predict stocks and crypto.',
  },
  {
    id: 'connectors',
    name: 'Connectors (MCP)',
    copy: 'Connect any tool. Keep secrets secret. An MCP registry with encrypted secrets and a test button per server.',
  },
  {
    id: 'brain',
    name: 'Brain',
    copy: 'Long-term memory for your agents. Grows with your work — knowledge ingestion and vector search.',
  },
  {
    id: 'routines',
    name: 'Routines',
    copy: 'Set it. Forget it. Audit it later. Cron-driven agent runs on a schedule you control.',
  },
];

export function FeatureSection() {
  return (
    <section id="features" className="section">
      <div className="container">
        <Reveal>
          <p className="eyebrow">Features</p>
          <h2 className="feat-head">
            Eight surfaces. One local command center.
          </h2>
          <p className="feat-sub">
            Everything Flowstate does runs on your own hardware. No keys to
            leak, no data to ship.
          </p>
        </Reveal>

        <div className="feat-list">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.id} feature={f} index={i} />
          ))}
        </div>
      </div>

      <style jsx global>{`
        .feat-head {
          font-size: clamp(30px, 5vw, 52px);
          margin-top: var(--s-4);
          max-width: 18ch;
        }
        .feat-sub {
          margin-top: var(--s-5);
          color: var(--ink-muted);
          font-size: clamp(16px, 2vw, 19px);
          max-width: 48ch;
        }
        .feat-list {
          margin-top: clamp(56px, 9vw, 120px);
          display: flex;
          flex-direction: column;
          gap: clamp(72px, 12vw, 150px);
        }
      `}</style>
    </section>
  );
}
