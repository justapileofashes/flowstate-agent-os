// PixelMascot v2 — 24x24 pixel creature with outfit, prop, and task animation.
// Ported from design/pixel-mascot.jsx. Pure props (no window globals).

import { useEffect, useState, type JSX } from 'react';
import { AGENT_PROPS, CATEGORY_PRESETS, vibeFor, type GroupName } from './wardrobe';

export const PX = {
  o: '#0e0d0c',
  b: '#e8e3d5',
  s: '#c8c2b3',
  h: '#f0ece2',
  m: '#a08278',
  d: '#5c574f',
  g: '#8b8377',
} as const;

export type Pixel = [number, number, string];
export type PixelLayer = Pixel[] | null | undefined;

export function composePx(...layers: PixelLayer[]): { x: number; y: number; c: string }[] {
  const map = new Map<string, { x: number; y: number; c: string }>();
  for (const layer of layers) {
    if (!layer) continue;
    for (const [x, y, c] of layer) {
      if (x < 0 || y < 0 || x >= 24 || y >= 24) continue;
      map.set(`${x},${y}`, { x, y, c });
    }
  }
  return [...map.values()];
}

interface CreatureOpts {
  blink?: boolean;
  look?: number;
  expression?: 'happy' | 'o';
  bob?: number;
  frame?: number;
  walking?: boolean;
  walkPhase?: number;
  carrying?: string | null;
  sleeping?: boolean;
  squashV?: number;
  squashH?: number;
}

export function drawCreature(opts: CreatureOpts = {}): Pixel[] {
  const {
    blink = false,
    look = 0,
    expression = 'happy',
    bob = 0,
    frame = 0,
    walking = false,
    walkPhase = 0,
    sleeping = false,
    squashV = 0,
    squashH = 0,
  } = opts;
  const px: Pixel[] = [];
  const oy = (y: number): number => y + bob;

  const bodyTop = 5 + squashV;
  const bodyBot = 13 - squashV;
  const bodyLeft = 7 - squashH;
  const bodyRight = 16 + squashH;

  for (let x = bodyLeft; x <= bodyRight; x++) px.push([x, oy(bodyTop), PX.o]);
  for (let y = bodyTop; y <= bodyBot; y++) {
    px.push([bodyLeft, oy(y), PX.o]);
    px.push([bodyRight, oy(y), PX.o]);
  }
  for (let x = bodyLeft; x <= bodyRight; x++) px.push([x, oy(bodyBot), PX.o]);

  for (let y = bodyTop + 1; y <= bodyBot - 1; y++) {
    for (let x = bodyLeft + 1; x <= bodyRight - 1; x++) {
      px.push([x, oy(y), PX.b]);
    }
  }
  for (let y = bodyTop + 1; y <= bodyBot - 1; y++) {
    px.push([bodyRight - 1, oy(y), PX.s]);
  }

  // Eyes
  const eyeY = look === 2 ? 7 : 8;
  const lx0 = 9 + (look < 0 ? -1 : 0);
  const rx0 = 13 + (look > 0 ? 1 : 0);

  if (blink || sleeping) {
    px.push([lx0, oy(eyeY + 1), PX.o]);
    px.push([lx0 + 1, oy(eyeY + 1), PX.o]);
    px.push([rx0, oy(eyeY + 1), PX.o]);
    px.push([rx0 + 1, oy(eyeY + 1), PX.o]);
  } else if (expression === 'happy' && !walking && frame % 60 > 50) {
    px.push([lx0, oy(eyeY + 1), PX.o]);
    px.push([lx0 + 1, oy(eyeY + 1), PX.o]);
    px.push([rx0, oy(eyeY + 1), PX.o]);
    px.push([rx0 + 1, oy(eyeY + 1), PX.o]);
  } else {
    px.push([lx0, oy(eyeY), PX.o]);
    px.push([lx0 + 1, oy(eyeY), PX.o]);
    px.push([lx0, oy(eyeY + 1), PX.o]);
    px.push([lx0 + 1, oy(eyeY + 1), PX.o]);
    px.push([rx0, oy(eyeY), PX.o]);
    px.push([rx0 + 1, oy(eyeY), PX.o]);
    px.push([rx0, oy(eyeY + 1), PX.o]);
    px.push([rx0 + 1, oy(eyeY + 1), PX.o]);
  }

  if (expression === 'o') {
    px.push([11, oy(10), PX.o]);
    px.push([12, oy(10), PX.o]);
    px.push([11, oy(11), PX.o]);
    px.push([12, oy(11), PX.o]);
  }

  // Legs. Idle: four stationary 3-px legs. Walking: Claw'd-style trot.
  // Diagonal pair swing (FL+BR vs FR+BL). A swung leg simply renders one
  // row shorter (foot tucked up off the ground) — no shadow, no startY
  // shifts. Planted legs stay rooted; the body bob in buildSprite does
  // the bouncing.
  const baseLegX = [8, 10, 13, 15] as const;
  const baseY = oy(bodyBot + 1);
  if (!walking) {
    for (const lx of baseLegX) {
      for (let s = 0; s < 3; s++) px.push([lx, baseY + s, PX.s]);
    }
  } else {
    const phase = walkPhase % 4;
    baseLegX.forEach((lx, i) => {
      const pairA = i === 0 || i === 3;
      // Phase 0: pair A swings (foot up). Phase 2: pair B swings.
      // Phases 1 + 3: both planted (passing pose).
      const lifted = (phase === 0 && pairA) || (phase === 2 && !pairA);
      const legHeight = lifted ? 2 : 3;
      for (let s = 0; s < legHeight; s++) {
        px.push([lx, baseY + s, PX.s]);
      }
    });
  }

  return px;
}

export const PROP_ICONS: Record<string, [number, number][]> = {
  // isometric cube — top rhombus + two side faces
  cube: [[20, 6], [19, 7], [21, 7], [18, 8], [20, 8], [22, 8], [18, 9], [20, 9], [22, 9], [19, 10], [20, 10], [21, 10]],
  cursor: [[20, 8], [20, 9], [20, 10]],
  magnifier: [[19, 7], [20, 7], [18, 8], [20, 8], [19, 9], [20, 9], [21, 10], [22, 11]],
  bug: [[19, 7], [20, 7], [18, 8], [21, 8], [19, 9], [20, 9], [18, 10], [21, 10]],
  check: [[18, 9], [19, 10], [20, 9], [21, 8]],
  branch: [[19, 7], [18, 8], [19, 8], [20, 8], [19, 9], [20, 9], [20, 10]],
  braces: [[19, 7], [18, 8], [18, 9], [19, 10], [21, 7], [22, 8], [22, 9], [21, 10]],
  stack: [[18, 8], [19, 8], [20, 8], [21, 8], [18, 10], [19, 10], [20, 10], [21, 10]],
  speedo: [[19, 8], [20, 8], [18, 9], [21, 9], [19, 10], [20, 10], [20, 11]],
  brush: [[21, 7], [20, 8], [19, 9], [18, 10], [19, 10], [20, 10]],
  blueprint: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 9], [21, 9],
    [18, 11], [19, 11], [20, 11], [21, 11],
  ],
  cylinder: [
    [18, 7], [19, 7], [20, 7],
    [18, 8], [20, 8],
    [18, 9], [19, 9], [20, 9],
    [18, 10], [20, 10],
  ],
  phone: [
    [19, 6], [20, 6], [19, 7], [20, 7], [19, 8], [20, 8],
    [19, 9], [20, 9], [19, 10], [20, 10], [19, 11], [20, 11],
  ],
  key: [[19, 7], [18, 8], [20, 8], [19, 9], [19, 10], [20, 10], [19, 11]],
  cloud: [[19, 7], [18, 8], [19, 8], [20, 8], [21, 8], [20, 9]],
  container: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [21, 8],
    [18, 9], [19, 9], [20, 9], [21, 9],
  ],
  wheel: [[19, 7], [18, 8], [20, 8], [19, 9], [20, 10]],
  papers: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [21, 8],
    [18, 9], [19, 9], [20, 9], [21, 9],
    [18, 10], [20, 10],
  ],
  pointer: [[21, 7], [20, 8], [21, 8], [19, 9], [20, 9], [18, 10], [19, 10]],
  thoughts: [[20, 6], [19, 7], [20, 7], [21, 7], [18, 9], [20, 9]],
  typewriter: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [19, 8], [20, 8], [21, 8],
    [18, 9], [20, 9],
  ],
  doc: [
    [19, 6], [20, 6], [19, 7], [20, 7], [19, 8], [20, 8],
    [19, 9], [20, 9], [19, 10], [20, 10],
  ],
  speech: [[19, 7], [20, 7], [21, 7], [19, 8], [20, 8], [21, 8], [19, 9], [18, 10]],
  prism: [[20, 7], [19, 8], [20, 8], [21, 8], [18, 9], [19, 9], [20, 9], [21, 9], [22, 9]],
  puzzle: [
    [20, 7], [19, 8], [20, 8], [21, 8],
    [18, 9], [19, 9], [20, 9], [21, 9], [22, 9], [20, 10],
  ],
  play: [[19, 7], [19, 8], [20, 8], [19, 9], [20, 9], [21, 9], [19, 10]],
  pencil: [[21, 7], [20, 8], [19, 9], [18, 10]],
  palette: [[19, 7], [20, 7], [18, 8], [19, 8], [20, 8], [21, 8], [19, 9], [20, 9]],
  frame: [
    [18, 7], [19, 7], [20, 7], [21, 7], [22, 7],
    [18, 8], [22, 8],
    [18, 9], [22, 9],
    [18, 10], [19, 10], [20, 10], [21, 10], [22, 10],
  ],
  photo: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [19, 8], [21, 8],
    [18, 9], [19, 9], [20, 9], [21, 9],
  ],
  conveyor: [[18, 8], [19, 8], [20, 8], [21, 8], [22, 8], [19, 9], [21, 9]],
  clock: [[19, 7], [18, 8], [19, 8], [20, 8], [19, 9]],
  bolt: [[20, 6], [19, 7], [20, 7], [19, 8], [20, 8], [18, 9], [19, 9], [20, 9]],
  pipe: [[19, 7], [20, 7], [19, 8], [20, 8], [19, 9], [20, 9], [19, 10], [20, 10]],
  browser: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [19, 8], [20, 8], [21, 8],
    [18, 9], [21, 9],
    [18, 10], [21, 10],
    [18, 11], [19, 11], [20, 11], [21, 11],
  ],
  fileWatch: [
    [18, 7], [19, 7], [20, 7],
    [18, 8], [20, 8],
    [18, 9], [19, 9], [20, 9],
    [22, 10],
  ],
  bell: [[19, 7], [18, 8], [19, 8], [20, 8], [21, 8], [19, 9], [20, 9], [20, 10]],
  pipeline: [[18, 8], [19, 8], [20, 8], [21, 8], [22, 8], [19, 7], [21, 9]],
  ci: [[18, 7], [19, 7], [20, 8], [21, 8], [19, 9], [20, 10], [21, 10]],
  bot: [
    [19, 7], [20, 7],
    [18, 8], [19, 8], [20, 8], [21, 8],
    [19, 9], [20, 9],
    [18, 10], [21, 10],
  ],
  net: [[18, 7], [20, 7], [22, 7], [19, 8], [21, 8], [18, 9], [20, 9], [22, 9]],
  chain: [[19, 7], [20, 7], [19, 8], [20, 9], [20, 10], [19, 10]],
  dashboard: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [19, 8], [20, 8], [21, 8],
    [18, 9], [20, 9],
  ],
  terminal: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [19, 8],
    [18, 9],
    [18, 10], [19, 10], [20, 10], [21, 10],
  ],
  toggle: [
    [18, 8], [19, 8], [20, 8], [21, 8], [22, 8],
    [18, 9], [19, 9], [20, 9], [21, 9], [22, 9],
  ],
  radar: [[20, 7], [19, 8], [20, 8], [21, 8], [18, 9], [20, 9], [22, 9]],
  shield: [
    [19, 6], [20, 6],
    [18, 7], [21, 7],
    [18, 8], [21, 8],
    [18, 9], [21, 9],
    [19, 10], [20, 10],
  ],
  chart: [[20, 9], [20, 10], [21, 8], [21, 9], [21, 10], [19, 10], [18, 10]],
  timeline: [[18, 9], [19, 9], [20, 9], [21, 9], [22, 9], [18, 8], [20, 7], [22, 8]],
  proto: [
    [18, 7], [19, 7], [20, 7], [21, 7],
    [18, 8], [19, 8], [20, 8], [21, 8],
    [19, 9], [20, 9], [19, 10], [20, 10],
  ],
  mock: [
    [18, 7], [19, 7], [20, 7],
    [18, 9], [20, 9],
    [18, 10], [19, 10], [20, 10],
  ],
  controller: [
    [18, 8], [19, 8], [20, 8], [21, 8], [22, 8],
    [18, 9], [22, 9], [19, 9], [21, 9],
  ],
  coin: [[19, 7], [20, 7], [18, 8], [21, 8], [18, 9], [21, 9], [19, 10], [20, 10]],
  eye: [[19, 7], [20, 7], [18, 8], [19, 8], [20, 8], [21, 8], [19, 9], [20, 9]],
  magnet: [[18, 7], [20, 7], [18, 8], [20, 8], [18, 9], [20, 9], [18, 10], [20, 10]],
  globe: [
    [19, 7], [20, 7],
    [18, 8], [19, 8], [20, 8], [21, 8],
    [18, 9], [19, 9], [20, 9], [21, 9],
    [19, 10], [20, 10],
  ],
};

export function drawAgentProp(agentName: string | null | undefined, frame = 0): Pixel[] {
  if (!agentName) return [];
  const propName = AGENT_PROPS[agentName];
  if (!propName) return [];
  const icon = PROP_ICONS[propName];
  if (!icon) return [];
  const bounce = frame % 8 < 4 ? 0 : -1;
  return icon.map(([x, y]) => [x, y + bounce, PX.b] as Pixel);
}

export function drawArm(side: 'right' | 'left' = 'right', pose: 'side' | 'forward' | 'up' = 'side', bob = 0): Pixel[] {
  const px: Pixel[] = [];
  if (pose === 'forward') {
    if (side === 'right') {
      px.push([17, 10 + bob, PX.o]);
      px.push([17, 11 + bob, PX.o]);
    } else {
      px.push([6, 10 + bob, PX.o]);
      px.push([6, 11 + bob, PX.o]);
    }
  } else if (pose === 'up') {
    if (side === 'right') {
      px.push([15, 2 + bob, PX.o]);
    } else {
      px.push([8, 2 + bob, PX.o]);
    }
  }
  return px;
}

export const OUTFITS: Record<GroupName, { hat: Pixel[] }> = {
  Code: {
    hat: [
      [11, 1, PX.o], [12, 1, PX.o],
      [10, 2, PX.o], [11, 2, PX.d], [12, 2, PX.d], [13, 2, PX.o],
      [9, 3, PX.o], [10, 3, PX.d], [11, 3, PX.d], [12, 3, PX.d], [13, 3, PX.d], [14, 3, PX.o],
      [8, 4, PX.o], [9, 4, PX.d], [14, 4, PX.d], [15, 4, PX.o],
    ],
  },
  Stack: {
    hat: [
      [10, 2, PX.o], [11, 2, PX.o], [12, 2, PX.o], [13, 2, PX.o],
      [8, 3, PX.o], [9, 3, PX.o], [14, 3, PX.o], [15, 3, PX.o],
      [8, 4, PX.d], [9, 4, PX.d], [14, 4, PX.d], [15, 4, PX.d],
    ],
  },
  Knowledge: {
    hat: [
      [7, 1, PX.o], [8, 1, PX.o], [9, 1, PX.o], [10, 1, PX.o], [11, 1, PX.o],
      [12, 1, PX.o], [13, 1, PX.o], [14, 1, PX.o], [15, 1, PX.o], [16, 1, PX.o],
      [10, 2, PX.o], [11, 2, PX.d], [12, 2, PX.d], [13, 2, PX.o],
      [10, 3, PX.o], [13, 3, PX.o],
      [17, 2, PX.b], [17, 3, PX.b], [17, 4, PX.b],
    ],
  },
  Design: {
    hat: [
      [13, 1, PX.o],
      [9, 2, PX.o], [10, 2, PX.m], [11, 2, PX.m], [12, 2, PX.m], [13, 2, PX.m], [14, 2, PX.o],
      [10, 3, PX.m], [11, 3, PX.m], [12, 3, PX.m], [13, 3, PX.m],
      [11, 4, PX.o], [12, 4, PX.o],
    ],
  },
  Automation: {
    hat: [
      [11, 0, PX.b], [12, 0, PX.o],
      [11, 1, PX.o],
      [11, 2, PX.o], [12, 2, PX.o],
      [10, 3, PX.o], [11, 3, PX.d], [12, 3, PX.d], [13, 3, PX.o],
      [10, 4, PX.o], [11, 4, PX.d], [12, 4, PX.d], [13, 4, PX.o],
    ],
  },
  Ops: {
    hat: [
      [10, 1, PX.o], [11, 1, PX.o], [12, 1, PX.o], [13, 1, PX.o],
      [9, 2, PX.o], [10, 2, PX.d], [11, 2, PX.d], [12, 2, PX.d], [13, 2, PX.d], [14, 2, PX.o],
      [8, 3, PX.o], [9, 3, PX.d], [10, 3, PX.d], [11, 3, PX.d], [12, 3, PX.d], [13, 3, PX.d], [14, 3, PX.d], [15, 3, PX.o],
      [8, 4, PX.o], [15, 4, PX.o],
    ],
  },
  Build: {
    hat: [
      [10, 2, PX.o], [11, 2, PX.o], [12, 2, PX.o], [13, 2, PX.o],
      [9, 3, PX.o], [10, 3, PX.b], [11, 3, PX.b], [12, 3, PX.b], [13, 3, PX.b], [14, 3, PX.o],
      [9, 4, PX.o], [10, 4, PX.b], [11, 4, PX.b], [12, 4, PX.b], [13, 4, PX.b], [14, 4, PX.b], [15, 4, PX.b], [16, 4, PX.o],
    ],
  },
  Other: {
    hat: [
      [11, 1, PX.d], [12, 1, PX.d],
      [10, 2, PX.o], [11, 2, PX.b], [12, 2, PX.b], [13, 2, PX.o],
      [9, 3, PX.o], [10, 3, PX.b], [11, 3, PX.b], [12, 3, PX.b], [13, 3, PX.b], [14, 3, PX.o],
      [8, 4, PX.o], [9, 4, PX.o], [10, 4, PX.o], [11, 4, PX.o],
      [12, 4, PX.o], [13, 4, PX.o], [14, 4, PX.o], [15, 4, PX.o],
    ],
  },
  Default: { hat: [] },
};

export const CARRY_ICONS: Record<string, Pixel[]> = {
  file: [
    [10, 0, PX.o], [11, 0, PX.o], [12, 0, PX.o], [13, 0, PX.o],
    [10, 1, PX.o], [11, 1, PX.b], [12, 1, PX.b], [13, 1, PX.o],
    [10, 2, PX.o], [11, 2, PX.b], [12, 2, PX.b], [13, 2, PX.o],
    [10, 3, PX.o], [11, 3, PX.o], [12, 3, PX.o], [13, 3, PX.o],
    [12, 1, PX.o],
  ],
  scroll: [
    [10, 0, PX.o], [11, 0, PX.o], [12, 0, PX.o], [13, 0, PX.o],
    [10, 1, PX.o], [11, 1, PX.b], [12, 1, PX.b], [13, 1, PX.o],
    [10, 2, PX.o], [11, 2, PX.d], [12, 2, PX.d], [13, 2, PX.o],
    [10, 3, PX.o], [11, 3, PX.b], [12, 3, PX.b], [13, 3, PX.o],
    [10, 4, PX.o], [11, 4, PX.o], [12, 4, PX.o], [13, 4, PX.o],
  ],
  cog: [
    [11, 0, PX.o], [12, 0, PX.o],
    [10, 1, PX.o], [11, 1, PX.b], [12, 1, PX.b], [13, 1, PX.o],
    [10, 2, PX.o], [11, 2, PX.b], [12, 2, PX.b], [13, 2, PX.o],
    [11, 3, PX.o], [12, 3, PX.o],
  ],
};

export function drawProp(task: string, frame = 0): Pixel[] {
  switch (task) {
    case 'typing':
      return [
        [8, 13, PX.o], [9, 13, PX.o], [10, 13, PX.o], [11, 13, PX.o], [12, 13, PX.o], [13, 13, PX.o], [14, 13, PX.o], [15, 13, PX.o], [16, 13, PX.o],
        [8, 12, PX.o], [16, 12, PX.o],
        [8, 11, PX.o], [16, 11, PX.o],
        [8, 10, PX.o], [9, 10, PX.o], [10, 10, PX.o], [11, 10, PX.o], [12, 10, PX.o], [13, 10, PX.o], [14, 10, PX.o], [15, 10, PX.o], [16, 10, PX.o],
        [9, 11, frame % 2 === 0 ? PX.b : PX.d],
        [10, 11, PX.b], [11, 11, PX.b], [12, 11, PX.b],
        [9, 12, PX.s], [10, 12, PX.s],
        [13, 12, PX.b], [14, 12, PX.b], [15, 12, PX.b],
      ];
    case 'reading':
      return [
        [7, 12, PX.o], [8, 12, PX.o], [9, 12, PX.o], [10, 12, PX.o], [11, 12, PX.o], [12, 12, PX.o],
        [7, 13, PX.o], [8, 13, PX.b], [9, 13, PX.b], [10, 13, PX.o], [11, 13, PX.b], [12, 13, PX.b],
        [7, 14, PX.o], [8, 14, PX.b], [9, 14, PX.d], [10, 14, PX.o], [11, 14, PX.d], [12, 14, PX.b],
        [7, 15, PX.o], [8, 15, PX.b], [9, 15, PX.d], [10, 15, PX.o], [11, 15, PX.d], [12, 15, PX.b],
        [7, 16, PX.o], [8, 16, PX.o], [9, 16, PX.o], [10, 16, PX.o], [11, 16, PX.o], [12, 16, PX.o],
      ];
    case 'writing':
      return ([
        [16, 11, PX.o], [16, 14, PX.o],
        [17, 11, PX.b], [17, 12, PX.b], [17, 13, PX.b], [17, 14, PX.b],
        [18, 11, PX.s], [18, 12, PX.s], [18, 13, PX.s], [18, 14, PX.s],
        [19, 11, PX.o], [19, 14, PX.o],
        [16, 9, PX.o], [17, 8, PX.o], [18, 7, PX.b], [19, 6, PX.b], [20, 5, PX.h],
        frame % 2 === 0 ? [16, 10, PX.d] : [17, 10, PX.d],
      ] as Pixel[]).filter(Boolean);
    case 'searching': {
      const sweep = frame % 4;
      const cx = 17 + (sweep === 1 ? 1 : sweep === 3 ? -1 : 0);
      const cy = 12 + (sweep === 2 ? 1 : sweep === 0 ? -1 : 0);
      return [
        [cx, cy - 1, PX.o], [cx - 1, cy, PX.o], [cx + 1, cy, PX.o], [cx, cy + 1, PX.o],
        [cx + 1, cy + 1, PX.d], [cx + 2, cy + 2, PX.d],
      ];
    }
    case 'clipboard':
    case 'checking':
      return [
        [16, 11, PX.o], [17, 11, PX.o], [18, 11, PX.o],
        [16, 12, PX.o], [17, 12, PX.b], [18, 12, PX.o],
        [16, 13, PX.o], [17, 13, frame % 3 === 0 ? PX.d : PX.b], [18, 13, PX.o],
        [16, 14, PX.o], [17, 14, PX.b], [18, 14, PX.o],
        [16, 15, PX.o], [17, 15, PX.o], [18, 15, PX.o],
      ];
    case 'painting':
      return [
        [16, 11, PX.o], [17, 11, PX.o], [18, 11, PX.o], [19, 11, PX.o],
        [16, 12, PX.o], [17, 12, PX.b], [18, 12, PX.b], [19, 12, PX.o],
        [16, 13, PX.o], [17, 13, frame % 2 === 0 ? PX.m : PX.b], [18, 13, PX.b], [19, 13, PX.o],
        [16, 14, PX.o], [17, 14, PX.b], [18, 14, PX.b], [19, 14, PX.o],
        [16, 15, PX.o], [17, 15, PX.o], [18, 15, PX.o], [19, 15, PX.o],
        [15, 10, PX.o], [16, 10, PX.m],
      ];
    case 'wrench':
    case 'wrenching':
      return [
        [16, 11, PX.d], [17, 11, PX.d],
        [16, 12, PX.o], [17, 12, PX.d],
        [17, 13, PX.d],
        [18, 14, PX.d],
      ];
    case 'thinking':
      return frame % 2 === 0
        ? [[16, 4, PX.o], [16, 5, PX.o], [17, 5, PX.o], [18, 5, PX.o], [18, 6, PX.o], [17, 7, PX.o], [17, 9, PX.o]]
        : [[17, 5, PX.o], [17, 6, PX.o], [17, 7, PX.o], [17, 9, PX.o]];
    case 'spark':
      if (frame % 3 === 0) return [];
      return [[11, 0, PX.o], [10, 1, PX.o], [12, 1, PX.o], [11, 1, PX.b], [11, 2, PX.o]];
    case 'celebrate':
    case 'celebrating': {
      const r = frame * 3;
      return [
        [(r % 6) + 5, 1, PX.b],
        [((r * 2) % 8) + 13, 2, PX.s],
        [((r * 3) % 10) + 3, 0, PX.h],
      ];
    }
    default:
      return [];
  }
}

interface BuildOpts {
  task?: string;
  facing?: 1 | -1;
  walkPhase?: number;
  blink?: boolean;
  group?: GroupName;
  agent?: string | null;
  frame?: number;
  carrying?: string | null;
  hideHat?: boolean;
  lookOverride?: number;
}

export function buildSprite(opts: BuildOpts): { pixels: { x: number; y: number; c: string }[]; facing: 1 | -1 } {
  const {
    task = 'idle',
    facing = 1,
    walkPhase = 0,
    blink = false,
    group = 'Default',
    frame = 0,
    carrying = null,
    hideHat = false,
    lookOverride,
  } = opts;
  let walking = false;
  let bob = 0;
  let blinkOn = blink;
  let look = 0;
  let expression: 'happy' | 'o' = 'happy';
  let sleeping = false;
  let squashV = 0;
  let squashH = 0;

  switch (task) {
    case 'walking': {
      walking = true;
      // Claw'd-style bounce: body lifts on swing phases, settles on plant.
      // No horizontal squash — kept the silhouette stable while the legs
      // do the real motion.
      const p = walkPhase % 4;
      bob = p === 0 || p === 2 ? -1 : 0;
      break;
    }
    case 'climbing':
      bob = walkPhase % 2 === 0 ? 0 : -1;
      break;
    case 'typing':
      bob = frame % 4 < 2 ? 0 : -1;
      break;
    case 'reading':
    case 'writing':
    case 'searching':
    case 'checking':
    case 'painting':
    case 'wrenching':
      bob = frame % 6 < 3 ? 0 : -1;
      break;
    case 'thinking':
      look = frame % 24 < 12 ? 2 : 0;
      bob = frame % 24 < 12 ? -1 : 0;
      break;
    case 'celebrating':
      bob = frame % 2 === 0 ? -1 : -3;
      squashH = frame % 2 === 0 ? 1 : 0;
      squashV = frame % 2 === 0 ? 0 : -1;
      expression = 'o';
      break;
    case 'sleeping':
      blinkOn = true;
      sleeping = true;
      bob = frame % 16 < 8 ? 0 : -1;
      break;
    case 'exiting':
      walking = true;
      bob = walkPhase % 2 === 0 ? 0 : -1;
      break;
    default: {
      const p = frame % 24;
      bob = p > 4 && p < 12 ? -1 : 0;
      squashH = p > 8 && p < 11 ? 1 : 0;
      if (p > 18) look = frame % 96 < 48 ? -1 : 1;
      break;
    }
  }

  const creaturePixels = drawCreature({
    blink: blinkOn,
    look: lookOverride !== undefined ? lookOverride : look,
    expression,
    bob,
    frame,
    walking,
    walkPhase,
    carrying,
    sleeping,
    squashV,
    squashH,
  });

  let armOverlay: Pixel[] | null = null;
  if (!carrying && ['wrenching', 'painting', 'writing', 'reading', 'searching', 'checking'].includes(task)) {
    armOverlay = drawArm('right', 'forward', bob);
  } else if (carrying) {
    armOverlay = drawArm('right', 'up', bob);
  }

  const outfit = OUTFITS[group] || OUTFITS.Default;
  const hat = carrying || hideHat ? [] : outfit.hat || [];
  const shiftHat: Pixel[] = bob === 0 ? hat : hat.map(([x, y, c]) => [x, y + bob, c] as Pixel);

  const carryLayer = carrying && CARRY_ICONS[carrying] ? CARRY_ICONS[carrying] : null;

  const pixels = composePx(
    creaturePixels,
    armOverlay,
    shiftHat,
    carrying || task === 'climbing' ? null : drawProp(task, frame),
    carryLayer,
  );

  return { pixels, facing };
}

interface PixelMascotProps {
  task?: string;
  group?: GroupName;
  agent?: string | null;
  facing?: 1 | -1;
  size?: number;
  fps?: number;
  carrying?: string | null;
  /** Eye-look direction relative to the sprite center: -2..+2. */
  lookOverride?: number;
  /** Color override for the body fill (PX.b). Used by the user's
   *  palette pref in the Customize drawer. */
  bodyColor?: string;
}

export function PixelMascot({
  task = 'idle',
  group = 'Default',
  agent = null,
  facing = 1,
  size = 56,
  fps = 8,
  carrying = null,
  lookOverride,
  bodyColor,
}: PixelMascotProps): JSX.Element {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (task === 'sleeping') return;
    // Honour OS reduced-motion + pause when tab is hidden to save CPU.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dataReduced =
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-reduce-motion') === 'true';
    if (reduced || dataReduced) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = (): void => {
      if (id) return;
      id = setInterval(() => setFrame((f) => f + 1), 1000 / fps);
    };
    const stop = (): void => {
      if (!id) return;
      clearInterval(id);
      id = null;
    };
    const onVis = (): void => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [task, fps]);

  const blink = task === 'idle' && frame % 8 === 7;
  const walkPhase = frame % 4;
  const built = buildSprite({
    task,
    walkPhase,
    blink,
    group,
    agent,
    frame,
    facing,
    carrying,
    ...(lookOverride !== undefined ? { lookOverride } : {}),
  });
  // Apply user-pref body color by remapping PX.b pixels in-place.
  const pixels = bodyColor
    ? built.pixels.map((p) => (p.c === PX.b ? { ...p, c: bodyColor } : p))
    : built.pixels;

  // touch CATEGORY_PRESETS / vibeFor so they aren't tree-shaken from the wardrobe import surface
  void CATEGORY_PRESETS;
  void vibeFor;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{
        display: 'block',
        imageRendering: 'pixelated',
        transform: facing === -1 ? 'scaleX(-1)' : 'none',
        transformOrigin: 'center',
      }}
    >
      {pixels.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={1} height={1} fill={p.c} />
      ))}
    </svg>
  );
}

// Back-compat type re-exports for any consumers that still import Outfit/MascotState
export type Outfit = 'none' | 'hardhat' | 'glasses' | 'beret' | 'cap' | 'wrench';
export type MascotState = string;
