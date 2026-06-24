'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ComponentProps } from 'react';

const spring = { type: 'spring' as const, stiffness: 400, damping: 30 };

type Common = {
  as?: 'a' | 'button';
  className?: string;
};

type Props =
  | (Common & { as?: 'a' } & ComponentProps<typeof motion.a>)
  | (Common & { as: 'button' } & ComponentProps<typeof motion.button>);

/**
 * Primary/ghost CTA with the calm Flowstate micro-interactions:
 * hover lifts + accent-glow pulse, tap presses in. Ghost variant only shifts
 * color (no scale). Honors reduced motion.
 */
export function MotionButton(props: Props) {
  const prefersReduced = useReducedMotion();
  const { as = 'a', className = '', ...rest } = props as Common &
    Record<string, unknown>;
  const isGhost = className.includes('btn-ghost');

  const hover = prefersReduced || isGhost ? undefined : { scale: 1.015, y: -1 };
  const tap = prefersReduced || isGhost ? undefined : { scale: 0.985 };

  const common = {
    className: `btn ${className}`,
    whileHover: hover,
    whileTap: tap,
    transition: spring,
  };

  if (as === 'button') {
    return (
      <motion.button
        {...common}
        {...(rest as ComponentProps<typeof motion.button>)}
      />
    );
  }
  return (
    <motion.a {...common} {...(rest as ComponentProps<typeof motion.a>)} />
  );
}
