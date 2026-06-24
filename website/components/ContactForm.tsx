'use client';

import { useState } from 'react';
import { MotionButton } from './MotionButton';
import { Reveal } from './Reveal';

type State = 'idle' | 'loading' | 'sent' | 'error';

export function ContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [state, setState] = useState<State>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('loading');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message, website: honeypot }),
      });
      if (!res.ok) {
        setState('error');
        return;
      }
      setState('sent');
    } catch {
      setState('error');
    }
  }

  return (
    <section id="contact" className="section">
      <div className="container">
        <Reveal>
          <div className="contact">
            <p className="eyebrow">Contact</p>
            <h2 className="contact-head">Get in touch</h2>

            {state === 'sent' ? (
              <p className="contact-success" role="status">
                Message sent — we&apos;ll get back to you soon.
              </p>
            ) : (
              <form className="contact-form" onSubmit={submit}>
                <div className="contact-row">
                  <div className="contact-field">
                    <label htmlFor="c-name">Name</label>
                    <input
                      id="c-name"
                      type="text"
                      required
                      className="field"
                      value={name}
                      autoComplete="name"
                      onChange={(e) => setName(e.target.value)}
                      disabled={state === 'loading'}
                    />
                  </div>
                  <div className="contact-field">
                    <label htmlFor="c-email">Email</label>
                    <input
                      id="c-email"
                      type="email"
                      required
                      className="field"
                      value={email}
                      autoComplete="email"
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={state === 'loading'}
                    />
                  </div>
                </div>

                <div className="contact-field">
                  <label htmlFor="c-message">Message</label>
                  <textarea
                    id="c-message"
                    required
                    className="field"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={state === 'loading'}
                  />
                </div>

                {/* Honeypot — leave empty; bots fill it */}
                <input
                  type="text"
                  name="website"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                  tabIndex={-1}
                  aria-hidden="true"
                  autoComplete="off"
                  style={{
                    position: 'absolute',
                    left: '-9999px',
                    width: '1px',
                    height: '1px',
                    opacity: 0,
                    pointerEvents: 'none',
                  }}
                />

                <MotionButton
                  as="button"
                  type="submit"
                  className="btn-primary contact-btn"
                  disabled={state === 'loading'}
                >
                  {state === 'loading' ? (
                    <span className="spinner" aria-label="Sending" />
                  ) : (
                    'Send message'
                  )}
                </MotionButton>

                {state === 'error' && (
                  <p className="form-error" role="alert">
                    Something went wrong. Please try again.
                  </p>
                )}
              </form>
            )}
          </div>
        </Reveal>
      </div>

      <style jsx global>{`
        .contact {
          max-width: 600px;
          margin-inline: auto;
        }
        .contact-head {
          font-size: clamp(28px, 4vw, 40px);
          margin-top: var(--s-3);
        }
        .contact-form {
          margin-top: var(--s-8);
          display: flex;
          flex-direction: column;
          gap: var(--s-5);
        }
        .contact-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--s-4);
        }
        .contact-btn {
          align-self: flex-start;
          min-width: 160px;
        }
        .contact-success {
          margin-top: var(--s-6);
          color: var(--good);
          font-size: 17px;
        }
        @media (max-width: 560px) {
          .contact-row {
            grid-template-columns: 1fr;
          }
          .contact-btn {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
