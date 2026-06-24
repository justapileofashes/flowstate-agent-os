'use client';

import { motion, useScroll, useSpring, useReducedMotion } from 'framer-motion';

/** Thin 1px top progress bar driven by page scroll. Quiet, on-brand. */
export function ScrollProgressBar() {
  const prefersReduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 120,
    damping: 30,
    restDelta: 0.001,
  });

  if (prefersReduced) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{
        scaleX,
        transformOrigin: '0% 50%',
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 1,
        background: 'var(--accent)',
        opacity: 0.35,
        zIndex: 100,
      }}
    />
  );
}
