// MascotWorld — population of pixel mascots that walk on top of the app
// chrome, ladder between surfaces, gather at workshops, and exit through
// doors when their agent stream ends.
// Ported from design/pixel-mascot.jsx (MascotWorld + Workshop + Door + Ladder).

import { useEffect, useRef, useState, type JSX } from 'react';
import type { AgentDto } from '@shared/chat-types';
import { PixelMascot, PX, type Pixel } from './PixelMascot';
import { useCustomizePrefs } from '../lib/CustomizeContext';

const PALETTE_TO_COLOR: Record<string, string | undefined> = {
  default: undefined,
  sage: '#b9c79c',
  amber: '#e0c378',
  plum: '#c5a4cc',
  cyan: '#a8d3d4',
};
import type { GroupName } from './wardrobe';

// ──────────────────────────────────────────────────────────────────────────
// Workshop pixel art
// ──────────────────────────────────────────────────────────────────────────

type WorkshopKind =
  | 'research'
  | 'programming'
  | 'design'
  | 'automation'
  | 'infrastructure'
  | 'terminal'
  | 'data'
  | 'workshop';

const WORKSHOP_PIXELS: Record<WorkshopKind, Pixel[]> = {
  research: (() => {
    const px: Pixel[] = [];
    for (let x = 4; x <= 17; x++) {
      px.push([x, 5, PX.o]);
      px.push([x, 19, PX.o]);
    }
    for (let y = 5; y <= 19; y++) {
      px.push([4, y, PX.o]);
      px.push([17, y, PX.o]);
    }
    for (let x = 5; x <= 16; x++) px.push([x, 12, PX.o]);
    const palette = [PX.b, PX.s, PX.b, PX.h, PX.s, PX.b];
    let bx = 5;
    while (bx <= 16) {
      for (let y = 6; y <= 11; y++) px.push([bx, y, PX.o]);
      if (bx + 1 <= 16) for (let y = 6; y <= 11; y++) px.push([bx + 1, y, palette[(bx * 3) % 6]!]);
      bx += 2;
    }
    bx = 5;
    while (bx <= 16) {
      for (let y = 13; y <= 18; y++) px.push([bx, y, PX.o]);
      if (bx + 1 <= 16) for (let y = 13; y <= 18; y++) px.push([bx + 1, y, palette[(bx * 5 + 1) % 6]!]);
      bx += 2;
    }
    for (let x = 4; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  programming: (() => {
    const px: Pixel[] = [];
    for (let x = 5; x <= 15; x++) {
      px.push([x, 4, PX.o]);
      px.push([x, 12, PX.o]);
    }
    for (let y = 4; y <= 12; y++) {
      px.push([5, y, PX.o]);
      px.push([15, y, PX.o]);
    }
    for (let y = 5; y <= 11; y++) for (let x = 6; x <= 14; x++) px.push([x, y, PX.s]);
    for (let i = 0; i < 6; i++) {
      const y = 6 + i;
      const len = 3 + ((i * 7) % 6);
      for (let x = 7; x <= 7 + len; x++) px.push([x, y, PX.b]);
    }
    px.push([13, 6, PX.h]);
    px.push([9, 13, PX.o]); px.push([10, 13, PX.o]); px.push([11, 13, PX.o]);
    px.push([9, 14, PX.o]); px.push([10, 14, PX.s]); px.push([11, 14, PX.o]);
    for (let x = 3; x <= 17; x++) px.push([x, 15, PX.o]);
    for (let x = 3; x <= 17; x++) px.push([x, 16, PX.s]);
    for (let x = 7; x <= 13; x++) px.push([x, 17, PX.o]);
    px.push([7, 18, PX.o]); px.push([13, 18, PX.o]);
    for (let x = 8; x <= 12; x++) px.push([x, 18, PX.s]);
    for (let x = 3; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  design: (() => {
    const px: Pixel[] = [];
    for (let x = 6; x <= 14; x++) {
      px.push([x, 3, PX.o]); px.push([x, 12, PX.o]);
    }
    for (let y = 3; y <= 12; y++) {
      px.push([6, y, PX.o]); px.push([14, y, PX.o]);
    }
    for (let y = 4; y <= 11; y++) for (let x = 7; x <= 13; x++) px.push([x, y, PX.b]);
    px.push([9, 6, PX.m]); px.push([10, 6, PX.m]);
    px.push([10, 7, PX.m]); px.push([11, 8, PX.m]);
    px.push([8, 9, PX.s]); px.push([9, 9, PX.s]); px.push([12, 9, PX.s]);
    px.push([7, 13, PX.o]); px.push([13, 13, PX.o]);
    px.push([6, 14, PX.o]); px.push([14, 14, PX.o]);
    px.push([5, 15, PX.o]); px.push([15, 15, PX.o]);
    px.push([10, 13, PX.o]); px.push([10, 14, PX.o]); px.push([10, 15, PX.o]);
    px.push([4, 16, PX.o]); px.push([10, 16, PX.o]); px.push([16, 16, PX.o]);
    for (let x = 4; x <= 16; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  automation: (() => {
    const px: Pixel[] = [];
    const gear = (cx: number, cy: number, r: number): void => {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const d2 = dx * dx + dy * dy;
          if (d2 <= r * r && d2 >= (r - 1) * (r - 1)) px.push([cx + dx, cy + dy, PX.o]);
        }
      }
      px.push([cx, cy - r - 1, PX.o]); px.push([cx, cy + r + 1, PX.o]);
      px.push([cx - r - 1, cy, PX.o]); px.push([cx + r + 1, cy, PX.o]);
      px.push([cx, cy, PX.o]);
      px.push([cx + 1, cy, PX.s]); px.push([cx - 1, cy, PX.s]);
      px.push([cx, cy + 1, PX.s]); px.push([cx, cy - 1, PX.s]);
    };
    gear(9, 10, 4);
    gear(15, 14, 3);
    for (let x = 3; x <= 17; x++) px.push([x, 19, PX.o]);
    for (let x = 3; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  infrastructure: (() => {
    const px: Pixel[] = [];
    for (let x = 5; x <= 16; x++) { px.push([x, 4, PX.o]); px.push([x, 19, PX.o]); }
    for (let y = 4; y <= 19; y++) { px.push([5, y, PX.o]); px.push([16, y, PX.o]); }
    const unit = (yTop: number): void => {
      for (let x = 6; x <= 15; x++) px.push([x, yTop, PX.o]);
      for (let y = yTop + 1; y < yTop + 4; y++) for (let x = 6; x <= 15; x++) px.push([x, y, PX.s]);
      px.push([7, yTop + 1, PX.h]); px.push([9, yTop + 1, PX.b]); px.push([11, yTop + 1, PX.h]);
      px.push([13, yTop + 1, PX.b]); px.push([14, yTop + 1, PX.h]);
      px.push([7, yTop + 2, PX.d]); px.push([8, yTop + 2, PX.d]); px.push([9, yTop + 2, PX.d]);
      px.push([11, yTop + 2, PX.d]); px.push([12, yTop + 2, PX.d]); px.push([13, yTop + 2, PX.d]);
    };
    unit(5); unit(10); unit(15);
    for (let x = 5; x <= 16; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  terminal: (() => {
    const px: Pixel[] = [];
    for (let x = 3; x <= 17; x++) { px.push([x, 4, PX.o]); px.push([x, 13, PX.o]); }
    for (let y = 4; y <= 13; y++) { px.push([3, y, PX.o]); px.push([17, y, PX.o]); }
    for (let y = 5; y <= 12; y++) for (let x = 4; x <= 16; x++) px.push([x, y, PX.d]);
    px.push([5, 6, PX.b]); px.push([6, 6, PX.b]);
    for (let x = 8; x <= 11; x++) px.push([x, 6, PX.b]);
    for (let x = 5; x <= 12; x++) px.push([x, 8, PX.h]);
    for (let x = 5; x <= 9; x++) px.push([x, 10, PX.b]);
    px.push([11, 10, PX.h]);
    px.push([9, 14, PX.o]); px.push([10, 14, PX.o]); px.push([11, 14, PX.o]);
    px.push([9, 15, PX.o]); px.push([10, 15, PX.s]); px.push([11, 15, PX.o]);
    for (let x = 4; x <= 16; x++) px.push([x, 16, PX.o]);
    for (let x = 4; x <= 16; x++) px.push([x, 17, PX.s]);
    for (let x = 3; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  data: (() => {
    const px: Pixel[] = [];
    for (let y = 4; y <= 16; y++) px.push([4, y, PX.o]);
    for (let x = 4; x <= 18; x++) px.push([x, 16, PX.o]);
    const bars = [
      { x: 6, h: 3 }, { x: 8, h: 5 }, { x: 10, h: 4 },
      { x: 12, h: 7 }, { x: 14, h: 6 }, { x: 16, h: 9 },
    ];
    bars.forEach((b) => {
      for (let y = 16 - b.h; y < 16; y++) {
        px.push([b.x, y, PX.o]);
        px.push([b.x + 1, y, y === 16 - b.h ? PX.b : PX.s]);
      }
    });
    px.push([3, 8, PX.d]); px.push([3, 12, PX.d]);
    px.push([16, 6, PX.h]);
    for (let x = 4; x <= 18; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  workshop: (() => {
    const px: Pixel[] = [];
    for (let x = 10; x <= 13; x++) px.push([x, 4, PX.o]);
    px.push([9, 5, PX.o]); px.push([14, 5, PX.o]);
    px.push([9, 6, PX.o]); px.push([14, 6, PX.o]);
    for (let x = 5; x <= 18; x++) { px.push([x, 7, PX.o]); px.push([x, 17, PX.o]); }
    for (let y = 7; y <= 17; y++) { px.push([5, y, PX.o]); px.push([18, y, PX.o]); }
    for (let y = 8; y <= 16; y++) for (let x = 6; x <= 17; x++) px.push([x, y, PX.s]);
    for (let x = 6; x <= 17; x++) px.push([x, 12, PX.o]);
    px.push([7, 11, PX.b]); px.push([10, 11, PX.b]); px.push([14, 11, PX.b]);
    for (let x = 5; x <= 18; x++) px.push([x, 20, PX.d]);
    return px;
  })(),
};

const WORKSHOP_LABELS: Record<WorkshopKind, string> = {
  research: 'Research',
  programming: 'Programming',
  design: 'Design',
  automation: 'Automation',
  infrastructure: 'Infrastructure',
  terminal: 'Ops',
  data: 'Data',
  workshop: 'Workshop',
};

function Workshop({
  kind, x, y, size = 64, label = true,
}: {
  kind: WorkshopKind;
  x: number;
  y: number;
  size?: number;
  label?: boolean;
}): JSX.Element {
  const pixels = WORKSHOP_PIXELS[kind] || [];
  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size,
        width: size,
        pointerEvents: 'none',
        zIndex: 33,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        style={{ imageRendering: 'pixelated', display: 'block' }}
      >
        {pixels.map((p, i) => (
          <rect key={i} x={p[0]} y={p[1]} width={1} height={1} fill={p[2]} />
        ))}
      </svg>
      {label && size >= 56 && (
        <div
          style={{
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 9,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ink-faint)',
            textAlign: 'center',
            marginTop: 2,
            whiteSpace: 'nowrap',
          }}
        >
          {WORKSHOP_LABELS[kind]}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Door + Ladder
// ──────────────────────────────────────────────────────────────────────────

/** Animated swing door: pixel-art frame stays put; an inner panel rotates
 *  on its left hinge between 0° (closed) and -85° (open). Interior pixels
 *  fade in while open so it reads as a real doorway. */
function Door({
  x, y, open = false, size = 56,
}: {
  x: number;
  y: number;
  open?: boolean;
  size?: number;
}): JSX.Element {
  // Frame outline (always)
  const frame: Pixel[] = [];
  for (let cx = 6; cx <= 17; cx++) {
    frame.push([cx, 4, PX.o]);
    frame.push([cx, 21, PX.o]);
  }
  for (let cy = 4; cy <= 21; cy++) {
    frame.push([6, cy, PX.o]);
    frame.push([17, cy, PX.o]);
  }
  // Interior dark + spark of light (only meaningful when door is open)
  const interior: Pixel[] = [];
  for (let cy = 5; cy <= 20; cy++) {
    for (let cx = 7; cx <= 16; cx++) interior.push([cx, cy, PX.d]);
  }
  interior.push([12, 12, PX.h]);
  interior.push([13, 12, PX.h]);
  // Panel + handle (the moving piece)
  const panel: Pixel[] = [];
  for (let cy = 5; cy <= 20; cy++) {
    for (let cx = 7; cx <= 16; cx++) panel.push([cx, cy, PX.s]);
  }
  for (let cy = 5; cy <= 20; cy++) panel.push([11, cy, PX.d]); // wood grain
  panel.push([14, 13, PX.o]);
  panel.push([14, 14, PX.o]);
  for (let cx = 7; cx <= 16; cx++) panel.push([cx, 5, PX.o]); // top trim

  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size,
        width: size,
        height: size,
        pointerEvents: 'none',
        zIndex: 34,
      }}
      aria-hidden
    >
      {/* Frame + interior layer */}
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        style={{ position: 'absolute', inset: 0, imageRendering: 'pixelated' }}
      >
        {frame.map((p, i) => (
          <rect key={`f-${i}`} x={p[0]} y={p[1]} width={1} height={1} fill={p[2]} />
        ))}
        <g
          style={{
            opacity: open ? 1 : 0,
            transition: 'opacity 360ms var(--ease)',
          }}
        >
          {interior.map((p, i) => (
            <rect key={`i-${i}`} x={p[0]} y={p[1]} width={1} height={1} fill={p[2]} />
          ))}
        </g>
      </svg>
      {/* Swinging panel — hinges on the left (x=7 in viewBox units = ~29%
          of the size) and rotates outward. */}
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        style={{
          position: 'absolute',
          inset: 0,
          imageRendering: 'pixelated',
          transformOrigin: '29% 50%',
          transform: open ? 'perspective(120px) rotateY(-78deg)' : 'rotateY(0deg)',
          transition: 'transform 360ms var(--ease)',
          willChange: 'transform',
        }}
      >
        {panel.map((p, i) => (
          <rect key={`p-${i}`} x={p[0]} y={p[1]} width={1} height={1} fill={p[2]} />
        ))}
      </svg>
    </div>
  );
}

function Ladder({ x, y1, y2, width = 16 }: { x: number; y1: number; y2: number; width?: number }): JSX.Element {
  const h = y2 - y1;
  const rungH = 16;
  const rungs: number[] = [];
  for (let y = 6; y < h; y += rungH) rungs.push(y);
  return (
    <svg
      style={{
        position: 'absolute',
        left: x - width / 2,
        top: y1,
        width,
        height: h,
        imageRendering: 'pixelated',
        pointerEvents: 'none',
        zIndex: 34,
      }}
      viewBox={`0 0 ${width} ${h}`}
      shapeRendering="crispEdges"
    >
      <rect x={2} y={0} width={2} height={h} fill={PX.o} />
      <rect x={width - 4} y={0} width={2} height={h} fill={PX.o} />
      <rect x={4} y={0} width={1} height={h} fill={PX.d} opacity={0.5} />
      <rect x={width - 5} y={0} width={1} height={h} fill={PX.d} opacity={0.5} />
      {rungs.map((y, i) => (
        <g key={i}>
          <rect x={4} y={y} width={width - 8} height={2} fill={PX.o} />
          <rect x={4} y={y + 2} width={width - 8} height={1} fill={PX.d} opacity={0.5} />
        </g>
      ))}
    </svg>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Group inference + world scripting
// ──────────────────────────────────────────────────────────────────────────

function inferGroup(agent: AgentDto | undefined): GroupName {
  if (!agent) return 'Default';
  const hay = (
    agent.id + ' ' + agent.name + ' ' + agent.description + ' ' + (agent.specialtyTags || []).join(' ')
  ).toLowerCase();
  if (/design|ui|ux|paint|image|theme|brand|visual|3d|blender|mesh|model|sculpt/.test(hay)) return 'Design';
  if (/research|tutor|teach|writer|doc|copy|brainstorm/.test(hay)) return 'Knowledge';
  if (/shell|cli|terminal|ops|sysadmin|observabil|security/.test(hay)) return 'Ops';
  if (/automat|webhook|workflow|scheduler|pipeline|bot|scrap/.test(hay)) return 'Automation';
  if (/docker|kuberne|cloud|backend|sql|database|mobile|infra/.test(hay)) return 'Stack';
  if (/data|analy|chart|metric|plan|prototype|mock/.test(hay)) return 'Build';
  if (/code|coder|dev|engineer|program|refactor|review|test|qa|bug|regex|git/.test(hay)) return 'Code';
  return 'Other';
}

interface Surface {
  y: number;
  x1: number;
  x2: number;
}
interface LadderRef {
  x: number;
  y1: number;
  y2: number;
}
interface WorkshopRef {
  kind: WorkshopKind;
  group: GroupName;
  x: number;
  y: number;
}
interface Anchors {
  filesBtn?: { x: number; y: number };
}
interface WorldState {
  surfaces: Record<string, Surface>;
  ladders: Record<string, LadderRef>;
  anchors: Anchors;
  workshops: WorkshopRef[];
}

type Action =
  | { type: 'walkTo'; x: number; surface?: string }
  | { type: 'climb'; ladder: string; dir: 'up' | 'down'; toSurface: string }
  | { type: 'task'; task: string; ms: number }
  | { type: 'wait'; ms: number }
  | { type: 'pickUp'; icon: string }
  | { type: 'drop' }
  | { type: 'face'; dir: 1 | -1 };

interface Mascot {
  id: string;
  agent: string | null;
  group: GroupName;
  x: number;
  y: number;
  surface: string | null;
  facing: 1 | -1;
  carrying: string | null;
  scriptIdx: number;
  actionStart: number;
  spriteTask: string;
  script: Action[];
}

function measureWorld(winEl: HTMLElement | null, screen: string): WorldState {
  if (!winEl) return { surfaces: {}, ladders: {}, anchors: {}, workshops: [] };
  const winR = winEl.getBoundingClientRect();
  const get = (sel: string): null | { x: number; y: number; w: number; h: number; right: number; bottom: number; cx: number } => {
    const el = winEl.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left - winR.left,
      y: r.top - winR.top,
      w: r.width,
      h: r.height,
      right: r.right - winR.left,
      bottom: r.bottom - winR.top,
      cx: (r.left + r.right) / 2 - winR.left,
    };
  };
  const surfaces: Record<string, Surface> = {};
  const ladders: Record<string, LadderRef> = {};
  const anchors: Anchors = {};
  const workshops: WorkshopRef[] = [];

  const mainEl = get('.main') || get('main');
  const mainBottom = mainEl ? mainEl.bottom : winR.height;
  const mainLeft = mainEl ? mainEl.x : 296;
  const mainRight = mainEl ? mainEl.right : winR.width;

  surfaces.floor = { y: mainBottom - 8, x1: mainLeft + 24, x2: mainRight - 24 };

  const groupForKind: Record<WorkshopKind, GroupName> = {
    research: 'Knowledge',
    programming: 'Code',
    design: 'Design',
    automation: 'Automation',
    infrastructure: 'Stack',
    terminal: 'Ops',
    data: 'Build',
    workshop: 'Other',
  };

  const placeWorkshops = (kinds: WorkshopKind[], yOverride?: number): void => {
    const usable = mainRight - 24 - (mainLeft + 24);
    const slots = kinds.length;
    const y = yOverride !== undefined ? yOverride : surfaces.floor!.y;
    kinds.forEach((kind, i) => {
      const cx = mainLeft + 24 + (i + 0.5) * (usable / slots);
      workshops.push({ kind, group: groupForKind[kind], x: cx, y });
    });
  };

  if (screen === 'chat') {
    const composer = get('.composer-chat');
    const header = get('.chat-header');
    const buttons = winEl.querySelectorAll('.chat-header button');
    let filesBtn: HTMLElement | null = null;
    buttons.forEach((b) => {
      if (/Files/i.test(b.textContent || '')) filesBtn = b as HTMLElement;
    });
    if (composer) {
      surfaces['composer-top'] = { y: composer.y, x1: composer.x + 12, x2: composer.right - 12 };
      placeWorkshops(['programming', 'research', 'design', 'automation'], composer.y);
    }
    if (header) {
      surfaces['header-bottom'] = { y: header.bottom, x1: header.x + 16, x2: header.right - 16 };
    }
    if (composer && header) {
      // Park the ladder in the gap between the right-most workstation and
      // the door, with breathing room from both. Door sits at floor.x2 -
      // DOOR_INSET on the right; workstation right edge ≈ lastWs.x + size/2.
      const rightLimit = Math.min(composer.right, header.right);
      const doorX = rightLimit - DOOR_INSET;
      const lastWs = workshops[workshops.length - 1];
      const lastWsRight = lastWs ? lastWs.x + WORKSHOP_SIZE / 2 : composer.right - 240;
      // Midpoint, then clamp so the ladder never collides with the door
      // or the workshop (at least 30px clearance on each side).
      const mid = (lastWsRight + doorX) / 2;
      const lx = Math.max(lastWsRight + 30, Math.min(doorX - 30, mid));
      ladders.main = {
        x: lx,
        y1: surfaces['header-bottom']!.y,
        y2: surfaces['composer-top']!.y,
      };
    }
    if (filesBtn) {
      const r = (filesBtn as HTMLElement).getBoundingClientRect();
      anchors.filesBtn = { x: (r.left + r.right) / 2 - winR.left, y: r.top - winR.top };
    }
  }
  if (screen === 'dashboard') {
    const composer = get('.composer');
    if (composer) {
      surfaces['dash-composer-top'] = { y: composer.y, x1: composer.x + 16, x2: composer.right - 16 };
      placeWorkshops(['programming', 'research', 'design', 'automation'], composer.y);
    }
  }
  if (screen === 'models') {
    const recco = get('.recco-grid');
    if (recco) surfaces['recco-top'] = { y: recco.y, x1: recco.x + 16, x2: recco.right - 16 };
    placeWorkshops(['programming', 'automation']);
  }
  if (screen === 'connectors') {
    const grid = get('.cnx-grid');
    if (grid) surfaces['cnx-top'] = { y: grid.y, x1: grid.x + 16, x2: grid.right - 16 };
    placeWorkshops(['automation', 'programming']);
  }
  if (screen === 'brain') {
    placeWorkshops(['research']);
  }
  if (screen === 'settings') {
    placeWorkshops(['automation']);
  }

  return { surfaces, ladders, anchors, workshops };
}

function makeScene(
  screen: string,
  surfaces: Record<string, Surface>,
  ladders: Record<string, LadderRef>,
  anchors: Anchors,
  workshops: WorkshopRef[],
  agents: AgentDto[],
  taskCardRects: { x: number; y: number; w: number; h: number }[],
): Mascot[] {
  const now = performance.now();
  const make = (m: Partial<Mascot> & Pick<Mascot, 'id' | 'x' | 'y' | 'script'>): Mascot => ({
    facing: 1,
    carrying: null,
    scriptIdx: 0,
    actionStart: now,
    spriteTask: 'idle',
    agent: null,
    group: 'Default',
    surface: null,
    ...m,
  });

  if (taskCardRects.length > 0) {
    return taskCardRects.map((r, i) => {
      const agent = agents[i];
      const group = agent ? inferGroup(agent) : 'Code';
      const task = ['typing', 'wrenching', 'checking', 'writing'][i] || 'thinking';
      return make({
        id: `task-${i}`,
        agent: agent?.name ?? null,
        group,
        x: r.x + r.w / 2,
        y: r.y,
        script: [
          { type: 'task', task, ms: 4000 + i * 500 },
          { type: 'task', task: 'thinking', ms: 1200 },
        ],
      });
    });
  }

  // Helper: resolve a real-app agent name by group (prefer named match,
  // fall back to first agent in the group, then any agent).
  const pickByGroup = (group: GroupName, preferred?: string): string | null => {
    if (preferred) {
      const direct = agents.find((a) => a.name.toLowerCase() === preferred.toLowerCase());
      if (direct) return direct.name;
    }
    const m = agents.find((a) => inferGroup(a) === group);
    return m?.name ?? agents[0]?.name ?? preferred ?? null;
  };

  // Helper: build workshop mascots that loop between two positions on a
  // given surface near each workshop center. Surface defaults to the floor
  // strip, but on the chat screen we run them along the composer-top edge
  // so they walk on the chatbar instead of dropping to the bottom.
  const workshopMascots = (surfaceName = 'floor'): Mascot[] => {
    const surface = surfaces[surfaceName];
    if (!surface || workshops.length === 0) return [];
    const taskFor: Record<GroupName, string> = {
      Knowledge: 'reading',
      Code: 'typing',
      Stack: 'wrenching',
      Design: 'painting',
      Automation: 'wrenching',
      Ops: 'searching',
      Build: 'checking',
      Other: 'checking',
      Default: 'thinking',
    };
    return workshops.map((w, i) => {
      // Wider patrol arc so movement is unmistakable. Each mascot strays up
      // to ~140px from its workshop, then comes back, mixing in a task.
      const home = Math.max(surface.x1 + 16, Math.min(surface.x2 - 16, w.x + 24));
      const far = Math.max(surface.x1 + 16, Math.min(surface.x2 - 16, w.x + 160));
      return make({
        id: `ws-${w.kind}-${i}`,
        agent: pickByGroup(w.group),
        group: w.group,
        x: home,
        y: surface.y,
        surface: surfaceName,
        facing: -1,
        script: [
          { type: 'task', task: taskFor[w.group] || 'thinking', ms: 2200 + i * 400 },
          { type: 'face', dir: 1 },
          { type: 'walkTo', x: far, surface: surfaceName },
          { type: 'task', task: 'thinking', ms: 900 },
          { type: 'walkTo', x: home - 24, surface: surfaceName },
          { type: 'task', task: taskFor[w.group] || 'thinking', ms: 1500 },
          { type: 'walkTo', x: home, surface: surfaceName },
          { type: 'face', dir: -1 },
        ],
      });
    });
  };

  if (screen === 'chat' && surfaces['composer-top'] && surfaces['header-bottom'] && ladders.main) {
    const cs = surfaces['composer-top'];
    const hs = surfaces['header-bottom'];
    const L = ladders.main;
    const filesX = anchors.filesBtn?.x ?? hs.x1 + 200;

    const specific: Mascot[] = [
      make({
        id: 'rsch',
        agent: pickByGroup('Knowledge', 'Researcher'),
        group: 'Knowledge',
        x: cs.x1 + 80,
        y: cs.y,
        surface: 'composer-top',
        script: [
          { type: 'task', task: 'thinking', ms: 1200 },
          { type: 'walkTo', x: L.x, surface: 'composer-top' },
          { type: 'face', dir: 1 },
          { type: 'climb', ladder: 'main', dir: 'up', toSurface: 'header-bottom' },
          { type: 'walkTo', x: filesX, surface: 'header-bottom' },
          { type: 'task', task: 'searching', ms: 1500 },
          { type: 'pickUp', icon: 'file' },
          { type: 'wait', ms: 500 },
          { type: 'walkTo', x: L.x, surface: 'header-bottom' },
          { type: 'climb', ladder: 'main', dir: 'down', toSurface: 'composer-top' },
          { type: 'walkTo', x: cs.x1 + 200, surface: 'composer-top' },
          { type: 'task', task: 'reading', ms: 3500 },
          { type: 'drop' },
          { type: 'wait', ms: 800 },
        ],
      }),
      make({
        id: 'arch',
        agent: pickByGroup('Stack', 'Backend Architect'),
        group: 'Stack',
        x: cs.x1 + 280,
        y: cs.y,
        surface: 'composer-top',
        script: [
          { type: 'walkTo', x: cs.x2 - 280, surface: 'composer-top' },
          { type: 'task', task: 'thinking', ms: 1500 },
          { type: 'walkTo', x: cs.x1 + 400, surface: 'composer-top' },
          { type: 'task', task: 'typing', ms: 3500 },
        ],
      }),
      make({
        id: 'writ',
        agent: pickByGroup('Knowledge', 'Doc Writer'),
        group: 'Knowledge',
        x: hs.x1 + 60,
        y: hs.y,
        surface: 'header-bottom',
        script: [
          { type: 'task', task: 'writing', ms: 5000 },
          { type: 'walkTo', x: hs.x1 + 120, surface: 'header-bottom' },
          { type: 'task', task: 'writing', ms: 5000 },
          { type: 'walkTo', x: hs.x1 + 60, surface: 'header-bottom' },
        ],
      }),
    ];
    // Combine the ladder-scene specifics with the workshop mascots on the
    // composer-top surface so the chat screen shows the full population the
    // design implies (header walkers + composer-bar specialists at their
    // workshops). Walking on the chatbar is the intended look — workshops
    // sit above the composer and their mascots stride along its top edge.
    return [...specific, ...workshopMascots('composer-top')];
  }

  if (workshops.length > 0 && surfaces.floor) {
    return workshopMascots();
  }

  if (surfaces.floor) {
    const f = surfaces.floor;
    return [
      make({
        id: 'writ',
        agent: pickByGroup('Knowledge', 'Doc Writer'),
        group: 'Knowledge',
        x: f.x1 + 60,
        y: f.y,
        surface: 'floor',
        script: [
          { type: 'task', task: 'writing', ms: 1800 },
          { type: 'walkTo', x: f.x1 + 220, surface: 'floor' },
          { type: 'task', task: 'reading', ms: 1500 },
          { type: 'walkTo', x: f.x1 + 60, surface: 'floor' },
          { type: 'face', dir: -1 },
        ],
      }),
      make({
        id: 'arch',
        agent: pickByGroup('Stack', 'Backend Architect'),
        group: 'Stack',
        x: f.x1 + 280,
        y: f.y,
        surface: 'floor',
        script: [
          { type: 'walkTo', x: f.x2 - 240, surface: 'floor' },
          { type: 'task', task: 'thinking', ms: 1400 },
          { type: 'walkTo', x: f.x1 + 280, surface: 'floor' },
          { type: 'task', task: 'wrenching', ms: 1600 },
        ],
      }),
      make({
        id: 'rsch',
        agent: pickByGroup('Knowledge', 'Researcher'),
        group: 'Knowledge',
        x: f.x2 - 120,
        y: f.y,
        surface: 'floor',
        script: [
          { type: 'task', task: 'searching', ms: 1800 },
          { type: 'walkTo', x: f.x2 - 280, surface: 'floor' },
          { type: 'task', task: 'reading', ms: 1500 },
          { type: 'walkTo', x: f.x2 - 120, surface: 'floor' },
        ],
      }),
    ];
  }
  return [];
}

function stepMascot(
  m: Mascot,
  dt: number,
  surfaces: Record<string, Surface>,
  ladders: Record<string, LadderRef>,
  speed: number,
): Mascot {
  const action = m.script[m.scriptIdx];
  if (!action) return m;
  switch (action.type) {
    case 'walkTo': {
      const s = surfaces[action.surface || m.surface || ''];
      if (!s) return m;
      const target = Math.max(s.x1, Math.min(s.x2, action.x));
      const dx = target - m.x;
      const targetY = s.y;
      if (Math.abs(dx) < 1.5) {
        return {
          ...m,
          x: target,
          y: targetY,
          surface: action.surface || m.surface,
          scriptIdx: (m.scriptIdx + 1) % m.script.length,
          actionStart: performance.now(),
          spriteTask: 'idle',
        };
      }
      const step = speed * dt;
      const nx = m.x + Math.sign(dx) * Math.min(step, Math.abs(dx));
      return {
        ...m,
        x: nx,
        y: targetY,
        facing: dx > 0 ? 1 : -1,
        spriteTask: 'walking',
        surface: action.surface || m.surface,
      };
    }
    case 'climb': {
      const L = ladders[action.ladder];
      if (!L) return m;
      const goingUp = action.dir === 'up';
      const targetY = goingUp ? L.y1 : L.y2;
      const dy = targetY - m.y;
      if (Math.abs(dy) < 1.5) {
        return {
          ...m,
          x: L.x,
          y: targetY,
          surface: action.toSurface,
          scriptIdx: (m.scriptIdx + 1) % m.script.length,
          actionStart: performance.now(),
          spriteTask: 'idle',
        };
      }
      const step = speed * dt * 0.6;
      return {
        ...m,
        x: L.x,
        y: m.y + Math.sign(dy) * Math.min(step, Math.abs(dy)),
        facing: 1,
        spriteTask: 'climbing',
      };
    }
    case 'task': {
      const elapsed = performance.now() - m.actionStart;
      if (elapsed >= action.ms) {
        return {
          ...m,
          scriptIdx: (m.scriptIdx + 1) % m.script.length,
          actionStart: performance.now(),
          spriteTask: 'idle',
        };
      }
      return { ...m, spriteTask: action.task };
    }
    case 'wait': {
      const elapsed = performance.now() - m.actionStart;
      if (elapsed >= action.ms) {
        return { ...m, scriptIdx: (m.scriptIdx + 1) % m.script.length, actionStart: performance.now() };
      }
      return m;
    }
    case 'pickUp':
      return {
        ...m,
        carrying: action.icon,
        scriptIdx: (m.scriptIdx + 1) % m.script.length,
        actionStart: performance.now(),
      };
    case 'drop':
      return {
        ...m,
        carrying: null,
        scriptIdx: (m.scriptIdx + 1) % m.script.length,
        actionStart: performance.now(),
      };
    case 'face':
      return {
        ...m,
        facing: action.dir,
        scriptIdx: (m.scriptIdx + 1) % m.script.length,
        actionStart: performance.now(),
      };
    default:
      return m;
  }
}

// Smaller sprite + workshop dims to match the design at real app scale.
// (Design ran inside a 760px-tall embed; full-screen app needs ~60% scale.)
const SPRITE_W = 36;
const WORKSHOP_SIZE = 40;
const FEET_OFFSET = Math.round((17 / 24) * SPRITE_W);

// ──────────────────────────────────────────────────────────────────────────
// Main exports
// ──────────────────────────────────────────────────────────────────────────

interface Props {
  agents: AgentDto[];
  /** Override screen detection (chat / dashboard / models / connectors / brain / settings). */
  screen?: string;
  /** Task-card rects in app-window coordinates for team-run modal scene. */
  taskCardRects?: { x: number; y: number; w: number; h: number }[];
  /** Agent IDs that currently have an active stream. Each one spawns a
   *  mascot that walks in from the right-wall door; when the ID disappears
   *  the mascot exits back through the door. */
  liveAgentIds?: string[];
  /** Disable mascots (reduced motion etc). */
  disabled?: boolean;
}

// Distance from right wall where the door sits + how far in mascots stop.
const DOOR_INSET = 18;
const ENTRY_INSET = 110;

function detectScreen(): string {
  if (typeof document === 'undefined') return 'dashboard';
  if (document.querySelector('.composer-chat')) return 'chat';
  if (document.querySelector('.models-page')) return 'models';
  if (document.querySelector('.cnx-grid')) return 'connectors';
  if (document.querySelector('.settings-page')) return 'settings';
  if (document.querySelector('.composer')) return 'dashboard';
  return 'dashboard';
}

export function MascotLayer({
  agents,
  screen,
  taskCardRects = [],
  liveAgentIds = [],
  disabled = false,
}: Props): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [world, setWorld] = useState<WorldState>({ surfaces: {}, ladders: {}, anchors: {}, workshops: [] });
  const [mascots, setMascots] = useState<Mascot[]>([]);
  // Per-agent "deployed" mascots that enter from the door + exit when their
  // agent is no longer streaming. Keyed by agentId.
  const [liveMascots, setLiveMascots] = useState<Map<string, Mascot & { phase: 'entering' | 'working' | 'exiting' }>>(
    new Map(),
  );
  const [detectedScreen, setDetectedScreen] = useState<string>('dashboard');
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [popMascotId, setPopMascotId] = useState<string | null>(null);
  const [confettiFor, setConfettiFor] = useState<string | null>(null);
  const prefs = useCustomizePrefs();
  const bodyColor = PALETTE_TO_COLOR[prefs.mascotPalette];
  // Walk speed in px/s, user-overridable from the Customize drawer.
  const speed = prefs.mascotSpeed || 55;
  const maxCount = 14;

  // Global cursor tracker so mascots can eye-follow the pointer.
  useEffect(() => {
    if (disabled) return;
    const onMove = (e: MouseEvent): void => setCursor({ x: e.clientX, y: e.clientY });
    const onLeave = (): void => setCursor(null);
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, [disabled]);

  // Confetti burst when an agent's stream ends — detect a drop in
  // liveAgentIds compared to the previous render.
  const prevLiveRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = new Set(prevLiveRef.current);
    const dropped = [...prev].find((id) => !liveAgentIds.includes(id));
    prevLiveRef.current = liveAgentIds.slice();
    if (!dropped) return;
    setConfettiFor(`live-${dropped}`);
    const t = setTimeout(() => setConfettiFor(null), 1500);
    return () => clearTimeout(t);
  }, [liveAgentIds.join(',')]);

  const liveKey = liveAgentIds.slice().sort().join(',');
  // Stable content key for taskCardRects. The prop defaults to a fresh `[]`
  // every render, so depending on the array reference makes the scene-rebuild
  // effect below run every render (→ setMascots → re-render → loop). Key on
  // content instead so the effect only re-runs when the rects actually change.
  const taskCardRectsKey = JSON.stringify(taskCardRects);

  // Detect screen + measure DOM after mount + on resize + on layout-shift
  // events (chat surface flexing when a View panel opens, sidebar
  // toggling, drawer opening, etc.). ResizeObserver covers any case
  // where an observed element's bounding rect changes without a
  // window resize firing.
  useEffect(() => {
    if (disabled) return;
    let frame = 0;
    const measure = (): void => {
      // Batch into next rAF so 5+ overlapping ResizeObserver callbacks
      // collapse into a single measure pass per tick.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const win = containerRef.current?.parentElement as HTMLElement | null;
        const sc = screen ?? detectScreen();
        setDetectedScreen(sc);
        setWorld(measureWorld(win, taskCardRects.length > 0 ? 'team' : sc));
      });
    };
    measure();
    const id1 = setTimeout(measure, 60);
    const id2 = setTimeout(measure, 240);
    const id3 = setTimeout(measure, 600);
    const onR = (): void => measure();
    window.addEventListener('resize', onR);

    // Watch the chat-surface anchors so the scene re-measures whenever
    // their bounding rects shift (e.g. View panel slides in/out, sidebar
    // collapse, Files browser toggle). Falls back gracefully if the
    // browser doesn't implement ResizeObserver.
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== 'undefined') {
      const watchSelectors = ['.composer-chat', '.chat-header', '.main', '.composer', '.cnx-grid', '.recco-grid'];
      for (const sel of watchSelectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const ro = new ResizeObserver(() => measure());
        ro.observe(el);
        observers.push(ro);
      }
      // Also remeasure when the main area itself (parent of MascotLayer)
      // changes — catches popout window + multi-column reflows.
      const parent = containerRef.current?.parentElement;
      if (parent) {
        const ro = new ResizeObserver(() => measure());
        ro.observe(parent);
        observers.push(ro);
      }
    }

    return () => {
      clearTimeout(id1);
      clearTimeout(id2);
      clearTimeout(id3);
      window.removeEventListener('resize', onR);
      observers.forEach((o) => o.disconnect());
      if (frame) cancelAnimationFrame(frame);
    };
  }, [screen, taskCardRects.length, disabled]);

  // Rebuild scene whenever world / agents change
  useEffect(() => {
    if (disabled) {
      setMascots([]);
      return;
    }
    const scene = makeScene(
      detectedScreen,
      world.surfaces,
      world.ladders,
      world.anchors,
      world.workshops,
      agents,
      taskCardRects,
    );
    setMascots(scene.slice(0, maxCount));
    // taskCardRectsKey (stable content hash) stands in for taskCardRects so this
    // effect doesn't re-run every render on the default `[]` prop reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, agents, detectedScreen, taskCardRectsKey, disabled]);

  // Pick the surface that hosts the door + live mascots. On the chat screen
  // the door sits on the chatbox (composer-top edge); elsewhere it stays on
  // the floor strip near the bottom of the main area.
  const stageSurface =
    (detectedScreen === 'chat' && world.surfaces['composer-top']) || world.surfaces.floor || null;
  const stageName = stageSurface === world.surfaces['composer-top'] ? 'composer-top' : 'floor';

  // Reconcile liveMascots whenever the live agent set changes or the world
  // remeasures. Spawn entrants at the door; mark removed agents as exiting.
  // If the stage surface itself changed (e.g. dashboard floor → chat
  // composer-top), relocate any existing mascots to the new surface so they
  // don't get stranded on a stale y coordinate.
  useEffect(() => {
    if (disabled) return;
    if (!stageSurface) return;
    const stage = stageSurface;
    const doorX = stage.x2 - DOOR_INSET;
    const entryX = Math.max(stage.x1 + 40, stage.x2 - ENTRY_INSET);
    const liveSet = new Set(liveAgentIds);

    setLiveMascots((prev) => {
      const next = new Map(prev);

      // Relocate stale mascots whose surface no longer matches the stage.
      for (const [id, m] of next) {
        if (m.surface !== stageName) {
          next.set(id, {
            ...m,
            x: entryX,
            y: stage.y,
            surface: stageName,
            scriptIdx: 0,
            actionStart: performance.now(),
            spriteTask: 'idle',
            script: m.script.map((a) =>
              a.type === 'walkTo' ? { ...a, surface: stageName } : a,
            ),
          });
        }
      }

      // Spawn entrants for newly streaming agents not already mid-exit.
      for (const id of liveSet) {
        const existing = next.get(id);
        if (existing && existing.phase !== 'exiting') continue;
        const agent = agents.find((a) => a.id === id);
        if (!agent) continue;
        const group = inferGroup(agent);
        const task =
          group === 'Knowledge' ? 'reading'
          : group === 'Code' ? 'typing'
          : group === 'Design' ? 'painting'
          : group === 'Build' ? 'checking'
          : group === 'Ops' ? 'searching'
          : group === 'Stack' ? 'wrenching'
          : group === 'Automation' ? 'wrenching'
          : 'thinking';
        next.set(id, {
          id: `live-${id}`,
          agent: agent.name,
          group,
          x: doorX,
          y: stage.y,
          surface: stageName,
          facing: -1,
          carrying: null,
          scriptIdx: 0,
          actionStart: performance.now(),
          spriteTask: 'walking',
          phase: 'entering',
          script: [
            { type: 'walkTo', x: entryX, surface: stageName },
            { type: 'face', dir: -1 },
            { type: 'task', task, ms: 9_999_999 }, // hold until exiting
          ],
        });
      }

      // Mark agents no longer streaming as exiting (one-shot script: walk
      // to door, then we delete them when they arrive).
      for (const [id, m] of next) {
        if (liveSet.has(id) || m.phase === 'exiting') continue;
        next.set(id, {
          ...m,
          phase: 'exiting',
          scriptIdx: 0,
          actionStart: performance.now(),
          spriteTask: 'walking',
          facing: 1,
          script: [
            { type: 'face', dir: 1 },
            { type: 'walkTo', x: doorX, surface: stageName },
          ],
        });
      }
      return next;
    });
  }, [liveKey, agents, stageSurface?.y, stageSurface?.x2, stageName, disabled]);

  // Tick (~30fps) — advances both scripted scene mascots and live mascots,
  // and despawns live mascots that have finished their exit walk at the door.
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    let last = performance.now();
    const tick = (): void => {
      if (!alive) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setMascots((prev) => prev.map((m) => stepMascot(m, dt, world.surfaces, world.ladders, speed)));
      setLiveMascots((prev) => {
        const stage = stageSurface;
        if (!stage) return prev;
        const doorX = stage.x2 - DOOR_INSET;
        const next = new Map(prev);
        for (const [id, m] of next) {
          const stepped = stepMascot(m, dt, world.surfaces, world.ladders, speed);
          // If exiting and arrived near the door, remove.
          if (m.phase === 'exiting' && Math.abs(stepped.x - doorX) < 4) {
            next.delete(id);
            continue;
          }
          // Promote 'entering' -> 'working' once first walkTo finishes.
          const phase: 'entering' | 'working' | 'exiting' =
            m.phase === 'entering' && stepped.spriteTask !== 'walking' ? 'working' : m.phase;
          next.set(id, { ...stepped, phase });
        }
        return next;
      });
    };
    let id: ReturnType<typeof setInterval> | null = setInterval(tick, 33);
    const onVis = (): void => {
      if (document.visibilityState === 'visible') {
        if (!id) id = setInterval(tick, 33);
      } else {
        if (id) { clearInterval(id); id = null; }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      if (id) clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [world, disabled, stageSurface, detectedScreen]);

  if (disabled) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 35,
        overflow: 'hidden',
      }}
      aria-hidden
    >
      {/* Workshops + ladder scenery on chat (and team-run). Pixel-art
          decoration tied to the surface, not to live agents. */}
      {(detectedScreen === 'chat' || taskCardRects.length > 0)
        ? world.workshops.map((w, i) => (
            <Workshop key={`ws-${w.kind}-${i}`} kind={w.kind} x={w.x} y={w.y} size={WORKSHOP_SIZE} />
          ))
        : null}
      {(detectedScreen === 'chat' || taskCardRects.length > 0)
        ? Object.entries(world.ladders).map(([id, L]) => (
            <Ladder key={id} x={L.x} y1={L.y1} y2={L.y2} />
          ))
        : null}
      {stageSurface ? (
        <Door
          x={stageSurface.x2 - DOOR_INSET}
          y={stageSurface.y + 4}
          size={40}
          open={[...liveMascots.values()].some(
            (m) =>
              m.phase === 'entering' ||
              m.phase === 'exiting' ||
              Math.abs(m.x - (stageSurface.x2 - DOOR_INSET)) < 40,
          )}
        />
      ) : null}
      {[...liveMascots.values()].map((m) => {
        const isPopping = popMascotId === m.id;
        const visibleTask = isPopping ? 'celebrating' : (m.spriteTask || 'idle');
        const fps =
          visibleTask === 'walking' ? 10
          : visibleTask === 'climbing' ? 8
          : visibleTask === 'celebrating' ? 12
          : 6;
        const sx = m.x - SPRITE_W / 2;
        const sy = m.y - FEET_OFFSET;
        // Eye look behaviour:
        //   - If walking → look forward (matches facing, which is already
        //     applied via CSS scaleX flip, so +2 in sprite-local coords
        //     reads as "the way I'm going").
        //   - Else, if cursor is nearby → follow the cursor.
        //   - Else, fall back to the task-driven default.
        let look: number | undefined;
        if (visibleTask === 'walking') {
          look = 2;
        } else if (cursor) {
          const dx = cursor.x - m.x;
          const dy = cursor.y - m.y;
          if (Math.hypot(dx, dy) < 320) {
            // Map cursor x into sprite-local space — flip when the sprite
            // is mirrored so "look toward cursor" still works on both
            // facings.
            const local = (cursor.x - m.x) * (m.facing === -1 ? -1 : 1);
            look = Math.max(-2, Math.min(2, Math.round(local / 30)));
          }
        }
        const emote = emoteFor(visibleTask);
        return (
          <div
            key={m.id}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              transform: `translate(${sx}px, ${sy}px)`,
              width: SPRITE_W,
              height: SPRITE_W,
              pointerEvents: 'auto',
              cursor: 'pointer',
              opacity: m.phase === 'exiting' ? 0.85 : 1,
              transition: 'opacity 200ms var(--ease)',
              // Live mascots sit above workshops + door so they never hide
              // behind their own workstation.
              zIndex: 40,
            }}
            title={`${m.agent ?? m.group} · ${m.spriteTask} · ${m.phase} (click to wave)`}
            onClick={(e) => {
              e.stopPropagation();
              setPopMascotId(m.id);
              setTimeout(() => setPopMascotId((cur) => (cur === m.id ? null : cur)), 900);
            }}
          >
            {emote ? (
              <div
                style={{
                  position: 'absolute',
                  top: -10,
                  left: SPRITE_W / 2 - 5,
                  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
                  fontSize: 13,
                  color: 'var(--accent)',
                  pointerEvents: 'none',
                  textShadow: '0 1px 0 rgba(0,0,0,0.6)',
                }}
              >
                {emote}
              </div>
            ) : null}
            <PixelMascot
              task={visibleTask}
              group={m.group}
              agent={m.agent}
              facing={m.facing || 1}
              carrying={m.carrying}
              size={SPRITE_W}
              fps={fps}
              {...(look !== undefined ? { lookOverride: look } : {})}
              {...(bodyColor ? { bodyColor } : {})}
            />
            {confettiFor === m.id ? <ConfettiBurst /> : null}
          </div>
        );
      })}
      {/* Team-run task-card mascots: only when explicit task rects are
          supplied (TeamRunModal hands them in). No other ambient mascots
          are rendered — only live, currently-streaming agents appear. */}
      {taskCardRects.length > 0
        ? mascots.map((m) => {
            const fps =
              m.spriteTask === 'walking' ? 10
              : m.spriteTask === 'climbing' ? 8
              : m.spriteTask === 'celebrating' ? 12
              : 6;
            const sx = m.x - SPRITE_W / 2;
            const sy = m.y - FEET_OFFSET;
            // Same eye logic as live mascots: forward when walking,
            // cursor-track when idle.
            let look: number | undefined;
            if (m.spriteTask === 'walking') {
              look = 2;
            } else if (cursor) {
              const dx = cursor.x - m.x;
              const dy = cursor.y - m.y;
              if (Math.hypot(dx, dy) < 320) {
                const local = (cursor.x - m.x) * (m.facing === -1 ? -1 : 1);
                look = Math.max(-2, Math.min(2, Math.round(local / 30)));
              }
            }
            return (
              <div
                key={m.id}
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  transform: `translate(${sx}px, ${sy}px)`,
                  width: SPRITE_W,
                  height: SPRITE_W,
                  pointerEvents: 'none',
                }}
                title={`${m.group} · ${m.spriteTask}`}
              >
                <PixelMascot
                  task={m.spriteTask || 'idle'}
                  group={m.group}
                  agent={m.agent}
                  facing={m.facing}
                  carrying={m.carrying}
                  size={SPRITE_W}
                  fps={fps}
                  {...(look !== undefined ? { lookOverride: look } : {})}
                  {...(bodyColor ? { bodyColor } : {})}
                />
              </div>
            );
          })
        : null}
    </div>
  );
}

/** Single-character emote rendered just above the mascot during specific
 *  task states. Picked for readability at pixel scale — no emoji. */
function emoteFor(task: string): string | null {
  switch (task) {
    case 'thinking':
      return '?';
    case 'searching':
      return '?';
    case 'writing':
      return '~';
    case 'reading':
      return '"';
    case 'wrenching':
      return '*';
    case 'painting':
      return '*';
    case 'celebrating':
      return '!';
    default:
      return null;
  }
}

/** Lightweight pixel-art confetti burst — 8 tinted squares that fall +
 *  fade. CSS-only animation so no per-frame work. */
function ConfettiBurst(): JSX.Element {
  const cols = ['var(--accent)', 'var(--accent-warm)', 'var(--good)', '#d6a786'];
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: SPRITE_W / 2,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
      }}
    >
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const dist = 22 + (i % 3) * 6;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist - 6;
        return (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 3,
              height: 3,
              background: cols[i % cols.length],
              transform: `translate(${tx}px, ${ty}px)`,
              opacity: 0,
              animation: `mascot-confetti 900ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
              animationDelay: `${i * 18}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
