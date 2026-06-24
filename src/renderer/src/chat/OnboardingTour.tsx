// OnboardingTour — first-launch 3-step walkthrough. Stores a flag in
// settings so it only shows once.

import { useEffect, useState, type JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc } from '../lib/ipc';
import { BrandMark } from '../lib/brand-mark';

const STORAGE_KEY = 'seen_onboarding_tour';

interface Step {
  title: string;
  body: string;
  cta: string;
}

const STEPS: Step[] = [
  {
    title: 'Welcome to Flowstate',
    body: 'A dashboard for running local + cloud AI agents side by side. Every agent has a personality, a model, a workspace, and tools.',
    cta: 'Next',
  },
  {
    title: 'Ask anything from the dashboard',
    body: 'Type a goal in the composer and the orchestrator routes it to the best specialist. Try the suggestion chips for one-tap starts.',
    cta: 'Next',
  },
  {
    title: 'Customize as you go',
    body: 'Sidebar → Customize lets you tweak theme, density, accent, dashboard sections, and what your agent cards show. Pin sessions you keep coming back to. Right-click any session for more.',
    cta: 'Got it',
  },
];

export function OnboardingTour(): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    void (async () => {
      try {
        const r = await ipc.settings.get(STORAGE_KEY);
        if (r.value !== 'true') setOpen(true);
      } catch {
        // best-effort
      }
    })();
  }, []);

  async function dismiss(): Promise<void> {
    setOpen(false);
    try {
      await ipc.settings.set(STORAGE_KEY, 'true');
    } catch {
      // best-effort
    }
  }

  if (!open) return null;
  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ position: 'fixed', zIndex: 60 }}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="onboarding-title"
          className="modal card"
          style={{ maxWidth: 460, width: '100%' }}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          <div style={{ padding: '20px 20px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: 'var(--ink-strong)' }}>
              <BrandMark size={20} state="idle" />
            </span>
            <span className="eyebrow">Step {step + 1} of {STEPS.length}</span>
          </div>
          <div style={{ padding: '4px 20px 16px' }}>
            <h2
              id="onboarding-title"
              style={{ margin: '4px 0 8px', fontWeight: 400, fontSize: 20, color: 'var(--ink-strong)' }}
            >
              {current.title}
            </h2>
            <p className="muted text-sm" style={{ margin: 0, lineHeight: 1.55 }}>
              {current.body}
            </p>
          </div>
          <div
            className="row"
            style={{
              padding: '12px 20px',
              borderTop: '1px solid var(--border)',
              justifyContent: 'space-between',
            }}
          >
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void dismiss()}>
              Skip tour
            </button>
            <div className="row gap-2">
              {step > 0 ? (
                <button type="button" className="btn btn-sm" onClick={() => setStep((s) => s - 1)}>
                  Back
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => (isLast ? void dismiss() : setStep((s) => s + 1))}
              >
                {current.cta}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
