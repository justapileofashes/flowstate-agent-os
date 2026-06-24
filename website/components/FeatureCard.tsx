'use client';

import { useRef } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useReducedMotion,
} from 'framer-motion';
import { FEATURE_VISUALS } from './FeatureVisuals';

export type Feature = {
  id: string;
  name: string;
  copy: string;
};

/**
 * One feature card. Alternates image/text side on desktop. The visual is
 * scroll-linked: it rises and sharpens (blur → 0) as the card crosses center,
 * then eases back — a scrubbed effect on top of the whileInView reveal.
 */
export function FeatureCard({
  feature,
  index,
}: {
  feature: Feature;
  index: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const prefersReduced = useReducedMotion();
  const flipped = index % 2 === 1;

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const smooth = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });
  const y = useTransform(smooth, [0, 0.5, 1], [28, 0, -28]);
  const blur = useTransform(smooth, [0, 0.42, 0.58, 1], [6, 0, 0, 6]);
  const filter = useTransform(blur, (b) => `blur(${b}px)`);
  const scale = useTransform(smooth, [0, 0.5, 1], [0.98, 1.02, 0.98]);

  return (
    <div ref={ref} className="feat" data-flip={flipped || undefined}>
      <div className="feat-copy">
        <span className="feat-index mono">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="feat-name">{feature.name}</h3>
        <p className="feat-desc">{feature.copy}</p>
      </div>

      <motion.div
        className="feat-visual"
        style={prefersReduced ? undefined : { y, filter, scale }}
      >
        {FEATURE_VISUALS[feature.id]}
      </motion.div>

      <style jsx global>{`
        .feat {
          display: grid;
          grid-template-columns: 1fr 1fr;
          align-items: center;
          gap: clamp(32px, 6vw, 88px);
        }
        .feat[data-flip] .feat-copy {
          order: 2;
        }
        .feat-index {
          font-size: 12px;
          color: var(--ink-faint);
          letter-spacing: 0.1em;
        }
        .feat-name {
          font-size: clamp(26px, 3.4vw, 38px);
          margin-top: var(--s-3);
        }
        .feat-desc {
          margin-top: var(--s-4);
          font-size: clamp(15px, 1.8vw, 18px);
          color: var(--ink-muted);
          max-width: 38ch;
          line-height: 1.55;
        }
        .feat-visual {
          aspect-ratio: 320 / 200;
          width: 100%;
          border-radius: var(--r-lg);
          background: linear-gradient(
            160deg,
            var(--bg-elev),
            var(--surface)
          );
          border: 1px solid var(--border);
          box-shadow: var(--shadow-lg);
          padding: var(--s-4);
          will-change: transform, filter;
        }
        @media (max-width: 768px) {
          .feat {
            grid-template-columns: 1fr;
            gap: var(--s-6);
          }
          .feat[data-flip] .feat-copy {
            order: 0;
          }
        }
      `}</style>
    </div>
  );
}
