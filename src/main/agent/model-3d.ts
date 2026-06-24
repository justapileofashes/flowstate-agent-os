// 3D modelling tool support — turns a structured primitive scene into:
//   1. a self-contained interactive Three.js HTML viewer (orbit + lights +
//      grid) the user can preview in the Artifact view, and
//   2. an OpenSCAD source file for parametric CAD export / 3D printing.
//
// No runtime deps in the main process — everything is string generation.
// The viewer pulls Three.js from a CDN; the Artifact iframe runs with
// `allow-scripts`, which permits remote <script src> loads.

import { z } from 'zod';

const vec3 = z
  .array(z.number())
  .length(3)
  .or(z.tuple([z.number(), z.number(), z.number()]));

export const primitiveSchema = z.object({
  type: z.enum(['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane']),
  /** Per-type dimensions. Unused fields ignored. All default to 1. */
  size: vec3.optional(), // box: [w,h,d]; plane: [w,_,d]
  radius: z.number().positive().optional(), // sphere/cylinder/cone/torus
  height: z.number().positive().optional(), // cylinder/cone
  tube: z.number().positive().optional(), // torus tube radius
  position: vec3.optional(),
  rotation: vec3.optional(), // degrees, XYZ
  color: z.string().optional(), // hex like #b0a080
});

export const sceneSchema = z.object({
  name: z.string().min(1).max(80).default('model'),
  background: z.string().optional(), // hex
  primitives: z.array(primitiveSchema).min(1).max(200),
});

export type Scene = z.infer<typeof sceneSchema>;
type Primitive = z.infer<typeof primitiveSchema>;

function asVec(v: number[] | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!v || v.length !== 3) return fallback;
  return [v[0]!, v[1]!, v[2]!];
}

function safeColor(c: string | undefined, fallback: string): string {
  if (typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
  return fallback;
}

// ── Three.js viewer ─────────────────────────────────────────────────────────

function threeGeometry(p: Primitive): string {
  switch (p.type) {
    case 'box': {
      const [w, h, d] = asVec(p.size, [1, 1, 1]);
      return `new THREE.BoxGeometry(${w}, ${h}, ${d})`;
    }
    case 'sphere':
      return `new THREE.SphereGeometry(${p.radius ?? 0.5}, 32, 24)`;
    case 'cylinder':
      return `new THREE.CylinderGeometry(${p.radius ?? 0.5}, ${p.radius ?? 0.5}, ${p.height ?? 1}, 32)`;
    case 'cone':
      return `new THREE.ConeGeometry(${p.radius ?? 0.5}, ${p.height ?? 1}, 32)`;
    case 'torus':
      return `new THREE.TorusGeometry(${p.radius ?? 0.5}, ${p.tube ?? 0.18}, 16, 48)`;
    case 'plane': {
      const [w, , d] = asVec(p.size, [2, 0, 2]);
      return `new THREE.PlaneGeometry(${w}, ${d})`;
    }
    default:
      return 'new THREE.BoxGeometry(1,1,1)';
  }
}

const DEG = Math.PI / 180;

export function buildThreeViewer(scene: Scene): string {
  const bg = safeColor(scene.background, '#14110d');
  const meshes = scene.primitives
    .map((p, i) => {
      const geom = threeGeometry(p);
      const color = safeColor(p.color, '#cdbfa0');
      const [px, py, pz] = asVec(p.position, [0, 0, 0]);
      const [rx, ry, rz] = asVec(p.rotation, [0, 0, 0]);
      // Plane auto-lays flat unless rotation given.
      const planeFlat = p.type === 'plane' && !p.rotation ? `m${i}.rotation.x = -Math.PI/2;` : '';
      return `
    const g${i} = ${geom};
    const mat${i} = new THREE.MeshStandardMaterial({ color: '${color}', roughness: 0.55, metalness: 0.1 });
    const m${i} = new THREE.Mesh(g${i}, mat${i});
    m${i}.position.set(${px}, ${py}, ${pz});
    m${i}.rotation.set(${(rx * DEG).toFixed(4)}, ${(ry * DEG).toFixed(4)}, ${(rz * DEG).toFixed(4)});
    ${planeFlat}
    m${i}.castShadow = true; m${i}.receiveShadow = true;
    scene.add(m${i});`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(scene.name)} — 3D model</title>
<style>
  html,body { margin:0; height:100%; background:${bg}; overflow:hidden; font-family: ui-monospace, monospace; }
  #label { position:fixed; left:10px; bottom:8px; color:#a09a8e; font-size:11px; letter-spacing:.08em; text-transform:uppercase; user-select:none; }
  canvas { display:block; }
</style>
</head>
<body>
<div id="label">${escapeHtml(scene.name)} · drag to orbit · scroll to zoom</div>
<script src="https://unpkg.com/three@0.136.0/build/three.min.js"></script>
<script src="https://unpkg.com/three@0.136.0/examples/js/controls/OrbitControls.js"></script>
<script>
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('${bg}');

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 1000);
  camera.position.set(4, 3.2, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const key = new THREE.DirectionalLight(0xfff4e0, 1.1);
  key.position.set(5, 8, 4); key.castShadow = true; scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  scene.add(new THREE.HemisphereLight(0xddd6c4, 0x33302a, 0.5));

  const grid = new THREE.GridHelper(20, 20, 0x3a362f, 0x26241f);
  scene.add(grid);
${meshes}

  let controls;
  if (THREE.OrbitControls) {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
  }

  // Auto-frame the model.
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) || 2;
  camera.position.copy(center).add(new THREE.Vector3(radius*1.6, radius*1.2, radius*1.8));
  if (controls) { controls.target.copy(center); controls.update(); } else { camera.lookAt(center); }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  (function tick(){ requestAnimationFrame(tick); if (controls) controls.update(); renderer.render(scene, camera); })();
</script>
</body>
</html>`;
}

// ── OpenSCAD export ─────────────────────────────────────────────────────────

function scadShape(p: Primitive): string {
  switch (p.type) {
    case 'box': {
      const [w, h, d] = asVec(p.size, [1, 1, 1]);
      return `cube([${w}, ${d}, ${h}], center=true);`;
    }
    case 'sphere':
      return `sphere(r=${p.radius ?? 0.5}, $fn=64);`;
    case 'cylinder':
      return `cylinder(h=${p.height ?? 1}, r=${p.radius ?? 0.5}, center=true, $fn=64);`;
    case 'cone':
      return `cylinder(h=${p.height ?? 1}, r1=${p.radius ?? 0.5}, r2=0, center=true, $fn=64);`;
    case 'torus': {
      const r = p.radius ?? 0.5;
      const t = p.tube ?? 0.18;
      return `rotate_extrude($fn=64) translate([${r}, 0, 0]) circle(r=${t}, $fn=32);`;
    }
    case 'plane': {
      const [w, , d] = asVec(p.size, [2, 0, 2]);
      return `cube([${w}, ${d}, 0.01], center=true);`;
    }
    default:
      return `cube([1,1,1], center=true);`;
  }
}

export function buildOpenSCAD(scene: Scene): string {
  const parts = scene.primitives
    .map((p, i) => {
      // OpenSCAD: Z is up. Our viewer uses Y up. Swap Y<->Z for position +
      // rotation so the SCAD export sits the right way for printing.
      const [px, py, pz] = asVec(p.position, [0, 0, 0]);
      const [rx, ry, rz] = asVec(p.rotation, [0, 0, 0]);
      const color = safeColor(p.color, '#cdbfa0');
      return `// part ${i + 1}: ${p.type}
color("${color}")
translate([${px}, ${pz}, ${py}])
rotate([${rx}, ${rz}, ${ry}])
${scadShape(p)}`;
    })
    .join('\n\n');
  return `// ${scene.name} — generated by Flowstate 3D modelling tool
// Open in OpenSCAD (https://openscad.org) to tweak + export STL.
$fn = 64;

${parts}
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
