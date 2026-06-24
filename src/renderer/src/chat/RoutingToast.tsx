import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { toastSlide } from '../lib/motion';

export interface RoutingToastInfo {
  agentName: string;
  reasoning: string;
  fallback: boolean;
}

interface Props {
  info: RoutingToastInfo;
  onDismiss: () => void;
}

export function RoutingToast({ info, onDismiss }: Props): JSX.Element {
  useEffect(() => {
    const t = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(t);
  }, [onDismiss]);

  const border = info.fallback ? 'border-[var(--bad)]/60' : 'border-[var(--accent)]/40';

  return (
    <motion.div
      className="fixed top-4 right-4 z-50 max-w-[420px]"
      variants={toastSlide}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <button
        type="button"
        onClick={onDismiss}
        className={`block w-full text-left rounded-lg border ${border} bg-[var(--bg)] p-4 shadow-xl`}
      >
        <div className="flex items-center gap-2">
          <span className={info.fallback ? 'text-[var(--bad)]' : 'text-[var(--accent)]'}>
            {info.fallback ? '!' : '·'}
          </span>
          <span className="text-sm">
            Routed to <strong>{info.agentName}</strong>
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{info.reasoning}</p>
      </button>
    </motion.div>
  );
}
