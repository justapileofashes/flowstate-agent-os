'use client';

import { useState } from 'react';
import { MotionButton } from './MotionButton';
import { Reveal } from './Reveal';

type State = 'idle' | 'loading' | 'new' | 'already' | 'error';

export function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'website' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        return;
      }
      setState(data.already ? 'already' : 'new');
    } catch {
      setState('error');
    }
  }

  const done = state === 'new' || state === 'already';

  return (
    <section id="waitlist" className="section">
      <div className="container">
        <Reveal>
          <div className="wl">
            <p className="eyebrow">Waitlist</p>
            <h2 className="wl-head">Join the waitlist</h2>
            <p className="wl-sub">
              Be first to know when new features and tiers ship.
            </p>

            {done ? (
              <p className="wl-success" role="status">
                {state === 'already'
                  ? "You're already on the list — we'll be in touch."
                  : "You're on the list!"}
              </p>
            ) : (
              <form className="wl-form" onSubmit={submit}>
                <label htmlFor="wl-email" className="sr-label">
                  Email address
                </label>
                <input
                  id="wl-email"
                  type="email"
                  required
                  className="field"
                  placeholder="you@example.com"
                  value={email}
                  autoComplete="email"
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (state === 'error') setState('idle');
                  }}
                  disabled={state === 'loading'}
                />
                <MotionButton
                  as="button"
                  type="submit"
                  className="btn-primary wl-btn"
                  disabled={state === 'loading'}
                >
                  {state === 'loading' ? (
                    <span className="spinner" aria-label="Joining" />
                  ) : (
                    'Join'
                  )}
                </MotionButton>
              </form>
            )}

            {state === 'error' && (
              <p className="form-error" role="alert">
                Something went wrong. Please try again.
              </p>
            )}
          </div>
        </Reveal>
      </div>

      <style jsx global>{`
        .wl {
          max-width: 480px;
          margin-inline: auto;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--s-3);
        }
        .wl-head {
          font-size: clamp(28px, 4vw, 40px);
        }
        .wl-sub {
          color: var(--ink-muted);
        }
        .wl-form {
          display: flex;
          gap: var(--s-3);
          width: 100%;
          margin-top: var(--s-4);
        }
        .wl-form .field {
          flex: 1;
        }
        .wl-btn {
          flex-shrink: 0;
          min-width: 96px;
        }
        .wl-success {
          margin-top: var(--s-4);
          color: var(--good);
          font-size: 16px;
        }
        .sr-label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }
        @media (max-width: 480px) {
          .wl-form {
            flex-direction: column;
          }
          .wl-btn {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
