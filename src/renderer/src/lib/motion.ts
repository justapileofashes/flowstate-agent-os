// Centralized motion tokens. All easings are exponential ease-out per
// impeccable design law: no bounce, no elastic. Animate transform + opacity,
// never layout properties (width/height/padding/etc.) — use scale where
// possible and let layout shifts settle without animation.

import type { Transition, Variants } from 'framer-motion';

export const EASE_OUT = [0.16, 1, 0.3, 1] as const; // cubic ease-out-expo
export const EASE_OUT_QUART = [0.25, 1, 0.5, 1] as const;

export const TRANSITION_FAST: Transition = {
  duration: 0.18,
  ease: EASE_OUT_QUART as unknown as number[],
};

export const TRANSITION_DEFAULT: Transition = {
  duration: 0.28,
  ease: EASE_OUT as unknown as number[],
};

export const TRANSITION_SLOW: Transition = {
  duration: 0.42,
  ease: EASE_OUT as unknown as number[],
};

// Fade + slight rise. Good for cards, list items.
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: TRANSITION_DEFAULT },
};

// Stagger container — children animate one by one.
export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.04, delayChildren: 0.04 } },
};

// Modal: fade + tiny scale. Avoids layout-shift jitter.
export const modalBackdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TRANSITION_FAST },
  exit: { opacity: 0, transition: TRANSITION_FAST },
};

export const modalPanel: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: TRANSITION_DEFAULT },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: TRANSITION_FAST },
};

// Toast: slide from right + fade.
export const toastSlide: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: TRANSITION_DEFAULT },
  exit: { opacity: 0, x: 24, transition: TRANSITION_FAST },
};

// Approval modal: rises from bottom.
export const sheetUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: TRANSITION_DEFAULT },
  exit: { opacity: 0, y: 16, transition: TRANSITION_FAST },
};
