/**
 * Abstract monochrome wireframe mocks of each Flowstate app surface.
 * Token-driven, no photography, no colorful icons. Each is a simplified
 * suggestion of the real surface, not a literal screenshot.
 */
import type { ReactNode } from 'react';

const S = {
  card: 'var(--surface-2)',
  card3: 'var(--surface-3)',
  line: 'var(--border-strong)',
  ink: 'var(--ink-faint)',
  inkStrong: 'var(--ink-muted)',
  accent: 'var(--accent-warm)',
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 320 200"
      width="100%"
      height="100%"
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        x="0.5"
        y="0.5"
        width="319"
        height="199"
        rx="12"
        fill="var(--surface)"
        stroke={S.line}
      />
      {children}
    </svg>
  );
}

export const FEATURE_VISUALS: Record<string, ReactNode> = {
  dashboard: (
    <Frame>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const x = 20 + (i % 3) * 100;
        const y = 24 + Math.floor(i / 3) * 86;
        return (
          <g key={i}>
            <rect x={x} y={y} width="84" height="70" rx="8" fill={S.card} stroke={S.line} />
            <circle cx={x + 18} cy={y + 22} r="9" fill="none" stroke={S.accent} strokeWidth="2" strokeDasharray="44 14" />
            <rect x={x + 34} y={y + 16} width="36" height="5" rx="2.5" fill={S.inkStrong} />
            <rect x={x + 34} y={y + 27} width="22" height="4" rx="2" fill={S.ink} />
            <rect x={x + 12} y={y + 48} width="60" height="4" rx="2" fill={S.line} />
          </g>
        );
      })}
    </Frame>
  ),
  team: (
    <Frame>
      <circle cx="160" cy="40" r="13" fill={S.card3} stroke={S.accent} strokeWidth="1.5" />
      {[60, 130, 200, 270].map((x) => (
        <g key={x}>
          <path d={`M160 53 C160 80 ${x} 70 ${x} 110`} stroke={S.line} strokeWidth="1.5" fill="none" />
          <rect x={x - 26} y="112" width="52" height="40" rx="7" fill={S.card} stroke={S.line} />
          <circle cx={x} cy="128" r="6" fill="none" stroke={S.ink} strokeWidth="1.5" />
          <rect x={x - 16} y="140" width="32" height="4" rx="2" fill={S.line} />
        </g>
      ))}
      <rect x="120" y="168" width="80" height="6" rx="3" fill={S.inkStrong} />
    </Frame>
  ),
  flowclaw: (
    <Frame>
      <rect x="20" y="24" width="120" height="152" rx="8" fill={S.card} stroke={S.line} />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <rect x="34" y={40 + i * 32} width="92" height="20" rx="5" fill={i === 1 ? S.card3 : 'transparent'} stroke={i === 1 ? S.accent : S.line} />
          <rect x="42" y={47 + i * 32} width="50" height="5" rx="2.5" fill={i === 1 ? S.inkStrong : S.ink} />
        </g>
      ))}
      <rect x="156" y="24" width="144" height="152" rx="8" fill={S.card} stroke={S.line} />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x="170" y={42 + i * 26} width={120 - (i % 3) * 24} height="6" rx="3" fill={i === 0 ? S.accent : S.line} />
      ))}
    </Frame>
  ),
  business: (
    <Frame>
      <line x1="40" y1="48" x2="280" y2="48" stroke={S.line} strokeWidth="1" />
      <line x1="40" y1="100" x2="280" y2="100" stroke={S.line} strokeWidth="1" />
      <line x1="40" y1="152" x2="280" y2="152" stroke={S.line} strokeWidth="1" />
      {[
        [60, 48, 70],
        [120, 100, 120],
        [150, 48, 60],
        [210, 100, 60],
        [240, 152, 40],
      ].map(([x, y, w], i) => (
        <g key={i}>
          <rect x={x} y={y - 9} width={w} height="18" rx="6" fill={i === 1 ? S.card3 : S.card} stroke={i === 1 ? S.accent : S.line} />
          <rect x={x + 8} y={y - 2} width={(w as number) - 30} height="4" rx="2" fill={S.ink} />
        </g>
      ))}
      <circle cx="40" cy="48" r="3" fill={S.accent} />
      <circle cx="40" cy="100" r="3" fill={S.accent} />
      <circle cx="40" cy="152" r="3" fill={S.accent} />
    </Frame>
  ),
  trading: (
    <Frame>
      <polyline
        points="24,150 56,120 88,134 120,90 152,104 184,60 216,78 248,44 296,30"
        fill="none"
        stroke={S.accent}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polyline points="24,150 56,120 88,134 120,90 152,104 184,60 216,78 248,44 296,30" fill="url(#tg)" stroke="none" opacity="0.25" />
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent-warm)" stopOpacity="0.4" />
          <stop offset="1" stopColor="var(--accent-warm)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[80, 130, 180].map((y) => (
        <line key={y} x1="24" y1={y} x2="296" y2={y} stroke={S.line} strokeWidth="0.75" strokeDasharray="3 5" />
      ))}
      <circle cx="248" cy="44" r="4" fill="var(--bg)" stroke={S.accent} strokeWidth="2" />
    </Frame>
  ),
  connectors: (
    <Frame>
      <rect x="130" y="80" width="60" height="40" rx="9" fill={S.card3} stroke={S.accent} strokeWidth="1.5" />
      <rect x="146" y="94" width="28" height="5" rx="2.5" fill={S.inkStrong} />
      <rect x="146" y="105" width="18" height="4" rx="2" fill={S.ink} />
      {[
        [40, 36],
        [40, 150],
        [280, 36],
        [280, 150],
      ].map(([x, y], i) => (
        <g key={i}>
          <path
            d={`M${x < 160 ? x + 36 : x} ${y + 12} C ${160} ${y + 12}, ${160} ${100}, ${x < 160 ? 130 : 190} ${100}`}
            stroke={S.line}
            strokeWidth="1.5"
            fill="none"
          />
          <rect x={x} y={y} width="40" height="26" rx="7" fill={S.card} stroke={S.line} />
          <circle cx={x + 12} cy={y + 13} r="4" fill="none" stroke={S.ink} strokeWidth="1.5" />
          <rect x={x + 22} y={y + 11} width="12" height="4" rx="2" fill={S.ink} />
        </g>
      ))}
    </Frame>
  ),
  brain: (
    <Frame>
      <circle cx="160" cy="100" r="58" fill="none" stroke={S.line} strokeWidth="1" strokeDasharray="2 6" />
      <circle cx="160" cy="100" r="34" fill="none" stroke={S.line} strokeWidth="1" strokeDasharray="2 6" />
      <circle cx="160" cy="100" r="10" fill={S.card3} stroke={S.accent} strokeWidth="1.5" />
      {[
        [220, 70],
        [110, 60],
        [96, 140],
        [232, 134],
        [160, 36],
        [160, 164],
      ].map(([x, y], i) => (
        <g key={i}>
          <line x1="160" y1="100" x2={x} y2={y} stroke={S.line} strokeWidth="1" />
          <circle cx={x} cy={y} r="5" fill={S.card} stroke={i % 2 ? S.accent : S.ink} strokeWidth="1.5" />
        </g>
      ))}
    </Frame>
  ),
  routines: (
    <Frame>
      {[40, 90, 140].map((y, row) => (
        <g key={y}>
          <circle cx="44" cy={y} r="7" fill={row === 1 ? S.card3 : 'transparent'} stroke={row === 1 ? S.accent : S.line} strokeWidth="1.5" />
          {row === 1 && <path d="M41 40 l2.4 2.6 L48 37" stroke={S.accent} strokeWidth="1.6" fill="none" transform="translate(0 48)" />}
          <rect x="64" y={y - 10} width="160" height="20" rx="6" fill={S.card} stroke={S.line} />
          <rect x="74" y={y - 3} width="90" height="5" rx="2.5" fill={S.inkStrong} />
          <rect x="244" y={y - 8} width="50" height="16" rx="5" fill="transparent" stroke={S.line} />
          <rect x="252" y={y - 2} width="34" height="4" rx="2" fill={S.ink} />
        </g>
      ))}
      <line x1="44" y1="47" x2="44" y2="83" stroke={S.line} strokeWidth="1.5" strokeDasharray="2 4" />
      <line x1="44" y1="97" x2="44" y2="133" stroke={S.line} strokeWidth="1.5" strokeDasharray="2 4" />
    </Frame>
  ),
};
