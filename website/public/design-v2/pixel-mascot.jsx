/* global React */
/* =========================================================
   PixelMascot v2 — population of pixel creatures on top of the UI
   24x24 design grid · sharp pixels · warm-bone palette
   Each mascot has: AGENT (identity + outfit) + TASK (animation + prop)
   ========================================================= */
const { useState: uMS, useEffect: uME, useRef: uMR, useMemo: uMM } = React;

const PX = {
  o: "#0e0d0c",   // ink outline
  b: "#e8e3d5",   // body fill (platinum bone)
  s: "#c8c2b3",   // body shadow (warmer dim)
  h: "#f0ece2",   // highlight bone (rare)
  m: "#a08278",   // clay accent (mouth tint, paint)
  d: "#5c574f",   // ink-faint (tool dark, scroll)
  g: "#8b8377",   // mid-dark for prop details
};

/* Compose pixels: later layers override earlier */
function composePx(...layers) {
  const map = new Map();
  for (const layer of layers) {
    if (!layer) continue;
    for (const [x, y, c] of layer) {
      if (x < 0 || y < 0 || x >= 24 || y >= 24) continue;
      map.set(`${x},${y}`, { x, y, c });
    }
  }
  return [...map.values()];
}

/* =========================================================
   CREATURE — chunky pixel character with 4 legs.
   Square body, two ear nubs, simple dark eyes (no sparkle),
   4 stubby legs that animate as a real 4-leg walk cycle.
   ========================================================= */
function drawCreature({ blink = false, look = 0, expression = "happy", bob = 0, frame = 0, walking = false, walkPhase = 0, carrying = null, sleeping = false, squashV = 0, squashH = 0, vibe = null } = {}) {
  const px = [];
  const oy = (y) => y + bob;
  const v = vibe || (window.CATEGORY_PRESETS && window.CATEGORY_PRESETS.Default) || { badge: PX.d, lensTint: PX.h };

  // ============ BODY — rectangle (no ears) ============
  // squashH/squashV are small (-1..1) for squash & stretch on bob
  const bodyTop = 5 + squashV;
  const bodyBot = 13 - squashV;
  const bodyLeft = 7 - squashH;
  const bodyRight = 16 + squashH;

  // top edge
  for (let x = bodyLeft; x <= bodyRight; x++) px.push([x, oy(bodyTop), PX.o]);
  // sides
  for (let y = bodyTop; y <= bodyBot; y++) {
    px.push([bodyLeft, oy(y), PX.o]);
    px.push([bodyRight, oy(y), PX.o]);
  }
  // bottom edge
  for (let x = bodyLeft; x <= bodyRight; x++) px.push([x, oy(bodyBot), PX.o]);

  // fill
  for (let y = bodyTop + 1; y <= bodyBot - 1; y++) {
    for (let x = bodyLeft + 1; x <= bodyRight - 1; x++) {
      px.push([x, oy(y), PX.b]);
    }
  }
  // right shadow column for dimension
  for (let y = bodyTop + 1; y <= bodyBot - 1; y++) {
    px.push([bodyRight - 1, oy(y), PX.s]);
  }

  // ============ EYES ============
  // 2x2 solid dark squares. Right eye 1px lower for asymmetry (alive).
  const eyeY = look === 2 ? 7 : 8;
  const lx0 = 9  + (look < 0 ? -1 : 0);
  const rx0 = 13 + (look > 0 ?  1 : 0);

  if (blink || sleeping) {
    // closed slits ^_^
    px.push([lx0,   oy(eyeY+1), PX.o]); px.push([lx0+1, oy(eyeY+1), PX.o]);
    px.push([rx0,   oy(eyeY+1), PX.o]); px.push([rx0+1, oy(eyeY+1), PX.o]);
  } else if (expression === "happy" && !walking && (frame % 60 > 50)) {
    // occasional happy ^_^ when very content
    px.push([lx0,   oy(eyeY+1), PX.o]); px.push([lx0+1, oy(eyeY+1), PX.o]);
    px.push([rx0,   oy(eyeY+1), PX.o]); px.push([rx0+1, oy(eyeY+1), PX.o]);
  } else {
    // 2x2 solid dark squares
    px.push([lx0,   oy(eyeY),   PX.o]); px.push([lx0+1, oy(eyeY),   PX.o]);
    px.push([lx0,   oy(eyeY+1), PX.o]); px.push([lx0+1, oy(eyeY+1), PX.o]);
    px.push([rx0,   oy(eyeY),   PX.o]); px.push([rx0+1, oy(eyeY),   PX.o]);
    px.push([rx0,   oy(eyeY+1), PX.o]); px.push([rx0+1, oy(eyeY+1), PX.o]);
  }

  // expression overlays
  if (expression === "o") {
    // a tiny round "o" mouth between eyes
    px.push([11, oy(10), PX.o]); px.push([12, oy(10), PX.o]);
    px.push([11, oy(11), PX.o]); px.push([12, oy(11), PX.o]);
  }

  // ============ LEGS — proper 4-leg trot walk cycle ============
  // x positions: 8, 10, 13, 15 (left-outer, left-inner, right-inner, right-outer)
  // Diagonal pairs trot together: A = legs 0+2, B = legs 1+3
  // Each lifted leg shows only its top pixel (2px tucked up off the ground)
  // and the foot pixel shifts in the facing direction for a visible step.
  const legX = [8, 10, 13, 15];
  const phase = walkPhase % 4;

  legX.forEach((lx, i) => {
    let height = 3;
    if (walking) {
      const pairA = (i === 0 || i === 2);
      // Pair A lifts on phase 0, pair B on phase 2. Lifted legs are 1px shorter
      // so they stay clearly visible — no disappearing stubs.
      if (phase === 0 && pairA) height = 2;
      else if (phase === 2 && !pairA) height = 2;
    }
    const startY = oy(bodyBot + 1);
    for (let s = 0; s < height; s++) {
      px.push([lx, startY + s, PX.s]); // gray for shading
    }
  });

  return px;
}

/* =========================================================
   AGENT PROP ICONS — tiny sprites drawn next to the mascot
   to differentiate agents at-a-glance. Each is ~4×4 px,
   positioned to the right of the body at x=18..22.
   ========================================================= */
const PROP_ICONS = {
  // ----- code core -----
  cursor:     [[20,8],[20,9],[20,10]],
  magnifier:  [[19,7],[20,7],[18,8],[20,8],[19,9],[20,9],[21,10],[22,11]],
  bug:        [[19,7],[20,7],[18,8],[21,8],[19,9],[20,9],[18,10],[21,10]],
  check:      [[18,9],[19,10],[20,9],[21,8]],
  branch:     [[19,7],[18,8],[19,8],[20,8],[19,9],[20,9],[20,10]],
  braces:     [[19,7],[18,8],[18,9],[19,10],[21,7],[22,8],[22,9],[21,10]],
  stack:      [[18,8],[19,8],[20,8],[21,8],[18,10],[19,10],[20,10],[21,10]],
  speedo:     [[19,8],[20,8],[18,9],[21,9],[19,10],[20,10],[20,11]],
  // ----- stack -----
  brush:      [[21,7],[20,8],[19,9],[18,10],[19,10],[20,10]],
  blueprint:  [[18,7],[19,7],[20,7],[21,7],[18,9],[21,9],[18,11],[19,11],[20,11],[21,11]],
  cylinder:   [[18,7],[19,7],[20,7],[18,8],[20,8],[18,9],[19,9],[20,9],[18,10],[20,10]],
  phone:      [[19,6],[20,6],[19,7],[20,7],[19,8],[20,8],[19,9],[20,9],[19,10],[20,10],[19,11],[20,11]],
  key:        [[19,7],[18,8],[20,8],[19,9],[19,10],[20,10],[19,11]],
  cloud:      [[19,7],[18,8],[19,8],[20,8],[21,8],[20,9]],
  container:  [[18,7],[19,7],[20,7],[21,7],[18,8],[21,8],[18,9],[19,9],[20,9],[21,9]],
  wheel:      [[19,7],[18,8],[20,8],[19,9],[20,10]],
  // ----- knowledge -----
  papers:     [[18,7],[19,7],[20,7],[21,7],[18,8],[21,8],[18,9],[19,9],[20,9],[21,9],[18,10],[20,10]],
  pointer:    [[21,7],[20,8],[21,8],[19,9],[20,9],[18,10],[19,10]],
  thoughts:   [[20,6],[19,7],[20,7],[21,7],[18,9],[20,9]],
  typewriter: [[18,7],[19,7],[20,7],[21,7],[18,8],[19,8],[20,8],[21,8],[18,9],[20,9]],
  doc:        [[19,6],[20,6],[19,7],[20,7],[19,8],[20,8],[19,9],[20,9],[19,10],[20,10]],
  speech:     [[19,7],[20,7],[21,7],[19,8],[20,8],[21,8],[19,9],[18,10]],
  // ----- design -----
  prism:      [[20,7],[19,8],[20,8],[21,8],[18,9],[19,9],[20,9],[21,9],[22,9]],
  puzzle:     [[20,7],[19,8],[20,8],[21,8],[18,9],[19,9],[20,9],[21,9],[22,9],[20,10]],
  play:       [[19,7],[19,8],[20,8],[19,9],[20,9],[21,9],[19,10]],
  pencil:     [[21,7],[20,8],[19,9],[18,10]],
  palette:    [[19,7],[20,7],[18,8],[19,8],[20,8],[21,8],[19,9],[20,9]],
  frame:      [[18,7],[19,7],[20,7],[21,7],[22,7],[18,8],[22,8],[18,9],[22,9],[18,10],[19,10],[20,10],[21,10],[22,10]],
  photo:      [[18,7],[19,7],[20,7],[21,7],[18,8],[19,8],[21,8],[18,9],[19,9],[20,9],[21,9]],
  // ----- automation -----
  conveyor:   [[18,8],[19,8],[20,8],[21,8],[22,8],[19,9],[21,9]],
  clock:      [[19,7],[18,8],[19,8],[20,8],[19,9]],
  bolt:       [[20,6],[19,7],[20,7],[19,8],[20,8],[18,9],[19,9],[20,9]],
  pipe:       [[19,7],[20,7],[19,8],[20,8],[19,9],[20,9],[19,10],[20,10]],
  browser:    [[18,7],[19,7],[20,7],[21,7],[18,8],[19,8],[20,8],[21,8],[18,9],[21,9],[18,10],[21,10],[18,11],[19,11],[20,11],[21,11]],
  fileWatch:  [[18,7],[19,7],[20,7],[18,8],[20,8],[18,9],[19,9],[20,9],[22,10]],
  bell:       [[19,7],[18,8],[19,8],[20,8],[21,8],[19,9],[20,9],[20,10]],
  pipeline:   [[18,8],[19,8],[20,8],[21,8],[22,8],[19,7],[21,9]],
  ci:         [[18,7],[19,7],[20,8],[21,8],[19,9],[20,10],[21,10]],
  bot:        [[19,7],[20,7],[18,8],[19,8],[20,8],[21,8],[19,9],[20,9],[18,10],[21,10]],
  net:        [[18,7],[20,7],[22,7],[19,8],[21,8],[18,9],[20,9],[22,9]],
  chain:      [[19,7],[20,7],[19,8],[20,9],[20,10],[19,10]],
  // ----- ops -----
  dashboard:  [[18,7],[19,7],[20,7],[21,7],[18,8],[19,8],[20,8],[21,8],[18,9],[20,9]],
  terminal:   [[18,7],[19,7],[20,7],[21,7],[18,8],[19,8],[18,9],[18,10],[19,10],[20,10],[21,10]],
  toggle:     [[18,8],[19,8],[20,8],[21,8],[22,8],[18,9],[19,9],[20,9],[21,9],[22,9]],
  radar:      [[20,7],[19,8],[20,8],[21,8],[18,9],[20,9],[22,9]],
  shield:     [[19,6],[20,6],[18,7],[21,7],[18,8],[21,8],[18,9],[21,9],[19,10],[20,10]],
  // ----- build / data -----
  chart:      [[20,9],[20,10],[21,8],[21,9],[21,10],[19,10],[18,10]],
  timeline:   [[18,9],[19,9],[20,9],[21,9],[22,9],[18,8],[20,7],[22,8]],
  proto:      [[18,7],[19,7],[20,7],[21,7],[18,8],[19,8],[20,8],[21,8],[19,9],[20,9],[19,10],[20,10]],
  mock:       [[18,7],[19,7],[20,7],[18,9],[20,9],[18,10],[19,10],[20,10]],
  controller: [[18,8],[19,8],[20,8],[21,8],[22,8],[18,9],[22,9],[19,9],[21,9]],
  // ----- other -----
  coin:       [[19,7],[20,7],[18,8],[21,8],[18,9],[21,9],[19,10],[20,10]],
  eye:        [[19,7],[20,7],[18,8],[19,8],[20,8],[21,8],[19,9],[20,9]],
  magnet:     [[18,7],[20,7],[18,8],[20,8],[18,9],[20,9],[18,10],[20,10]],
  globe:      [[19,7],[20,7],[18,8],[19,8],[20,8],[21,8],[18,9],[19,9],[20,9],[21,9],[19,10],[20,10]]
};

function drawAgentProp(agentName, frame = 0) {
  if (!agentName) return [];
  const propName = (window.AGENT_PROPS || {})[agentName];
  if (!propName) return [];
  const icon = PROP_ICONS[propName];
  if (!icon) return [];
  // gentle prop bounce for some "Working" energy — 1px up every other frame
  const bounce = (frame % 8) < 4 ? 0 : -1;
  return icon.map(([x, y]) => [x, y + bounce, PX.b]);
}

function drawArm(side = "right", pose = "side", bob = 0) {
  const px = [];
  if (pose === "forward") {
    if (side === "right") {
      // little side nub extending right (like a paw)
      px.push([17, 10 + bob, PX.o]);
      px.push([17, 11 + bob, PX.o]);
    } else {
      px.push([6, 10 + bob, PX.o]);
      px.push([6, 11 + bob, PX.o]);
    }
  } else if (pose === "up") {
    if (side === "right") {
      px.push([15, 2 + bob, PX.o]);
    } else {
      px.push([8, 2 + bob, PX.o]);
    }
  }
  return px;
}

/* =========================================================
   OUTFITS — hat + body markings keyed by agent group
   ========================================================= */
/* Outfits sit on TOP of the egg — hats only, no body stripes
   Egg top spans x=8..15, y=2..5. Hats anchor at y=0..2.
*/
const OUTFITS = {
  Code: {
    // Hacker hood — peaked top, dim fill
    hat: [
      [11,1, PX.o], [12,1, PX.o],
      [10,2, PX.o], [11,2, PX.d], [12,2, PX.d], [13,2, PX.o],
      [9,3, PX.o], [10,3, PX.d], [11,3, PX.d], [12,3, PX.d], [13,3, PX.d], [14,3, PX.o],
      [8,4, PX.o], [9,4, PX.d], [14,4, PX.d], [15,4, PX.o]
    ]
  },
  Stack: {
    // Chunky headphones — band + visible earcups on each side
    hat: [
      [10,2, PX.o], [11,2, PX.o], [12,2, PX.o], [13,2, PX.o],
      [8,3, PX.o], [9,3, PX.o], [14,3, PX.o], [15,3, PX.o],
      [8,4, PX.d], [9,4, PX.d], [14,4, PX.d], [15,4, PX.d]
    ]
  },
  Knowledge: {
    // Mortarboard — flat square top + tassel
    hat: [
      [7,1, PX.o],[8,1, PX.o],[9,1, PX.o],[10,1, PX.o],[11,1, PX.o],
      [12,1, PX.o],[13,1, PX.o],[14,1, PX.o],[15,1, PX.o],[16,1, PX.o],
      [10,2, PX.o], [11,2, PX.d], [12,2, PX.d], [13,2, PX.o],
      [10,3, PX.o], [13,3, PX.o],
      // tassel dangling right
      [17,2, PX.b], [17,3, PX.b], [17,4, PX.b]
    ]
  },
  Design: {
    // Beret — tilted right + stem, clay color for artistic warmth
    hat: [
      [13,1, PX.o],
      [9,2, PX.o], [10,2, PX.m], [11,2, PX.m], [12,2, PX.m], [13,2, PX.m], [14,2, PX.o],
      [10,3, PX.m], [11,3, PX.m], [12,3, PX.m], [13,3, PX.m],
      [11,4, PX.o], [12,4, PX.o]
    ]
  },
  Automation: {
    // Bolt antenna — single pixel poking out the top
    hat: [
      [11,0, PX.b], [12,0, PX.o],
      [11,1, PX.o],
      [11,2, PX.o], [12,2, PX.o],
      [10,3, PX.o], [11,3, PX.d], [12,3, PX.d], [13,3, PX.o],
      [10,4, PX.o], [11,4, PX.d], [12,4, PX.d], [13,4, PX.o]
    ]
  },
  Ops: {
    // Tactical helmet — full rounded coverage + chin straps
    hat: [
      [10,1, PX.o], [11,1, PX.o], [12,1, PX.o], [13,1, PX.o],
      [9,2, PX.o], [10,2, PX.d], [11,2, PX.d], [12,2, PX.d], [13,2, PX.d], [14,2, PX.o],
      [8,3, PX.o], [9,3, PX.d], [10,3, PX.d], [11,3, PX.d], [12,3, PX.d], [13,3, PX.d], [14,3, PX.d], [15,3, PX.o],
      [8,4, PX.o], [15,4, PX.o]
    ]
  },
  Build: {
    // Backwards baseball cap — visor extends to the right (the "back")
    hat: [
      [10,2, PX.o], [11,2, PX.o], [12,2, PX.o], [13,2, PX.o],
      [9,3, PX.o], [10,3, PX.b], [11,3, PX.b], [12,3, PX.b], [13,3, PX.b], [14,3, PX.o],
      [9,4, PX.o], [10,4, PX.b], [11,4, PX.b], [12,4, PX.b], [13,4, PX.b], [14,4, PX.b], [15,4, PX.b], [16,4, PX.o]
    ]
  },
  Other: {
    // Detective fedora — pinched crown + classic brim
    hat: [
      [11,1, PX.d], [12,1, PX.d],
      [10,2, PX.o], [11,2, PX.b], [12,2, PX.b], [13,2, PX.o],
      [9,3, PX.o], [10,3, PX.b], [11,3, PX.b], [12,3, PX.b], [13,3, PX.b], [14,3, PX.o],
      [8,4, PX.o], [9,4, PX.o], [10,4, PX.o], [11,4, PX.o],
      [12,4, PX.o], [13,4, PX.o], [14,4, PX.o], [15,4, PX.o]
    ]
  },
  Default: { hat: [] }
};

/* Held items (overhead, while carrying) */
const CARRY_ICONS = {
  file: [
    // small file/doc icon held overhead
    [10,0, PX.o],[11,0, PX.o],[12,0, PX.o],[13,0, PX.o],
    [10,1, PX.o],[11,1, PX.b],[12,1, PX.b],[13,1, PX.o],
    [10,2, PX.o],[11,2, PX.b],[12,2, PX.b],[13,2, PX.o],
    [10,3, PX.o],[11,3, PX.o],[12,3, PX.o],[13,3, PX.o],
    // folded corner detail
    [12,1, PX.o]
  ],
  scroll: [
    [10,0, PX.o],[11,0, PX.o],[12,0, PX.o],[13,0, PX.o],
    [10,1, PX.o],[11,1, PX.b],[12,1, PX.b],[13,1, PX.o],
    [10,2, PX.o],[11,2, PX.d],[12,2, PX.d],[13,2, PX.o],
    [10,3, PX.o],[11,3, PX.b],[12,3, PX.b],[13,3, PX.o],
    [10,4, PX.o],[11,4, PX.o],[12,4, PX.o],[13,4, PX.o]
  ],
  cog: [
    [11,0, PX.o],[12,0, PX.o],
    [10,1, PX.o],[11,1, PX.b],[12,1, PX.b],[13,1, PX.o],
    [10,2, PX.o],[11,2, PX.b],[12,2, PX.b],[13,2, PX.o],
    [11,3, PX.o],[12,3, PX.o]
  ]
};
function drawProp(task, frame = 0) {
  switch (task) {
    case "typing":
      // small laptop in front of mascot, with blinking screen pixel
      return [
        [8,13, PX.o],[9,13, PX.o],[10,13, PX.o],[11,13, PX.o],[12,13, PX.o],[13,13, PX.o],[14,13, PX.o],[15,13, PX.o],[16,13, PX.o],
        // screen up
        [8,12, PX.o],[16,12, PX.o],
        [8,11, PX.o],[16,11, PX.o],
        [8,10, PX.o],[9,10, PX.o],[10,10, PX.o],[11,10, PX.o],[12,10, PX.o],[13,10, PX.o],[14,10, PX.o],[15,10, PX.o],[16,10, PX.o],
        // screen content
        [9,11, frame % 2 === 0 ? PX.b : PX.d],
        [10,11, PX.b],[11,11, PX.b],[12,11, PX.b],
        [9,12, PX.s],[10,12, PX.s],
        [13,12, PX.b],[14,12, PX.b],[15,12, PX.b],
      ];
    case "reading": {
      // open book in front
      return [
        [7,12, PX.o],[8,12, PX.o],[9,12, PX.o],[10,12, PX.o],[11,12, PX.o],[12,12, PX.o],
        [7,13, PX.o],[8,13, PX.b],[9,13, PX.b],[10,13, PX.o],[11,13, PX.b],[12,13, PX.b],
        [7,14, PX.o],[8,14, PX.b],[9,14, PX.d],[10,14, PX.o],[11,14, PX.d],[12,14, PX.b],
        [7,15, PX.o],[8,15, PX.b],[9,15, PX.d],[10,15, PX.o],[11,15, PX.d],[12,15, PX.b],
        [7,16, PX.o],[8,16, PX.o],[9,16, PX.o],[10,16, PX.o],[11,16, PX.o],[12,16, PX.o],
      ];
    }
    case "writing": {
      // scroll + quill in hand
      return [
        // scroll
        [16,11, PX.o],[16,14, PX.o],
        [17,11, PX.b],[17,12, PX.b],[17,13, PX.b],[17,14, PX.b],
        [18,11, PX.s],[18,12, PX.s],[18,13, PX.s],[18,14, PX.s],
        [19,11, PX.o],[19,14, PX.o],
        // quill held by right hand
        [16,9, PX.o], [17,8, PX.o], [18,7, PX.b], [19,6, PX.b], [20,5, PX.h],
        // ink dot
        frame % 2 === 0 ? [16,10, PX.d] : [17,10, PX.d]
      ].filter(Boolean);
    }
    case "searching": {
      // magnifying glass
      const sweep = frame % 4;
      const cx = 17 + (sweep === 1 ? 1 : sweep === 3 ? -1 : 0);
      const cy = 12 + (sweep === 2 ? 1 : sweep === 0 ? -1 : 0);
      return [
        // lens outline (3x3 circle approx)
        [cx,cy-1, PX.o],[cx-1,cy, PX.o],[cx+1,cy, PX.o],[cx,cy+1, PX.o],
        // handle
        [cx+1,cy+1, PX.d],[cx+2,cy+2, PX.d]
      ];
    }
    case "clipboard": {
      // clipboard held in hand
      return [
        [16,11, PX.o],[17,11, PX.o],[18,11, PX.o],
        [16,12, PX.o],[17,12, PX.b],[18,12, PX.o],
        [16,13, PX.o],[17,13, frame % 3 === 0 ? PX.d : PX.b],[18,13, PX.o], // checking line animates
        [16,14, PX.o],[17,14, PX.b],[18,14, PX.o],
        [16,15, PX.o],[17,15, PX.o],[18,15, PX.o],
      ];
    }
    case "painting": {
      // paintbrush + canvas
      return [
        // canvas
        [16,11, PX.o],[17,11, PX.o],[18,11, PX.o],[19,11, PX.o],
        [16,12, PX.o],[17,12, PX.b],[18,12, PX.b],[19,12, PX.o],
        [16,13, PX.o],[17,13, frame % 2 === 0 ? PX.m : PX.b],[18,13, PX.b],[19,13, PX.o],
        [16,14, PX.o],[17,14, PX.b],[18,14, PX.b],[19,14, PX.o],
        [16,15, PX.o],[17,15, PX.o],[18,15, PX.o],[19,15, PX.o],
        // brush in right hand
        [15,10, PX.o],[16,10, PX.m]
      ];
    }
    case "wrench": {
      // wrench in right hand
      return [
        [16,11, PX.d],[17,11, PX.d],
        [16,12, PX.o],[17,12, PX.d],
        [17,13, PX.d],
        [18,14, PX.d],
      ];
    }
    case "thinking": {
      // floating ? above head; alternate with !
      const ch = frame % 2 === 0
        ? [[16,4, PX.o],[16,5, PX.o],[17,5, PX.o],[18,5, PX.o],[18,6, PX.o],[17,7, PX.o],[17,9, PX.o]]
        : [[17,5, PX.o],[17,6, PX.o],[17,7, PX.o],[17,9, PX.o]];
      return ch;
    }
    case "spark": {
      // twinkle above head (tool moment)
      if (frame % 3 === 0) return [];
      return [[11,0, PX.o],[10,1, PX.o],[12,1, PX.o],[11,1, PX.b],[11,2, PX.o]];
    }
    case "celebrate": {
      // confetti pixels in random spots
      const r = frame * 3;
      return [
        [(r % 6) + 5, 1, PX.b],
        [((r * 2) % 8) + 13, 2, PX.s],
        [((r * 3) % 10) + 3, 0, PX.h],
      ];
    }
    default: return [];
  }
}

/* =========================================================
   Outfit accessory — handheld permanent prop tied to outfit
   These are drawn even when the mascot is just walking
   (the tool of trade)
   ========================================================= */
function drawSatchel(group) {
  // a small dot on the side as their identifier
  switch (group) {
    case "Code":     return [[15, 13, PX.d]]; // hammer hint
    case "Research": return [[15, 13, PX.b], [16, 13, PX.d]]; // book corner
    case "Writing":  return [[15, 13, PX.d]];
    case "Work":     return [[15, 13, PX.d]];
    case "Data":     return [[15, 13, PX.d]];
    case "Design":   return [[15, 13, PX.m]]; // paint speck
    default: return [];
  }
}

/* =========================================================
   Compose a single mascot sprite — creature-based
   ========================================================= */
function buildSprite({ task = "idle", facing = 1, walkPhase = 0, blink = false, group = "Default", agent = null, frame = 0, carrying = null, hideHat = false }) {
  let walking = false;
  let bob = 0;
  let blinkOn = blink;
  let look = 0;
  let expression = "happy";
  let sleeping = false;
  let squashV = 0; // body squashed shorter (positive = shorter)
  let squashH = 0; // body squashed wider  (positive = wider)

  switch (task) {
    case "walking": {
      walking = true;
      // Clean alternating bob: up on phases 0/2 (legs lifting), settled on 1/3.
      // No horizontal squash — keeps the body silhouette stable.
      const p = walkPhase % 4;
      bob = (p === 0 || p === 2) ? -1 : 0;
      break;
    }
    case "climbing":
      bob = walkPhase % 2 === 0 ? 0 : -1;
      break;
    case "typing":
      bob = frame % 4 < 2 ? 0 : -1;
      break;
    case "reading":
    case "writing":
    case "searching":
    case "checking":
    case "painting":
    case "wrenching":
      bob = frame % 6 < 3 ? 0 : -1;
      break;
    case "thinking":
      // glance up periodically + tilt by 1px every other phase
      look = (frame % 24 < 12) ? 2 : 0;
      bob = frame % 24 < 12 ? -1 : 0;
      break;
    case "celebrating":
      // bouncy: alternate -1/-3 with squash-stretch
      bob = frame % 2 === 0 ? -1 : -3;
      squashH = frame % 2 === 0 ? 1 : 0;
      squashV = frame % 2 === 0 ? 0 : -1;
      expression = "o";
      break;
    case "sleeping":
      blinkOn = true;
      sleeping = true;
      bob = frame % 16 < 8 ? 0 : -1;
      break;
    case "exiting":
      walking = true;
      bob = walkPhase % 2 === 0 ? 0 : -1;
      break;
    default: { // idle
      // breathing cycle of 24 frames: small up at center
      const p = frame % 24;
      bob = (p > 4 && p < 12) ? -1 : 0;
      // subtle horizontal breath
      squashH = (p > 8 && p < 11) ? 1 : 0;
      // gaze wanders
      if (p > 18) look = (frame % 96 < 48) ? -1 : 1;
      blinkOn = blink;
    }
  }

  const vibe = (window.vibeFor && window.vibeFor(agent || { group })) || null;

  const creaturePixels = drawCreature({
    blink: blinkOn,
    look, expression, bob, frame,
    walking, walkPhase,
    carrying, sleeping,
    squashV, squashH,
    vibe
  });

  // Arm overlay for tool-holding tasks (extends a paw nub outward)
  let armOverlay = null;
  if (!carrying && ["wrenching", "painting", "writing", "reading", "searching"].includes(task)) {
    armOverlay = drawArm("right", "forward", bob);
  } else if (carrying) {
    armOverlay = drawArm("right", "up", bob);
  }

  const outfit = OUTFITS[group] || OUTFITS.Default;
  const hat = (carrying || hideHat) ? [] : (outfit.hat || []);
  const shiftHat = bob === 0 ? hat : hat.map(([x,y,c]) => [x, y + bob, c]);

  const carryLayer = carrying && CARRY_ICONS[carrying] ? CARRY_ICONS[carrying] : null;

  const pixels = composePx(
    creaturePixels,
    armOverlay,
    shiftHat,
    (carrying || task === "climbing") ? null : drawProp(task, frame),
    carryLayer
  );

  return { pixels, facing };
}

/* =========================================================
   <PixelMascot> — pixel egg (Thursday's first version)
   ========================================================= */
function PixelMascot({ task = "idle", group = "Default", agent = null, facing = 1, size = 56, fps = 8, carrying = null }) {
  const [frame, setFrame] = uMS(0);
  uME(() => {
    if (task === "sleeping") return;
    const id = setInterval(() => setFrame(f => f + 1), 1000 / fps);
    return () => clearInterval(id);
  }, [task, fps]);

  const blink = task === "idle" && frame % 8 === 7;
  const walkPhase = frame % 4;
  const { pixels } = buildSprite({ task, walkPhase, blink, group, agent, frame, facing, carrying });

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{
        display: "block",
        imageRendering: "pixelated",
        transform: facing === -1 ? "scaleX(-1)" : "none",
        transformOrigin: "center"
      }}
    >
      {pixels.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width="1" height="1" fill={p.c} />
      ))}
    </svg>
  );
}

/* =========================================================
   WORKSHOPS — pixel-art workspace decorations + zones
   Mascots gather at their workshop and do their task there.
   ========================================================= */

const WORKSHOP_PIXELS = {
  // Bookshelf (Research). 14 wide x 14 tall, anchored bottom-center.
  research: (() => {
    const px = [];
    // outer frame
    for (let x = 4; x <= 17; x++) { px.push([x, 5, PX.o]); px.push([x, 19, PX.o]); }
    for (let y = 5; y <= 19; y++) { px.push([4, y, PX.o]); px.push([17, y, PX.o]); }
    // middle shelf
    for (let x = 5; x <= 16; x++) px.push([x, 12, PX.o]);
    // books on top shelf
    let bx = 5;
    const palette = [PX.b, PX.s, PX.b, PX.h, PX.s, PX.b];
    while (bx <= 16) {
      for (let y = 6; y <= 11; y++) px.push([bx, y, PX.o]);              // spine outline
      if (bx + 1 <= 16) for (let y = 6; y <= 11; y++) px.push([bx + 1, y, palette[(bx * 3) % 6]]);
      bx += 2;
    }
    // books on bottom shelf
    bx = 5;
    while (bx <= 16) {
      for (let y = 13; y <= 18; y++) px.push([bx, y, PX.o]);
      if (bx + 1 <= 16) for (let y = 13; y <= 18; y++) px.push([bx + 1, y, palette[(bx * 5 + 1) % 6]]);
      bx += 2;
    }
    // ground shadow
    for (let x = 4; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Programming workstation: monitor + keyboard. 14x14
  programming: (() => {
    const px = [];
    // monitor frame
    for (let x = 5; x <= 15; x++) { px.push([x, 4, PX.o]); px.push([x, 12, PX.o]); }
    for (let y = 4; y <= 12; y++) { px.push([5, y, PX.o]); px.push([15, y, PX.o]); }
    // screen content (fill)
    for (let y = 5; y <= 11; y++) for (let x = 6; x <= 14; x++) px.push([x, y, PX.s]);
    // code lines on screen
    for (let i = 0; i < 6; i++) {
      const y = 6 + i;
      const len = 3 + ((i * 7) % 6);
      for (let x = 7; x <= 7 + len; x++) px.push([x, y, PX.b]);
    }
    // a brighter cursor block
    px.push([13, 6, PX.h]);
    // stand
    px.push([9, 13, PX.o]); px.push([10, 13, PX.o]); px.push([11, 13, PX.o]);
    px.push([9, 14, PX.o]); px.push([10, 14, PX.s]); px.push([11, 14, PX.o]);
    // desk top
    for (let x = 3; x <= 17; x++) px.push([x, 15, PX.o]);
    for (let x = 3; x <= 17; x++) px.push([x, 16, PX.s]);
    // keyboard
    for (let x = 7; x <= 13; x++) px.push([x, 17, PX.o]);
    px.push([7, 18, PX.o]); px.push([13, 18, PX.o]);
    for (let x = 8; x <= 12; x++) px.push([x, 18, PX.s]);
    // ground shadow
    for (let x = 3; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Design easel + canvas. 14x14
  design: (() => {
    const px = [];
    // canvas frame
    for (let x = 6; x <= 14; x++) { px.push([x, 3, PX.o]); px.push([x, 12, PX.o]); }
    for (let y = 3; y <= 12; y++) { px.push([6, y, PX.o]); px.push([14, y, PX.o]); }
    // canvas fill
    for (let y = 4; y <= 11; y++) for (let x = 7; x <= 13; x++) px.push([x, y, PX.b]);
    // paint splotches
    px.push([9, 6, PX.m]); px.push([10, 6, PX.m]);
    px.push([10, 7, PX.m]); px.push([11, 8, PX.m]);
    px.push([8, 9, PX.s]); px.push([9, 9, PX.s]);
    px.push([12, 9, PX.s]);
    // easel legs — tripod
    px.push([7, 13, PX.o]); px.push([13, 13, PX.o]);
    px.push([6, 14, PX.o]); px.push([14, 14, PX.o]);
    px.push([5, 15, PX.o]); px.push([15, 15, PX.o]);
    px.push([10, 13, PX.o]); px.push([10, 14, PX.o]); px.push([10, 15, PX.o]);
    px.push([4, 16, PX.o]); px.push([10, 16, PX.o]); px.push([16, 16, PX.o]);
    // ground shadow
    for (let x = 4; x <= 16; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Automation gears. 14x14
  automation: (() => {
    const px = [];
    // big gear at (9, 10)
    const gear = (cx, cy, r) => {
      // outline circle approximation
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const d2 = dx*dx + dy*dy;
          if (d2 <= r*r && d2 >= (r-1)*(r-1)) px.push([cx + dx, cy + dy, PX.o]);
        }
      }
      // teeth
      px.push([cx, cy - r - 1, PX.o]); px.push([cx, cy + r + 1, PX.o]);
      px.push([cx - r - 1, cy, PX.o]); px.push([cx + r + 1, cy, PX.o]);
      // center
      px.push([cx, cy, PX.o]);
      px.push([cx + 1, cy, PX.s]); px.push([cx - 1, cy, PX.s]);
      px.push([cx, cy + 1, PX.s]); px.push([cx, cy - 1, PX.s]);
    };
    gear(9, 10, 4);
    gear(15, 14, 3);
    // base
    for (let x = 3; x <= 17; x++) px.push([x, 19, PX.o]);
    // ground shadow
    for (let x = 3; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Server rack (Stack)
  infrastructure: (() => {
    const px = [];
    // outer frame
    for (let x = 5; x <= 16; x++) { px.push([x, 4, PX.o]); px.push([x, 19, PX.o]); }
    for (let y = 4; y <= 19; y++) { px.push([5, y, PX.o]); px.push([16, y, PX.o]); }
    // three server units, each with a thin LED stripe
    const unit = (yTop) => {
      for (let x = 6; x <= 15; x++) px.push([x, yTop, PX.o]);
      // fill
      for (let y = yTop + 1; y < yTop + 4; y++) for (let x = 6; x <= 15; x++) px.push([x, y, PX.s]);
      // LEDs
      px.push([7, yTop + 1, PX.h]); px.push([9, yTop + 1, PX.b]); px.push([11, yTop + 1, PX.h]);
      px.push([13, yTop + 1, PX.b]); px.push([14, yTop + 1, PX.h]);
      // vent slots
      px.push([7, yTop + 2, PX.d]); px.push([8, yTop + 2, PX.d]); px.push([9, yTop + 2, PX.d]);
      px.push([11, yTop + 2, PX.d]); px.push([12, yTop + 2, PX.d]); px.push([13, yTop + 2, PX.d]);
    };
    unit(5);
    unit(10);
    unit(15);
    // ground shadow
    for (let x = 5; x <= 16; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Terminal (Ops) — CRT monitor with prompt
  terminal: (() => {
    const px = [];
    // monitor frame
    for (let x = 3; x <= 17; x++) { px.push([x, 4, PX.o]); px.push([x, 13, PX.o]); }
    for (let y = 4; y <= 13; y++) { px.push([3, y, PX.o]); px.push([17, y, PX.o]); }
    // screen fill (dark)
    for (let y = 5; y <= 12; y++) for (let x = 4; x <= 16; x++) px.push([x, y, PX.d]);
    // prompt lines (green-ish substitute uses bone)
    // $ — dollar sign first row
    px.push([5, 6, PX.b]); px.push([6, 6, PX.b]);
    // command line 1
    for (let x = 8; x <= 11; x++) px.push([x, 6, PX.b]);
    // line 2
    for (let x = 5; x <= 12; x++) px.push([x, 8, PX.h]);
    for (let x = 5; x <= 9; x++) px.push([x, 10, PX.b]);
    // blinking cursor
    px.push([11, 10, PX.h]);
    // stand
    px.push([9, 14, PX.o]); px.push([10, 14, PX.o]); px.push([11, 14, PX.o]);
    px.push([9, 15, PX.o]); px.push([10, 15, PX.s]); px.push([11, 15, PX.o]);
    // base
    for (let x = 4; x <= 16; x++) px.push([x, 16, PX.o]);
    for (let x = 4; x <= 16; x++) px.push([x, 17, PX.s]);
    // ground shadow
    for (let x = 3; x <= 17; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Data lab (Build) — bar chart with ascending bars
  data: (() => {
    const px = [];
    // chart frame
    for (let y = 4; y <= 16; y++) px.push([4, y, PX.o]);
    for (let x = 4; x <= 18; x++) px.push([x, 16, PX.o]);
    // bars (left to right ascending)
    const bars = [{x:6, h:3},{x:8, h:5},{x:10, h:4},{x:12, h:7},{x:14, h:6},{x:16, h:9}];
    bars.forEach(b => {
      for (let y = 16 - b.h; y < 16; y++) {
        px.push([b.x, y, PX.o]);
        px.push([b.x + 1, y, y === 16 - b.h ? PX.b : PX.s]);
      }
    });
    // axis tick marks
    px.push([3, 8, PX.d]); px.push([3, 12, PX.d]);
    // a small dot above tallest bar (annotation)
    px.push([16, 6, PX.h]);
    // ground shadow
    for (let x = 4; x <= 18; x++) px.push([x, 20, PX.d]);
    return px;
  })(),

  // Workshop (Other) — generic toolbox
  workshop: (() => {
    const px = [];
    // top handle
    for (let x = 10; x <= 13; x++) px.push([x, 4, PX.o]);
    px.push([9, 5, PX.o]); px.push([14, 5, PX.o]);
    px.push([9, 6, PX.o]); px.push([14, 6, PX.o]);
    // toolbox body
    for (let x = 5; x <= 18; x++) { px.push([x, 7, PX.o]); px.push([x, 17, PX.o]); }
    for (let y = 7; y <= 17; y++) { px.push([5, y, PX.o]); px.push([18, y, PX.o]); }
    // fill
    for (let y = 8; y <= 16; y++) for (let x = 6; x <= 17; x++) px.push([x, y, PX.s]);
    // latch / center groove
    for (let x = 6; x <= 17; x++) px.push([x, 12, PX.o]);
    // a few tool tips poking up
    px.push([7, 11, PX.b]); px.push([10, 11, PX.b]); px.push([14, 11, PX.b]);
    // ground shadow
    for (let x = 5; x <= 18; x++) px.push([x, 20, PX.d]);
    return px;
  })()
};

const WORKSHOP_LABELS = {
  research:       "Research",
  programming:    "Programming",
  design:         "Design",
  automation:     "Automation",
  infrastructure: "Infrastructure",
  terminal:       "Ops",
  data:           "Data",
  workshop:       "Workshop"
};

function Workshop({ kind, x, y, size = 64, label = true }) {
  const pixels = WORKSHOP_PIXELS[kind] || [];
  return (
    <div style={{
      position: "absolute",
      left: x - size / 2,
      top: y - size,
      width: size,
      pointerEvents: "none",
      zIndex: 33,
    }}>
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        shapeRendering="crispEdges"
        style={{ imageRendering: "pixelated", display: "block" }}
      >
        {pixels.map((p, i) => (
          <rect key={i} x={p[0]} y={p[1]} width="1" height="1" fill={p[2]} />
        ))}
      </svg>
      {label && (
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--ink-faint)",
          textAlign: "center",
          marginTop: 2,
          whiteSpace: "nowrap"
        }}>
          {WORKSHOP_LABELS[kind]}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   DOOR — mascots exit through this when an agent stops
   ========================================================= */
function Door({ x, y, open = false, size = 56 }) {
  const px = 24; // grid
  // Door frame outline
  const pixels = [];
  // top + sides + bottom
  for (let cx = 6; cx <= 17; cx++) { pixels.push([cx, 4, PX.o]); pixels.push([cx, 21, PX.o]); }
  for (let cy = 4; cy <= 21; cy++) { pixels.push([6, cy, PX.o]); pixels.push([17, cy, PX.o]); }
  if (open) {
    // open door — show dark interior + swung door panel on the LEFT
    for (let cy = 5; cy <= 20; cy++) for (let cx = 9; cx <= 16; cx++) pixels.push([cx, cy, PX.d]);
    // swung door panel (thin vertical strip on left)
    for (let cy = 5; cy <= 20; cy++) pixels.push([7, cy, PX.s]);
    pixels.push([8, 5, PX.o]); pixels.push([8, 20, PX.o]);
    // light coming from inside (sparkle in middle)
    pixels.push([12, 12, PX.h]); pixels.push([13, 12, PX.h]);
  } else {
    // closed door panel
    for (let cy = 5; cy <= 20; cy++) for (let cx = 7; cx <= 16; cx++) pixels.push([cx, cy, PX.s]);
    // wood grain (vertical line)
    for (let cy = 5; cy <= 20; cy++) pixels.push([11, cy, PX.d]);
    // door handle
    pixels.push([14, 13, PX.o]); pixels.push([14, 14, PX.o]);
    // top trim
    for (let cx = 7; cx <= 16; cx++) pixels.push([cx, 5, PX.o]);
  }
  return (
    <svg
      style={{
        position: "absolute",
        left: x - size / 2, top: y - size,
        width: size, height: size,
        imageRendering: "pixelated", pointerEvents: "none", zIndex: 34
      }}
      viewBox={`0 0 ${px} ${px}`}
      shapeRendering="crispEdges"
    >
      {pixels.map((p, i) => (
        <rect key={i} x={p[0]} y={p[1]} width="1" height="1" fill={p[2]} />
      ))}
    </svg>
  );
}

/* =========================================================
   LADDER — a pixel-art ladder that mascots climb
   ========================================================= */
function Ladder({ x, y1, y2, width = 16 }) {
  const h = y2 - y1;
  const rungH = 16; // px between rungs
  const rungs = [];
  for (let y = 6; y < h; y += rungH) rungs.push(y);
  return (
    <svg
      style={{
        position: "absolute",
        left: x - width / 2,
        top: y1,
        width: width,
        height: h,
        imageRendering: "pixelated",
        pointerEvents: "none",
        zIndex: 34
      }}
      viewBox={`0 0 ${width} ${h}`}
      shapeRendering="crispEdges"
    >
      {/* left rail */}
      <rect x={2} y={0} width={2} height={h} fill={PX.o} />
      {/* right rail */}
      <rect x={width - 4} y={0} width={2} height={h} fill={PX.o} />
      {/* rail shadows */}
      <rect x={4} y={0} width={1} height={h} fill={PX.d} opacity="0.5" />
      <rect x={width - 5} y={0} width={1} height={h} fill={PX.d} opacity="0.5" />
      {/* rungs */}
      {rungs.map((y, i) => (
        <g key={i}>
          <rect x={4} y={y} width={width - 8} height={2} fill={PX.o} />
          <rect x={4} y={y + 2} width={width - 8} height={1} fill={PX.d} opacity="0.5" />
        </g>
      ))}
    </svg>
  );
}

/* =========================================================
   MASCOT WORLD — surfaces, ladders, scripted behaviors
   ========================================================= */
const SPRITE_W = 56;

// where the feet land within a SPRITE_W-sized sprite (row 17 of 24)
const FEET_OFFSET = Math.round((17 / 24) * SPRITE_W);

// Scripts are arrays of actions executed in order, looping
//   { type: 'walkTo', x, surface }
//   { type: 'climb', ladder, toSurface, dir: 'up'|'down' }
//   { type: 'task', task, ms }
//   { type: 'wait', ms }
//   { type: 'pickUp', icon }
//   { type: 'drop' }
//   { type: 'face', dir }     // 1 or -1

/* Measure UI elements for surfaces + ladders + anchors + workshops */
function measureWorld(winEl, screen) {
  if (!winEl) return { surfaces: {}, ladders: {}, anchors: {}, workshops: [] };
  const winR = winEl.getBoundingClientRect();
  const get = (sel) => {
    const el = winEl.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.left - winR.left, y: r.top - winR.top,
      w: r.width, h: r.height,
      right: r.right - winR.left, bottom: r.bottom - winR.top,
      cx: (r.left + r.right) / 2 - winR.left
    };
  };
  const surfaces = {};
  const ladders = {};
  const anchors = {};
  const workshops = [];

  const mainEl = get(".main");
  const mainBottom = mainEl ? mainEl.bottom : winR.height;
  const mainLeft = mainEl ? mainEl.x : 296;
  const mainRight = mainEl ? mainEl.right : winR.width;

  // Universal floor strip running along the bottom of the main area
  surfaces.floor = { y: mainBottom - 8, x1: mainLeft + 24, x2: mainRight - 24 };

  // Workshop strip — placed at a specified y (defaults to floor)
  const placeWorkshops = (kinds, yOverride) => {
    const usable = (mainRight - 24) - (mainLeft + 24);
    const slots = kinds.length;
    const groupFor = {
      research:       "Knowledge",
      programming:    "Code",
      design:         "Design",
      automation:     "Automation",
      infrastructure: "Stack",
      terminal:       "Ops",
      data:           "Build",
      workshop:       "Other"
    };
    const y = yOverride !== undefined ? yOverride : surfaces.floor.y;
    kinds.forEach((kind, i) => {
      const cx = mainLeft + 24 + (i + 0.5) * (usable / slots);
      workshops.push({
        kind, group: groupFor[kind],
        x: cx,
        y
      });
    });
  };

  if (screen === "chat") {
    const composer = get(".composer-chat");
    const header   = get(".chat-header");
    const filesBtn = [...winEl.querySelectorAll(".chat-header button")].find(b => /Files/i.test(b.textContent));
    if (composer) {
      surfaces["composer-top"] = {
        y: composer.y, x1: composer.x + 12, x2: composer.right - 12
      };
      // Place workstations along the top edge of the composer
      placeWorkshops(["programming", "research", "design", "automation"], composer.y);
    }
    if (header) {
      surfaces["header-bottom"] = {
        y: header.bottom, x1: header.x + 16, x2: header.right - 16
      };
    }
    if (composer && header) {
      const lx = Math.min(composer.right - 28, header.right - 28);
      ladders.main = {
        x: lx,
        y1: surfaces["header-bottom"].y,
        y2: surfaces["composer-top"].y
      };
    }
    if (filesBtn) {
      const r = filesBtn.getBoundingClientRect();
      anchors.filesBtn = { x: (r.left + r.right) / 2 - winR.left, y: r.top - winR.top };
    }
  }
  if (screen === "dashboard") {
    const composer = get(".composer");
    if (composer) {
      surfaces["dash-composer-top"] = { y: composer.y, x1: composer.x + 16, x2: composer.right - 16 };
    }
  }
  if (screen === "models") {
    const recco = get(".recco-grid");
    if (recco) surfaces["recco-top"] = { y: recco.y, x1: recco.x + 16, x2: recco.right - 16 };
    placeWorkshops(["programming", "automation"]);
  }
  if (screen === "connectors") {
    const grid = get(".cnx-grid");
    if (grid) surfaces["cnx-top"] = { y: grid.y, x1: grid.x + 16, x2: grid.right - 16 };
    placeWorkshops(["automation", "programming"]);
  }
  if (screen === "brain") {
    placeWorkshops(["research"]);
  }
  if (screen === "settings") {
    placeWorkshops(["automation"]);
  }

  return { surfaces, ladders, anchors, workshops };
}

/* Build the scripted scene for a screen */
function makeScene(screen, surfaces, ladders, anchors, workshops, taskCardRects) {
  const now = performance.now();
  const make = (m) => ({
    facing: 1, carrying: null, scriptIdx: 0, actionStart: now,
    spriteTask: "idle", ...m
  });

  // Team-run modal scenario — one mascot per task card sitting on it
  if (taskCardRects && taskCardRects.length > 0) {
    const teamPlan = (window.FLOW_DATA && window.FLOW_DATA.teamRun && window.FLOW_DATA.teamRun.plan) || [];
    return taskCardRects.map((r, i) => {
      const planEntry = teamPlan[i];
      const agentName = planEntry?.name || null;
      const agentObj = agentName && (window.FLOW_DATA.agents || []).find(a => a.name === agentName);
      const group = agentObj?.group || "Code";
      const task = ["typing", "wrenching", "checking", "writing"][i] || "thinking";
      return make({
        id: `task-${i}`,
        agent: agentName,
        group,
        x: r.x + r.w / 2,
        y: r.y,
        surface: null,
        script: [
          { type: "task", task, ms: 4000 + i * 500 },
          { type: "task", task: "thinking", ms: 1200 },
        ]
      });
    });
  }

  // Chat — the ladder + fetch-file scene
  if (screen === "chat" && surfaces["composer-top"] && surfaces["header-bottom"] && ladders.main) {
    const cs = surfaces["composer-top"];
    const hs = surfaces["header-bottom"];
    const L = ladders.main;
    const filesX = (anchors.filesBtn && anchors.filesBtn.x) || hs.x1 + 200;

    return [
      make({
        id: "rsch", agent: "Researcher", group: "Knowledge",
        x: cs.x1 + 80, y: cs.y, surface: "composer-top",
        script: [
          { type: "task", task: "thinking", ms: 1200 },
          { type: "walkTo", x: L.x, surface: "composer-top" },
          { type: "face", dir: 1 },
          { type: "climb", ladder: "main", dir: "up", toSurface: "header-bottom" },
          { type: "walkTo", x: filesX, surface: "header-bottom" },
          { type: "task", task: "searching", ms: 1500 },
          { type: "pickUp", icon: "file" },
          { type: "wait", ms: 500 },
          { type: "walkTo", x: L.x, surface: "header-bottom" },
          { type: "climb", ladder: "main", dir: "down", toSurface: "composer-top" },
          { type: "walkTo", x: cs.x1 + 200, surface: "composer-top" },
          { type: "task", task: "reading", ms: 3500 },
          { type: "drop" },
          { type: "wait", ms: 800 },
        ]
      }),
      make({
        id: "arch", agent: "Backend Architect", group: "Stack",
        x: cs.x1 + 280, y: cs.y, surface: "composer-top",
        script: [
          { type: "walkTo", x: cs.x2 - 280, surface: "composer-top" },
          { type: "task", task: "thinking", ms: 1500 },
          { type: "walkTo", x: cs.x1 + 400, surface: "composer-top" },
          { type: "task", task: "typing", ms: 3500 },
        ]
      }),
      make({
        id: "writ", agent: "Doc Writer", group: "Knowledge",
        x: hs.x1 + 60, y: hs.y, surface: "header-bottom",
        script: [
          { type: "task", task: "writing", ms: 5000 },
          { type: "walkTo", x: hs.x1 + 120, surface: "header-bottom" },
          { type: "task", task: "writing", ms: 5000 },
          { type: "walkTo", x: hs.x1 + 60, surface: "header-bottom" },
        ]
      }),
      make({
        id: "dsgn", agent: "Vibe Designer", group: "Design",
        x: cs.x1 + 480, y: cs.y, surface: "composer-top",
        script: [
          { type: "task", task: "painting", ms: 4000 },
          { type: "walkTo", x: cs.x1 + 550, surface: "composer-top" },
          { type: "task", task: "painting", ms: 4000 },
          { type: "walkTo", x: cs.x1 + 480, surface: "composer-top" },
        ]
      })
    ];
  }

  // Workshops-driven scene: each workshop hosts a mascot of matching group
  if (workshops && workshops.length > 0 && surfaces.floor) {
    const taskFor = {
      Knowledge: "reading",
      Code: "typing",
      Stack: "wrenching",
      Design: "painting",
      Automation: "wrenching",
      Ops: "searching",
      Build: "checking",
      Other: "checking",
      Default: "thinking"
    };
    // Pick a representative agent name for each group
    const repAgent = (group) => {
      const agents = (window.FLOW_DATA && window.FLOW_DATA.agents) || [];
      const match = agents.find(a => a.group === group);
      return match ? match.name : null;
    };
    const mascots = workshops.map((w, i) => {
      const task = taskFor[w.group] || "thinking";
      return make({
        id: `ws-${w.kind}-${i}`,
        agent: repAgent(w.group),
        group: w.group,
        x: w.x + 32,
        y: w.y,
        surface: "floor",
        facing: -1,
        script: [
          { type: "task", task, ms: 4500 + (i * 600) },
          { type: "face", dir: 1 },
          { type: "walkTo", x: w.x + 64, surface: "floor" },
          { type: "task", task: "thinking", ms: 1800 },
          { type: "walkTo", x: w.x + 32, surface: "floor" },
          { type: "face", dir: -1 },
        ]
      });
    });
    return mascots;
  }

  // Settings / brain / fallback — chill on floor
  if (surfaces.floor) {
    const f = surfaces.floor;
    return [
      make({
        id: "writ", agent: "Doc Writer", group: "Knowledge",
        x: f.x1 + 80, y: f.y, surface: "floor",
        script: [{ type: "task", task: "sleeping", ms: 99999 }]
      }),
      make({
        id: "arch", agent: "Backend Architect", group: "Stack",
        x: f.x1 + 200, y: f.y, surface: "floor",
        script: [
          { type: "walkTo", x: f.x2 - 200, surface: "floor" },
          { type: "task", task: "thinking", ms: 2000 },
          { type: "walkTo", x: f.x1 + 200, surface: "floor" },
        ]
      })
    ];
  }
  return [];
}

/* Advance one mascot one frame */
function stepMascot(m, dt, surfaces, ladders, speed) {
  const action = m.script[m.scriptIdx];
  if (!action) return m;
  switch (action.type) {
    case "walkTo": {
      const s = surfaces[action.surface || m.surface];
      if (!s) return m;
      const target = Math.max(s.x1, Math.min(s.x2, action.x));
      const dx = target - m.x;
      const targetY = s.y;
      if (Math.abs(dx) < 1.5) {
        return { ...m, x: target, y: targetY, surface: action.surface || m.surface,
                 scriptIdx: (m.scriptIdx + 1) % m.script.length,
                 actionStart: performance.now(),
                 spriteTask: "idle" };
      }
      const step = speed * dt;
      const nx = m.x + Math.sign(dx) * Math.min(step, Math.abs(dx));
      return { ...m, x: nx, y: targetY, facing: dx > 0 ? 1 : -1, spriteTask: "walking",
               surface: action.surface || m.surface };
    }
    case "climb": {
      const L = ladders[action.ladder];
      if (!L) return m;
      const goingUp = action.dir === "up";
      const targetY = goingUp ? L.y1 : L.y2;
      const dy = targetY - m.y;
      if (Math.abs(dy) < 1.5) {
        return { ...m, x: L.x, y: targetY,
                 surface: action.toSurface,
                 scriptIdx: (m.scriptIdx + 1) % m.script.length,
                 actionStart: performance.now(),
                 spriteTask: "idle" };
      }
      const step = speed * dt * 0.6; // slower vertical
      return { ...m, x: L.x, y: m.y + Math.sign(dy) * Math.min(step, Math.abs(dy)),
               facing: 1, spriteTask: "climbing" };
    }
    case "task": {
      const elapsed = performance.now() - m.actionStart;
      if (elapsed >= action.ms) {
        return { ...m, scriptIdx: (m.scriptIdx + 1) % m.script.length,
                 actionStart: performance.now(), spriteTask: "idle" };
      }
      return { ...m, spriteTask: action.task };
    }
    case "wait": {
      const elapsed = performance.now() - m.actionStart;
      if (elapsed >= action.ms) {
        return { ...m, scriptIdx: (m.scriptIdx + 1) % m.script.length,
                 actionStart: performance.now() };
      }
      return m;
    }
    case "pickUp":
      return { ...m, carrying: action.icon,
               scriptIdx: (m.scriptIdx + 1) % m.script.length,
               actionStart: performance.now() };
    case "drop":
      return { ...m, carrying: null,
               scriptIdx: (m.scriptIdx + 1) % m.script.length,
               actionStart: performance.now() };
    case "face":
      return { ...m, facing: action.dir,
               scriptIdx: (m.scriptIdx + 1) % m.script.length,
               actionStart: performance.now() };
    default: return m;
  }
}

function MascotWorld({ screen, teamRunOpen, taskCardRects = [], maxCount = 6, speed = 60 }) {
  const containerRef = uMR(null);
  const [world, setWorld] = uMS({ surfaces: {}, ladders: {}, anchors: {}, workshops: [] });
  const [mascots, setMascots] = uMS([]);

  // Measure DOM anchors when screen or modal state changes (and periodically for layout shifts)
  uME(() => {
    if (!containerRef.current) return;
    const win = containerRef.current.parentElement;
    const measure = () => {
      const w = measureWorld(win, teamRunOpen ? "team" : screen);
      setWorld(w);
    };
    measure();
    const id1 = setTimeout(measure, 60);
    const id2 = setTimeout(measure, 240);
    const id3 = setTimeout(measure, 600);
    const onR = () => measure();
    window.addEventListener("resize", onR);
    return () => {
      clearTimeout(id1); clearTimeout(id2); clearTimeout(id3);
      window.removeEventListener("resize", onR);
    };
  }, [screen, teamRunOpen, taskCardRects.length]);

  // Build the scene whenever the world changes
  uME(() => {
    const scene = makeScene(screen, world.surfaces, world.ladders, world.anchors, world.workshops, teamRunOpen ? taskCardRects : []);
    setMascots(scene.slice(0, maxCount));
  }, [world, screen, teamRunOpen, taskCardRects, maxCount]);

  // Tick loop — advance each mascot's script (throttled to ~30fps to avoid React thrash)
  uME(() => {
    let alive = true;
    let last = performance.now();
    const tick = () => {
      if (!alive) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setMascots(prev => prev.map(m => stepMascot(m, dt, world.surfaces, world.ladders, speed)));
    };
    const id = setInterval(tick, 33); // ~30fps
    return () => { alive = false; clearInterval(id); };
  }, [world, speed]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", inset: 0,
        pointerEvents: "none", zIndex: 35, overflow: "hidden"
      }}
    >
      {/* Workshops */}
      {(world.workshops || []).map((w, i) => (
        <Workshop key={`ws-${w.kind}-${i}`} kind={w.kind} x={w.x} y={w.y} size={64} />
      ))}

      {/* Ladders */}
      {Object.entries(world.ladders).map(([id, L]) => (
        <Ladder key={id} x={L.x} y1={L.y1} y2={L.y2} />
      ))}

      {/* Mascots */}
      {mascots.map(m => {
        const fps = m.spriteTask === "walking" ? 10
                  : m.spriteTask === "climbing" ? 8
                  : m.spriteTask === "celebrating" ? 12
                  : 6;
        const sx = m.x - SPRITE_W / 2;
        const sy = m.y - FEET_OFFSET;
        return (
          <div
            key={m.id}
            style={{
              position: "absolute", left: 0, top: 0,
              transform: `translate(${sx}px, ${sy}px)`,
              width: SPRITE_W, height: SPRITE_W,
              pointerEvents: "auto"
            }}
            title={`${m.group} · ${m.spriteTask}${m.carrying ? " · carrying " + m.carrying : ""}`}
          >
            <PixelMascot
              task={m.spriteTask || "idle"}
              group={m.group}
              agent={m.agent}
              facing={m.facing || 1}
              carrying={m.carrying}
              size={SPRITE_W}
              fps={fps}
            />
          </div>
        );
      })}
    </div>
  );
}

/* =========================================================
   <MascotDock> — single-mascot version for the design doc gallery
   ========================================================= */
function MascotDock({ task = "idle", group = "Default", size = 64, carrying = null }) {
  return (
    <div style={{ width: size, height: size }}>
      <PixelMascot task={task} group={group} size={size} fps={3} carrying={carrying} />
    </div>
  );
}

Object.assign(window, {
  PixelMascot, MascotWorld, MascotDock, Ladder, Workshop, CARRY_ICONS, WORKSHOP_PIXELS, OUTFITS, SPRITE_W
});
