'use client';

import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useSpring,
  useReducedMotion,
} from 'framer-motion';
import { MotionButton } from './MotionButton';
import { useAnchorScroll } from './useAnchorScroll';

const EASE = [0.16, 1, 0.3, 1] as const;

export function Hero() {
  const ref = useRef<HTMLElement | null>(null);
  const prefersReduced = useReducedMotion();
  const onAnchor = useAnchorScroll();
  const [version, setVersion] = useState<string | null>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start'],
  });
  const smooth = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });
  // Mid-layer drifts at ~0.3× while foreground text lifts + fades gently.
  const gridY = useTransform(smooth, [0, 1], [0, 120]);
  const textY = useTransform(smooth, [0, 1], [0, -40]);
  const textOpacity = useTransform(smooth, [0, 0.7], [1, 0]);

  useEffect(() => {
    fetch('/api/latest')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.version && setVersion(d.version))
      .catch(() => {});
  }, []);

  const container = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
  };
  const item = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.5, ease: EASE },
    },
  };

  return (
    <section id="hero" ref={ref} className="hero">
      {/* Parallax mid-layer: a faint geometric grid that drifts under the text. */}
      <motion.div
        className="hero-grid"
        aria-hidden="true"
        style={prefersReduced ? undefined : { y: gridY }}
      />
      <div className="hero-fade" aria-hidden="true" />

      <motion.div
        className="container hero-inner"
        style={prefersReduced ? undefined : { y: textY, opacity: textOpacity }}
        variants={container}
        initial={prefersReduced ? false : 'hidden'}
        animate="visible"
      >
        <motion.p className="eyebrow" variants={item}>
          Local AI agents · No cloud
        </motion.p>

        <motion.h1 className="hero-title" variants={item}>
          Flowstate
        </motion.h1>

        <motion.p className="hero-tagline" variants={item}>
          Local AI agents on your own machine — no API keys, no cloud.
        </motion.p>

        <motion.div className="hero-cta" variants={item}>
          <MotionButton href="/api/download/setup" className="btn-primary">
            Download for Windows
          </MotionButton>
          <MotionButton
            href="/#features"
            onClick={onAnchor('#features')}
            className="btn-ghost"
          >
            See features
          </MotionButton>
        </motion.div>

        {version && (
          <motion.div className="hero-version mono" variants={item}>
            v{version}
          </motion.div>
        )}
      </motion.div>

      <style jsx global>{`
        .hero {
          position: relative;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding-block: 96px var(--s-12);
        }
        .hero-grid {
          position: absolute;
          inset: -20% 0 -10% 0;
          background-image: linear-gradient(
              var(--accent-soft) 1px,
              transparent 1px
            ),
            linear-gradient(90deg, var(--accent-soft) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: radial-gradient(
            70% 60% at 50% 38%,
            #000 0%,
            transparent 78%
          );
          -webkit-mask-image: radial-gradient(
            70% 60% at 50% 38%,
            #000 0%,
            transparent 78%
          );
          opacity: 0.7;
          will-change: transform;
        }
        .hero-fade {
          position: absolute;
          inset: auto 0 0 0;
          height: 30%;
          background: linear-gradient(transparent, var(--bg));
          pointer-events: none;
        }
        .hero-inner {
          position: relative;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--s-5);
          will-change: transform;
        }
        .hero-title {
          font-size: clamp(56px, 12vw, 132px);
          font-weight: 600;
          letter-spacing: -0.045em;
          line-height: 0.96;
          background: linear-gradient(
            180deg,
            var(--ink-strong),
            var(--ink-muted)
          );
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
        }
        .hero-tagline {
          max-width: 560px;
          font-size: clamp(16px, 2.4vw, 20px);
          color: var(--ink-muted);
          line-height: 1.5;
        }
        .hero-cta {
          display: flex;
          flex-wrap: wrap;
          gap: var(--s-3);
          justify-content: center;
          margin-top: var(--s-4);
        }
        .hero-version {
          margin-top: var(--s-4);
          font-size: 12px;
          letter-spacing: 0.06em;
          color: var(--ink-faint);
          padding: 6px 12px;
          border: 1px solid var(--border-strong);
          border-radius: 999px;
          background: var(--surface);
        }
      `}</style>
    </section>
  );
}
