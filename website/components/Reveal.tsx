'use client';

import { motion, useReducedMotion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';

const EASE = [0.16, 1, 0.3, 1] as const;

export const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.36, ease: EASE },
  },
};

export const staggerParent: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

export const childVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.44, ease: EASE } },
};

/** whileInView reveal wrapper. Renders final state under reduced motion. */
export function Reveal({
  children,
  className,
  as = 'div',
  stagger = false,
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'section';
  stagger?: boolean;
}) {
  const prefersReduced = useReducedMotion();
  const Comp = as === 'section' ? motion.section : motion.div;

  if (prefersReduced) {
    const Plain = as === 'section' ? 'section' : 'div';
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Comp
      className={className}
      variants={stagger ? staggerParent : sectionVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
    >
      {children}
    </Comp>
  );
}
