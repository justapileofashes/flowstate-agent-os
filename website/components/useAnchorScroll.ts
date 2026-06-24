'use client';

import { useCallback } from 'react';
import { useLenis } from 'lenis/react';

/**
 * Returns a click handler for in-page anchor links that routes through Lenis
 * smooth scroll when available, falling back to native scrollIntoView (which
 * respects prefers-reduced-motion). `hash` is like '#features'.
 */
export function useAnchorScroll() {
  const lenis = useLenis();

  return useCallback(
    (hash: string) => (e: React.MouseEvent) => {
      // Only handle same-page hash links.
      if (!hash.startsWith('#')) return;
      const id = hash.slice(1);
      const el = document.getElementById(id);
      if (!el) return; // let the browser navigate (e.g. from /pricing → /#x)
      e.preventDefault();
      if (lenis) {
        lenis.scrollTo(el, { offset: -72, duration: 1.2 });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      history.replaceState(null, '', hash);
    },
    [lenis],
  );
}
