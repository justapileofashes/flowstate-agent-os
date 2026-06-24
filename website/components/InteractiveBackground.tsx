'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

type Node = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

/**
 * Fixed, full-viewport monochrome canvas behind all content. A sparse
 * constellation of faint nodes drifts slowly over the page. Near the cursor,
 * nodes brighten and connect with thin lines — a soft gravitational lens that
 * eases (never snaps) toward the pointer. Drift speed shifts subtly with scroll.
 *
 * Strictly monochrome: only warm-neutral platinum tones, low opacity, so text
 * always wins. Throttled (DPR cap, tab-hidden + offscreen pause, debounced
 * resize). On coarse pointers the cursor reactivity is dropped. With reduced
 * motion it renders a single static frame and never animates.
 */
export function InteractiveBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    const canvas: HTMLCanvasElement | null = canvasRef.current;
    if (!canvas) return;
    const cv: HTMLCanvasElement = canvas;
    const ctx = cv.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const cursorReactive = !coarse && !prefersReduced;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let rafId = 0;
    let running = false;

    // Eased pointer + a target it chases.
    const pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
    // Eased scroll-driven drift multiplier.
    let driftTarget = 1;
    let drift = 1;

    const NODE_DENSITY = 0.00009; // nodes per px²
    const MAX_NODES = 110;
    const LINK_DIST = 150; // px — cursor lensing radius for links
    const LINK_DIST_SQ = LINK_DIST * LINK_DIST;

    function buildNodes() {
      const count = Math.min(
        MAX_NODES,
        Math.floor(width * height * NODE_DENSITY),
      );
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.12,
        vy: (Math.random() - 0.5) * 0.12,
        r: Math.random() * 1.1 + 0.5,
      }));
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      cv.width = Math.floor(width * dpr);
      cv.height = Math.floor(height * dpr);
      cv.style.width = `${width}px`;
      cv.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildNodes();
    }

    function draw(animate: boolean) {
      ctx!.clearRect(0, 0, width, height);

      if (animate) {
        // Ease pointer toward target (lag ~0.08/frame).
        pointer.x += (pointer.tx - pointer.x) * 0.08;
        pointer.y += (pointer.ty - pointer.y) * 0.08;
        drift += (driftTarget - drift) * 0.04;
      }

      // Move + render nodes.
      for (const n of nodes) {
        if (animate) {
          n.x += n.vx * drift;
          n.y += n.vy * drift;
          if (n.x < -20) n.x = width + 20;
          if (n.x > width + 20) n.x = -20;
          if (n.y < -20) n.y = height + 20;
          if (n.y > height + 20) n.y = -20;
        }

        let glow = 0;
        if (cursorReactive && pointer.active) {
          const dx = n.x - pointer.x;
          const dy = n.y - pointer.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < LINK_DIST_SQ) {
            glow = 1 - Math.sqrt(dSq) / LINK_DIST;
          }
        }

        const baseAlpha = 0.16;
        const alpha = baseAlpha + glow * 0.5;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r + glow * 0.6, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(232, 227, 213, ${alpha})`;
        ctx!.fill();
      }

      // Cursor-lensed links: only connect nodes near the pointer.
      if (cursorReactive && pointer.active) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          const adx = a.x - pointer.x;
          const ady = a.y - pointer.y;
          if (adx * adx + ady * ady > LINK_DIST_SQ) continue;
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dSq = dx * dx + dy * dy;
            if (dSq < LINK_DIST_SQ) {
              const t = 1 - Math.sqrt(dSq) / LINK_DIST;
              ctx!.beginPath();
              ctx!.moveTo(a.x, a.y);
              ctx!.lineTo(b.x, b.y);
              ctx!.strokeStyle = `rgba(214, 205, 182, ${t * 0.14})`;
              ctx!.lineWidth = 0.6;
              ctx!.stroke();
            }
          }
        }
      }
    }

    function loop() {
      if (!running) return;
      draw(true);
      rafId = requestAnimationFrame(loop);
    }

    function start() {
      if (running || prefersReduced) return;
      running = true;
      rafId = requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    // Pointer tracking (eased — only sets the target).
    function onPointerMove(e: PointerEvent) {
      pointer.tx = e.clientX;
      pointer.ty = e.clientY;
      if (!pointer.active) {
        pointer.active = true;
        pointer.x = e.clientX;
        pointer.y = e.clientY;
      }
    }
    function onPointerLeave() {
      pointer.active = false;
    }

    // Scroll-reactive drift: faster drift while actively scrolling, easing back.
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    function onScroll() {
      driftTarget = 2.4;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        driftTarget = 1;
      }, 180);
    }

    // Pause when the tab is hidden.
    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    // Pause when the canvas scrolls fully out of view.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start();
        else stop();
      },
      { threshold: 0 },
    );

    // Debounced resize.
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 150);
    }

    resize();

    if (prefersReduced) {
      // Single static frame — no animation, no pointer tracking.
      draw(false);
      return () => {
        io.disconnect();
      };
    }

    if (cursorReactive) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerleave', onPointerLeave);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    io.observe(cv);

    start();

    return () => {
      stop();
      io.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (scrollTimer) clearTimeout(scrollTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [prefersReduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        // Soft vignette so center stays calm and edges fade out.
        maskImage:
          'radial-gradient(120% 120% at 50% 30%, #000 55%, transparent 100%)',
        WebkitMaskImage:
          'radial-gradient(120% 120% at 50% 30%, #000 55%, transparent 100%)',
      }}
    />
  );
}
