// Flowstate brand mark — 9 vertical bars, hand-shaped waveform.
// Animation ports the design bundle's FlowMark: each bar's height is
// multiplied by a per-state sin wave so the silhouette breathes/flows.
// No opacity pulsing on the mark itself — it stays at full brightness.
//
// States:
//   - static    no animation (default; bars at base heights)
//   - idle      gentle breath (slow, low amplitude)
//   - streaming fast, deep wave
//   - tool      slow pulse, moderate amplitude

import { useEffect, useRef, useState, type JSX } from 'react';

interface Props {
  size?: number;
  className?: string;
  state?: 'static' | 'idle' | 'streaming' | 'tool';
  /** Force-enable the animation loop regardless of `state`. */
  animated?: boolean;
}

const BASE_HEIGHTS = [40, 60, 95, 70, 100, 75, 50, 35, 22];
const BAR_COUNT = BASE_HEIGHTS.length;
const STROKE = 1.4;
const STEP = 2.8;

export function BrandMark({
  size = 18,
  className = '',
  state = 'static',
  animated,
}: Props): JSX.Element {
  const running = animated ?? state !== 'static';
  const [t, setT] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!running) {
      setT(0);
      return;
    }
    let alive = true;
    const start = performance.now();
    const loop = (now: number): void => {
      if (!alive) return;
      setT((now - start) / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [running]);

  const heights = BASE_HEIGHTS.map((h, i) => {
    if (!running) return h;
    let mul: number;
    switch (state) {
      case 'streaming':
        mul = 0.7 + 0.45 * Math.sin(t * 2.4 + i * 0.7);
        break;
      case 'tool':
        mul = 0.85 + 0.2 * Math.sin(t * 1.2 + i);
        break;
      case 'idle':
      default:
        mul = 0.92 + 0.08 * Math.sin(t * 0.6 + i * 0.4);
        break;
    }
    return Math.max(10, Math.min(100, h * mul));
  });

  const span = (BAR_COUNT - 1) * STEP;
  const startX = 12 - span / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      {heights.map((h, i) => {
        const x = startX + i * STEP;
        const halfH = h / 12;
        return (
          <line
            key={i}
            x1={x}
            y1={12 - halfH}
            x2={x}
            y2={12 + halfH}
            style={{
              transition: running ? 'none' : 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        );
      })}
    </svg>
  );
}
