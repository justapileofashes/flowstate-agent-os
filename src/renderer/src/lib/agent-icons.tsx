// Agent icon registry. Each icon is a small inline SVG (lucide-inspired).
// Each seeded agent is mapped to a UNIQUE icon via SEED_AGENT_ICONS. New
// (user-created) agents fall back to keyword-based picking, then initial
// letter as a last resort.

import type { JSX } from 'react';
import type { AgentDto } from '@shared/chat-types';

export type IconName =
  | 'code'
  | 'terminal'
  | 'terminal-2'
  | 'brain'
  | 'search'
  | 'palette'
  | 'shield'
  | 'database'
  | 'network'
  | 'layers'
  | 'file-text'
  | 'beaker'
  | 'cog'
  | 'zap'
  | 'message'
  | 'sparkles'
  | 'bug'
  | 'rocket'
  | 'cube'
  | 'pencil'
  | 'compass'
  | 'pen-tool'
  | 'feather'
  | 'book'
  | 'clipboard'
  | 'chart-bar'
  | 'check-square'
  | 'eye'
  | 'monitor'
  | 'server'
  | 'git-branch'
  | 'git-merge'
  | 'sliders'
  | 'graduation-cap'
  | 'lightbulb'
  | 'hammer'
  | 'puzzle'
  | 'play'
  | 'plug'
  | 'plug-zap'
  | 'layout'
  | 'gamepad'
  | 'droplet'
  | 'workflow'
  | 'calendar'
  | 'link'
  | 'mouse-pointer'
  | 'folder-eye'
  | 'bell'
  | 'pipeline'
  | 'bot'
  | 'spider'
  | 'link-2'
  | 'gauge'
  | 'accessibility'
  | 'arrow-right-circle'
  | 'cloud'
  | 'container'
  | 'helm'
  | 'key'
  | 'credit-card'
  | 'activity'
  | 'globe'
  | 'asterisk'
  | 'smartphone'
  | 'image'
  | 'trending-up'
  | 'wand'
  | 'flow';

const P = {
  width: '100%',
  height: '100%',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const ICONS: Record<IconName, JSX.Element> = {
  code: (
    <svg {...P}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  terminal: (
    <svg {...P}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  'terminal-2': (
    <svg {...P}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <polyline points="6 10 9 13 6 16" />
      <line x1="12" y1="16" x2="17" y2="16" />
    </svg>
  ),
  brain: (
    <svg {...P}>
      <path d="M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10v2a3 3 0 0 0 2 2.83V17a3 3 0 0 0 3 3" />
      <path d="M15 4a3 3 0 0 1 3 3v.5A3 3 0 0 1 20 10v2a3 3 0 0 1-2 2.83V17a3 3 0 0 1-3 3" />
      <path d="M12 4v16" />
    </svg>
  ),
  search: (
    <svg {...P}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  palette: (
    <svg {...P}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" />
      <circle cx="12" cy="7.5" r="1.2" fill="currentColor" />
      <circle cx="16.5" cy="10.5" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="15.5" r="1.2" fill="currentColor" />
    </svg>
  ),
  shield: (
    <svg {...P}>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />
    </svg>
  ),
  database: (
    <svg {...P}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </svg>
  ),
  network: (
    <svg {...P}>
      <circle cx="12" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <line x1="12" y1="7" x2="6" y2="17" />
      <line x1="12" y1="7" x2="18" y2="17" />
      <line x1="7" y1="19" x2="17" y2="19" />
    </svg>
  ),
  layers: (
    <svg {...P}>
      <polygon points="12 3 22 8 12 13 2 8 12 3" />
      <polyline points="2 13 12 18 22 13" />
      <polyline points="2 18 12 23 22 18" />
    </svg>
  ),
  'file-text': (
    <svg {...P}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  ),
  beaker: (
    <svg {...P}>
      <path d="M9 3h6v5l5 11a2 2 0 0 1-1.8 2.9H5.8A2 2 0 0 1 4 19l5-11V3z" />
      <line x1="9" y1="3" x2="15" y2="3" />
    </svg>
  ),
  cog: (
    <svg {...P}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  zap: (
    <svg {...P}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  message: (
    <svg {...P}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  sparkles: (
    <svg {...P}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  ),
  bug: (
    <svg {...P}>
      <rect x="8" y="6" width="8" height="14" rx="4" />
      <path d="M12 6V3M9 3l-2 3M15 3l2 3M4 13h4M16 13h4M5 9l3 1M19 9l-3 1M5 17l3-1M19 17l-3-1" />
    </svg>
  ),
  rocket: (
    <svg {...P}>
      <path d="M5 19c0-3 2-7 7-12 5 5 7 9 7 12-2 1-5 1-7 1s-5 0-7-1z" />
      <circle cx="12" cy="11" r="1.5" />
      <path d="M9 19l-2 3M15 19l2 3" />
    </svg>
  ),
  cube: (
    <svg {...P}>
      <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.3 7 12 12 20.7 7" />
      <line x1="12" y1="22" x2="12" y2="12" />
    </svg>
  ),
  pencil: (
    <svg {...P}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  compass: (
    <svg {...P}>
      <circle cx="12" cy="12" r="9" />
      <polygon points="16 8 13 13 8 16 11 11 16 8" />
    </svg>
  ),
  'pen-tool': (
    <svg {...P}>
      <path d="M12 2 9 9l3 3 3-3-3-7z" />
      <path d="M12 12v8" />
      <path d="M9 22h6" />
    </svg>
  ),
  feather: (
    <svg {...P}>
      <path d="M20 4c-7 0-12 5-12 12v4h4c7 0 12-5 12-12-2 0-4 0-4 0z" />
      <line x1="4" y1="20" x2="14" y2="10" />
    </svg>
  ),
  book: (
    <svg {...P}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
      <path d="M4 19.5V21h15" />
    </svg>
  ),
  clipboard: (
    <svg {...P}>
      <rect x="6" y="4" width="12" height="18" rx="2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <line x1="9" y1="11" x2="15" y2="11" />
      <line x1="9" y1="15" x2="13" y2="15" />
    </svg>
  ),
  'chart-bar': (
    <svg {...P}>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="6" y="12" width="3" height="8" />
      <rect x="11" y="7" width="3" height="13" />
      <rect x="16" y="14" width="3" height="6" />
    </svg>
  ),
  'check-square': (
    <svg {...P}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <polyline points="8 12 11 15 16 9" />
    </svg>
  ),
  eye: (
    <svg {...P}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  monitor: (
    <svg {...P}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  server: (
    <svg {...P}>
      <rect x="3" y="3" width="18" height="7" rx="1" />
      <rect x="3" y="14" width="18" height="7" rx="1" />
      <line x1="6" y1="6.5" x2="6.01" y2="6.5" />
      <line x1="6" y1="17.5" x2="6.01" y2="17.5" />
    </svg>
  ),
  'git-branch': (
    <svg {...P}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  ),
  'git-merge': (
    <svg {...P}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  ),
  sliders: (
    <svg {...P}>
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="2" y1="14" x2="6" y2="14" />
      <line x1="10" y1="8" x2="14" y2="8" />
      <line x1="18" y1="16" x2="22" y2="16" />
    </svg>
  ),
  'graduation-cap': (
    <svg {...P}>
      <path d="M2 10 12 5l10 5-10 5z" />
      <path d="M6 12v4c0 1 3 2 6 2s6-1 6-2v-4" />
    </svg>
  ),
  lightbulb: (
    <svg {...P}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
    </svg>
  ),
  hammer: (
    <svg {...P}>
      <path d="M14 6l3-3 4 4-3 3z" />
      <path d="M14 6L4 16l4 4 10-10" />
    </svg>
  ),
  puzzle: (
    <svg {...P}>
      <path d="M19 11V8a2 2 0 0 0-2-2h-3V4a2 2 0 1 0-4 0v2H7a2 2 0 0 0-2 2v4h2a2 2 0 1 1 0 4H5v3a2 2 0 0 0 2 2h4v-2a2 2 0 1 1 4 0v2h2a2 2 0 0 0 2-2v-3h-2a2 2 0 1 1 0-4z" />
    </svg>
  ),
  play: (
    <svg {...P}>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" />
    </svg>
  ),
  plug: (
    <svg {...P}>
      <path d="M9 2v6" />
      <path d="M15 2v6" />
      <path d="M6 8h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 18v4" />
    </svg>
  ),
  'plug-zap': (
    <svg {...P}>
      <path d="M6 11l4-4 4 4-4 4z" />
      <path d="M14 7l3-3M10 14l-3 3" />
      <path d="M19 11l-2 2 2 2-2 2" />
    </svg>
  ),
  layout: (
    <svg {...P}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  ),
  gamepad: (
    <svg {...P}>
      <line x1="6" y1="11" x2="10" y2="11" />
      <line x1="8" y1="9" x2="8" y2="13" />
      <circle cx="15" cy="11" r="1" fill="currentColor" />
      <circle cx="17" cy="13" r="1" fill="currentColor" />
      <rect x="2" y="6" width="20" height="12" rx="6" />
    </svg>
  ),
  droplet: (
    <svg {...P}>
      <path d="M12 2.5C8 7 5 11 5 14a7 7 0 1 0 14 0c0-3-3-7-7-11.5z" />
    </svg>
  ),
  workflow: (
    <svg {...P}>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="9" y="15" width="6" height="6" rx="1" />
      <path d="M6 9v3a2 2 0 0 0 2 2h4M18 9v3a2 2 0 0 1-2 2h-4" />
    </svg>
  ),
  calendar: (
    <svg {...P}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  ),
  link: (
    <svg {...P}>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  ),
  'mouse-pointer': (
    <svg {...P}>
      <path d="M3 3l7 19 2-8 8-2z" />
      <line x1="13" y1="13" x2="20" y2="20" />
    </svg>
  ),
  'folder-eye': (
    <svg {...P}>
      <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="2" />
    </svg>
  ),
  bell: (
    <svg {...P}>
      <path d="M18 16V11a6 6 0 1 0-12 0v5l-2 3h16z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  ),
  pipeline: (
    <svg {...P}>
      <circle cx="5" cy="6" r="2" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="12" r="2" />
      <path d="M7 6h6a4 4 0 0 1 4 4v0M7 18h6a4 4 0 0 0 4-4v0" />
    </svg>
  ),
  bot: (
    <svg {...P}>
      <rect x="4" y="8" width="16" height="12" rx="3" />
      <line x1="12" y1="2" x2="12" y2="8" />
      <circle cx="9" cy="14" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
      <line x1="9" y1="18" x2="15" y2="18" />
    </svg>
  ),
  spider: (
    <svg {...P}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9V4M12 15v5M9 12H4M15 12h5M7 7l-3-3M17 7l3-3M7 17l-3 3M17 17l3 3" />
    </svg>
  ),
  'link-2': (
    <svg {...P}>
      <path d="M9 17H7a5 5 0 0 1 0-10h2" />
      <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  ),
  gauge: (
    <svg {...P}>
      <path d="M3 14a9 9 0 1 1 18 0" />
      <line x1="12" y1="14" x2="16" y2="9" />
      <circle cx="12" cy="14" r="1.5" fill="currentColor" />
    </svg>
  ),
  accessibility: (
    <svg {...P}>
      <circle cx="12" cy="4" r="2" />
      <path d="M5 8h14" />
      <path d="M9 8v4l-2 8M15 8v4l2 8" />
      <path d="M9 12h6" />
    </svg>
  ),
  'arrow-right-circle': (
    <svg {...P}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="11 8 15 12 11 16" />
      <line x1="8" y1="12" x2="15" y2="12" />
    </svg>
  ),
  cloud: (
    <svg {...P}>
      <path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.7 1.5A4 4 0 0 0 6 18z" />
    </svg>
  ),
  container: (
    <svg {...P}>
      <rect x="3" y="6" width="18" height="12" rx="1" />
      <line x1="8" y1="6" x2="8" y2="18" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <line x1="16" y1="6" x2="16" y2="18" />
    </svg>
  ),
  helm: (
    <svg {...P}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="3" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="21" />
      <line x1="3" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="21" y2="12" />
    </svg>
  ),
  key: (
    <svg {...P}>
      <circle cx="8" cy="15" r="4" />
      <line x1="11" y1="13" x2="21" y2="3" />
      <line x1="18" y1="6" x2="20" y2="8" />
      <line x1="15" y1="9" x2="17" y2="11" />
    </svg>
  ),
  'credit-card': (
    <svg {...P}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  ),
  activity: (
    <svg {...P}>
      <polyline points="3 12 7 12 10 4 14 20 17 12 21 12" />
    </svg>
  ),
  globe: (
    <svg {...P}>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </svg>
  ),
  asterisk: (
    <svg {...P}>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="5" y1="8" x2="19" y2="16" />
      <line x1="19" y1="8" x2="5" y2="16" />
    </svg>
  ),
  smartphone: (
    <svg {...P}>
      <rect x="6" y="2" width="12" height="20" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </svg>
  ),
  image: (
    <svg {...P}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  ),
  'trending-up': (
    <svg {...P}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  ),
  wand: (
    <svg {...P}>
      <line x1="3" y1="21" x2="15" y2="9" />
      <path d="M15 9l3-3 3 3-3 3z" />
      <path d="M19 5l1-2 1 2-1 1zM6 8l-1-2 2 1 0 1z" />
    </svg>
  ),
  flow: (
    <svg {...P}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3a9 9 0 0 1 8 13" />
      <path d="M12 21a9 9 0 0 1-8-13" />
      <circle cx="20" cy="6" r="1.5" fill="currentColor" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" />
    </svg>
  ),
};

// Explicit per-seed-agent icon assignments. Each agent gets a unique icon.
const SEED_AGENT_ICONS: Record<string, IconName> = {
  'agent-code-helper': 'code',
  'agent-researcher': 'search',
  'agent-writer': 'pencil',
  'agent-ops': 'terminal',
  'agent-data-analyst': 'chart-bar',
  'agent-doc-writer': 'book',
  'agent-test-writer': 'check-square',
  'agent-code-reviewer': 'eye',
  'agent-sql-helper': 'database',
  'agent-frontend': 'monitor',
  'agent-backend': 'server',
  'agent-bug-hunter': 'bug',
  'agent-planner': 'clipboard',
  'agent-git-helper': 'git-branch',
  'agent-security-auditor': 'shield',
  'agent-config-wizard': 'sliders',
  'agent-tutor': 'graduation-cap',
  'agent-brainstormer': 'lightbulb',
  'agent-prototype-builder': 'hammer',
  'agent-vibe-designer': 'palette',
  'agent-component-crafter': 'puzzle',
  'agent-demo-animator': 'play',
  'agent-mock-api': 'plug',
  'agent-copywriter': 'feather',
  'agent-landing-pro': 'layout',
  'agent-game-jammer': 'gamepad',
  'agent-sketch-to-code': 'pen-tool',
  'agent-theme-wizard': 'droplet',
  'agent-cli-crafter': 'terminal-2',
  'agent-workflow-architect': 'workflow',
  'agent-scheduler': 'calendar',
  'agent-webhook-wrangler': 'link',
  'agent-api-integrator': 'plug-zap',
  'agent-browser-automator': 'mouse-pointer',
  'agent-file-watcher': 'folder-eye',
  'agent-notifier': 'bell',
  'agent-pipeline-builder': 'pipeline',
  'agent-actions-architect': 'git-merge',
  'agent-bot-crafter': 'bot',
  'agent-scraper': 'spider',
  'agent-ai-chain-builder': 'link-2',
  'agent-perf-profiler': 'gauge',
  'agent-a11y-auditor': 'accessibility',
  'agent-migration-helper': 'arrow-right-circle',
  'agent-cloud-architect': 'cloud',
  'agent-docker-helper': 'container',
  'agent-kubernetes-wrangler': 'helm',
  'agent-auth-specialist': 'key',
  'agent-payment-integrator': 'credit-card',
  'agent-observability': 'activity',
  'agent-i18n-helper': 'globe',
  'agent-regex-wizard': 'asterisk',
  'agent-mobile-dev': 'smartphone',
  'agent-pdf-specialist': 'file-text',
  'agent-image-editor': 'image',
  'agent-seo-helper': 'trending-up',
};

interface KeywordRule {
  icon: IconName;
  keywords: readonly string[];
}

// Fallback for user-created agents (not in SEED_AGENT_ICONS).
// Order matters — first match wins. More specific terms before generic.
const RULES: readonly KeywordRule[] = [
  { icon: 'shield', keywords: ['security', 'auth', 'crypto', 'audit', 'pentest', 'vuln'] },
  { icon: 'bug', keywords: ['bug', 'debug', 'qa', 'test'] },
  { icon: 'database', keywords: ['db', 'sql', 'database', 'data', 'etl', 'warehouse'] },
  { icon: 'cloud', keywords: ['cloud', 'aws', 'gcp', 'azure'] },
  { icon: 'container', keywords: ['docker', 'container'] },
  { icon: 'helm', keywords: ['kubernetes', 'k8s'] },
  { icon: 'network', keywords: ['network', 'devops', 'infra'] },
  { icon: 'gauge', keywords: ['perf', 'performance', 'optimi', 'speed', 'profil'] },
  { icon: 'palette', keywords: ['design', 'ui', 'ux', 'css', 'tailwind', 'figma', 'visual'] },
  { icon: 'pencil', keywords: ['write', 'writer', 'copy', 'content', 'blog'] },
  { icon: 'book', keywords: ['docs', 'documentation', 'reference'] },
  { icon: 'beaker', keywords: ['research', 'science', 'experiment', 'lab', 'analy'] },
  { icon: 'compass', keywords: ['plan', 'strategy', 'roadmap', 'product', 'pm'] },
  { icon: 'message', keywords: ['chat', 'support', 'customer', 'reply', 'email', 'comm'] },
  { icon: 'gamepad', keywords: ['game', 'unity', 'unreal'] },
  { icon: 'cube', keywords: ['3d', 'render', 'model'] },
  { icon: 'workflow', keywords: ['automat', 'workflow', 'pipeline', 'orchestr'] },
  { icon: 'calendar', keywords: ['schedul', 'cron', 'timer'] },
  { icon: 'layers', keywords: ['architect', 'system', 'design-system', 'fullstack'] },
  { icon: 'sparkles', keywords: ['ai', 'ml', 'llm', 'agent', 'embed', 'rag', 'prompt'] },
  { icon: 'terminal', keywords: ['shell', 'cli', 'bash', 'sysadmin', 'ops'] },
  { icon: 'zap', keywords: ['quick', 'fast', 'helper', 'util', 'snippet'] },
  { icon: 'file-text', keywords: ['note', 'summar', 'transcrib', 'parse', 'extract', 'report', 'pdf'] },
  { icon: 'search', keywords: ['search', 'find', 'lookup', 'query', 'index'] },
  { icon: 'brain', keywords: ['reason', 'think', 'logic', 'tutor', 'teach', 'learn'] },
  { icon: 'image', keywords: ['image', 'photo', 'picture'] },
  { icon: 'globe', keywords: ['i18n', 'locale', 'translate', 'global'] },
  { icon: 'smartphone', keywords: ['mobile', 'ios', 'android'] },
  { icon: 'trending-up', keywords: ['seo', 'analytics', 'metric'] },
  { icon: 'key', keywords: ['key', 'token', 'secret'] },
  { icon: 'credit-card', keywords: ['payment', 'billing', 'invoice'] },
  { icon: 'activity', keywords: ['monitor', 'observ', 'log', 'metric'] },
  { icon: 'asterisk', keywords: ['regex', 'pattern'] },
  { icon: 'code', keywords: ['code', 'coder', 'dev', 'develop', 'program', 'engineer', 'refactor'] },
];

function pickIcon(agent: AgentDto): IconName | null {
  // 1. Explicit seed mapping wins
  const explicit = SEED_AGENT_ICONS[agent.id];
  if (explicit) return explicit;

  // 2. Fallback: keyword match against id + name + description + tags
  const haystack = (
    agent.id +
    ' ' +
    agent.name +
    ' ' +
    agent.description +
    ' ' +
    agent.specialtyTags.join(' ')
  ).toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (haystack.includes(kw)) return rule.icon;
    }
  }
  return null;
}

interface AgentAvatarProps {
  agent: AgentDto;
  size?: number;
  /** Kept for backwards compatibility — no longer renders a tile. */
  rounded?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Agent icon: bare SVG glyph, no background tile, colored using the agent's
 * avatarColor. Falls back to a colored initial letter if no icon matches.
 */
export function AgentAvatar({
  agent,
  size = 28,
  className = '',
}: AgentAvatarProps): JSX.Element {
  const icon = pickIcon(agent);
  const fontSize = Math.max(10, Math.round(size * 0.7));
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        color: agent.avatarColor,
      }}
      title={agent.name}
      aria-label={agent.name}
    >
      {icon ? (
        ICONS[icon]
      ) : (
        <span style={{ fontSize, fontWeight: 600, lineHeight: 1 }}>
          {agent.name.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
}
