// Gradient-boosted decision trees for binary classification (logistic loss),
// the TypeScript stand-in for LightGBM:
//   - quantile histogram binning (≤ `bins` per feature), second-order splits
//     (gain = G²/(H+λ) … like XGBoost/LightGBM), depth-limited trees,
//     min-samples-per-leaf, row subsampling, L2 on leaf weights;
//   - deterministic (seeded RNG) and JSON-serializable, so a model's sha256
//     identifies it exactly;
//   - warm start (`continueFrom`) adds trees on new data with the existing bin
//     edges — the weekly "micro-update" from the replay buffer;
//   - optional early stopping on a validation set.
// Training yields to the event loop between trees so the Electron main
// process stays responsive.

import { createHash } from 'node:crypto';
import type { GbdtParams } from '@shared/trader/types';

interface SplitNode {
  f: number;
  /** Bin index: bin ≤ b goes left. */
  b: number;
  /** Raw threshold: x ≤ t goes left (prediction path). */
  t: number;
  l: number;
  r: number;
}
interface LeafNode {
  v: number;
}
type TreeNode = SplitNode | LeafNode;

export interface GbdtModel {
  kind: 'gbdt-binary';
  format: 1;
  featureNames: string[];
  params: GbdtParams;
  baseScore: number;
  edges: number[][];
  trees: TreeNode[][];
  importances: number[];
  seed: number;
}

export interface TrainOptions {
  params: GbdtParams;
  featureNames: string[];
  seed?: number;
  validation?: { X: number[][]; y: number[] };
  /** Stop when validation log-loss hasn't improved for this many trees. */
  earlyStoppingRounds?: number;
  /** Override tree count (e.g. refit with the best iteration). */
  trees?: number;
  continueFrom?: GbdtModel;
  yieldEvery?: number;
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Quantile cut points (ascending, unique). A value goes to the first bin whose edge ≥ value. */
export function computeEdges(X: number[][], nFeatures: number, bins: number): number[][] {
  const edges: number[][] = [];
  for (let f = 0; f < nFeatures; f++) {
    const col = X.map((r) => r[f]!).filter(Number.isFinite).sort((a, b) => a - b);
    const cuts: number[] = [];
    for (let k = 1; k < bins; k++) {
      const v = col[Math.min(col.length - 1, Math.floor((k / bins) * col.length))];
      if (v !== undefined && (cuts.length === 0 || v > cuts[cuts.length - 1]!)) cuts.push(v);
    }
    edges.push(cuts);
  }
  return edges;
}

function binOf(x: number, e: number[]): number {
  // first k with x <= e[k]; else e.length
  let lo = 0;
  let hi = e.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x <= e[mid]!) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function binMatrix(X: number[][], edges: number[][]): Uint8Array[] {
  const nF = edges.length;
  const cols: Uint8Array[] = [];
  for (let f = 0; f < nF; f++) {
    const col = new Uint8Array(X.length);
    const e = edges[f]!;
    for (let i = 0; i < X.length; i++) col[i] = binOf(X[i]![f]!, e);
    cols.push(col);
  }
  return cols;
}

function predictTreeRaw(tree: TreeNode[], x: number[]): number {
  let n = 0;
  for (;;) {
    const node = tree[n]!;
    if ('v' in node) return node.v;
    n = x[node.f]! <= node.t ? node.l : node.r;
  }
}

function predictTreeBinned(tree: TreeNode[], bins: Uint8Array[], i: number): number {
  let n = 0;
  for (;;) {
    const node = tree[n]!;
    if ('v' in node) return node.v;
    n = bins[node.f]![i]! <= node.b ? node.l : node.r;
  }
}

export function predictMargin(model: GbdtModel, x: number[]): number {
  let z = model.baseScore;
  for (const t of model.trees) z += predictTreeRaw(t, x);
  return z;
}

export function predictProba(model: GbdtModel, x: number[]): number {
  return sigmoid(predictMargin(model, x));
}

export function predictMany(model: GbdtModel, X: number[][]): number[] {
  return X.map((x) => predictProba(model, x));
}

export function logLoss(y: number[], p: number[]): number {
  if (!y.length) return 0;
  let s = 0;
  for (let i = 0; i < y.length; i++) {
    const q = Math.min(1 - 1e-12, Math.max(1e-12, p[i]!));
    s += y[i] ? -Math.log(q) : -Math.log(1 - q);
  }
  return s / y.length;
}

export function modelHash(model: GbdtModel): string {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex');
}

export async function trainGbdt(X: number[][], y: number[], opts: TrainOptions): Promise<GbdtModel> {
  if (X.length !== y.length || X.length === 0) throw new Error('trainGbdt: empty or mismatched data');
  const nF = opts.featureNames.length;
  const params = opts.params;
  const seed = opts.seed ?? 42;
  const rand = mulberry32(seed + (opts.continueFrom?.trees.length ?? 0));
  const edges = opts.continueFrom?.edges ?? computeEdges(X, nF, params.bins);
  const bins = binMatrix(X, edges);
  const nBins = Math.max(...edges.map((e) => e.length + 1));
  const N = X.length;

  const model: GbdtModel = opts.continueFrom
    ? JSON.parse(JSON.stringify(opts.continueFrom))
    : {
        kind: 'gbdt-binary',
        format: 1,
        featureNames: [...opts.featureNames],
        params,
        baseScore: (() => {
          const p = Math.min(0.99, Math.max(0.01, y.reduce((a, b) => a + b, 0) / N));
          return Math.log(p / (1 - p));
        })(),
        edges,
        trees: [],
        importances: new Array(nF).fill(0),
        seed,
      };

  const F = new Float64Array(N);
  for (let i = 0; i < N; i++) F[i] = opts.continueFrom ? predictMargin(model, X[i]!) : model.baseScore;

  const val = opts.validation;
  const Fv = val ? Float64Array.from(val.X.map((x) => predictMargin(model, x))) : null;
  let bestLoss = Infinity;
  let bestTrees = model.trees.length;
  let sinceBest = 0;

  const g = new Float64Array(N);
  const h = new Float64Array(N);
  const nTrees = opts.trees ?? params.trees;
  const lambda = params.l2;
  const yieldEvery = opts.yieldEvery ?? 5;

  for (let m = 0; m < nTrees; m++) {
    for (let i = 0; i < N; i++) {
      const p = sigmoid(F[i]!);
      g[i] = p - y[i]!;
      h[i] = Math.max(1e-6, p * (1 - p));
    }
    // Row subsample for this tree.
    let rows: number[] = [];
    if (params.subsample < 1) {
      for (let i = 0; i < N; i++) if (rand() < params.subsample) rows.push(i);
      if (rows.length < params.minLeaf * 2) rows = Array.from({ length: N }, (_, i) => i);
    } else {
      rows = Array.from({ length: N }, (_, i) => i);
    }

    const tree: TreeNode[] = [];
    const grow = (idx: number[], depth: number): number => {
      let G = 0;
      let H = 0;
      for (const i of idx) {
        G += g[i]!;
        H += h[i]!;
      }
      const nodeId = tree.length;
      const leafValue = (-G / (H + lambda)) * params.learningRate;
      tree.push({ v: leafValue });
      if (depth >= params.depth || idx.length < params.minLeaf * 2) return nodeId;

      const parentScore = (G * G) / (H + lambda);
      let best: { f: number; b: number; gain: number } | null = null;
      const hg = new Float64Array(nBins);
      const hh = new Float64Array(nBins);
      const hc = new Int32Array(nBins);
      for (let f = 0; f < nF; f++) {
        const nb = edges[f]!.length + 1;
        if (nb < 2) continue;
        hg.fill(0, 0, nb);
        hh.fill(0, 0, nb);
        hc.fill(0, 0, nb);
        const col = bins[f]!;
        for (const i of idx) {
          const b = col[i]!;
          hg[b] = hg[b]! + g[i]!;
          hh[b] = hh[b]! + h[i]!;
          hc[b] = hc[b]! + 1;
        }
        let GL = 0;
        let HL = 0;
        let CL = 0;
        for (let b = 0; b < nb - 1; b++) {
          GL += hg[b]!;
          HL += hh[b]!;
          CL += hc[b]!;
          const CR = idx.length - CL;
          if (CL < params.minLeaf) continue;
          if (CR < params.minLeaf) break;
          const GR = G - GL;
          const HR = H - HL;
          const gain = (GL * GL) / (HL + lambda) + (GR * GR) / (HR + lambda) - parentScore;
          if (gain > 1e-9 && (!best || gain > best.gain)) best = { f, b, gain };
        }
      }
      if (!best) return nodeId;
      const left: number[] = [];
      const right: number[] = [];
      const col = bins[best.f]!;
      for (const i of idx) (col[i]! <= best.b ? left : right).push(i);
      model.importances[best.f] = (model.importances[best.f] ?? 0) + best.gain;
      const l = grow(left, depth + 1);
      const r = grow(right, depth + 1);
      tree[nodeId] = { f: best.f, b: best.b, t: edges[best.f]![best.b]!, l, r };
      return nodeId;
    };
    grow(rows, 0);
    model.trees.push(tree);
    for (let i = 0; i < N; i++) F[i] = F[i]! + predictTreeBinned(tree, bins, i);

    if (val && Fv && opts.earlyStoppingRounds) {
      for (let i = 0; i < val.X.length; i++) Fv[i] = Fv[i]! + predictTreeRaw(tree, val.X[i]!);
      const loss = logLoss(val.y, Array.from(Fv, sigmoid));
      if (loss < bestLoss - 1e-6) {
        bestLoss = loss;
        bestTrees = model.trees.length;
        sinceBest = 0;
      } else if (++sinceBest >= opts.earlyStoppingRounds) {
        break;
      }
    }
    if (yieldEvery > 0 && m % yieldEvery === yieldEvery - 1) await new Promise<void>((r) => setImmediate(r));
  }
  if (val && opts.earlyStoppingRounds && bestTrees < model.trees.length) model.trees = model.trees.slice(0, Math.max(1, bestTrees));
  return model;
}

export function importanceList(model: GbdtModel): Array<{ feature: string; gain: number }> {
  const total = model.importances.reduce((a, b) => a + b, 0) || 1;
  return model.featureNames
    .map((feature, i) => ({ feature, gain: Math.round(((model.importances[i] ?? 0) / total) * 10_000) / 10_000 }))
    .sort((a, b) => b.gain - a.gain);
}

/**
 * Per-feature contribution for one prediction (path attribution: each split
 * credits the change in the subtree's expected value to its feature). Used
 * for the deterministic "top drivers" rationale.
 */
export function contributions(model: GbdtModel, x: number[]): Array<{ feature: string; value: number; contribution: number }> {
  const contrib = new Array(model.featureNames.length).fill(0);
  for (const tree of model.trees) {
    // expected value of each node = mean of its leaves (unweighted approximation)
    const memo = new Map<number, number>();
    const expect = (n: number): number => {
      const cached = memo.get(n);
      if (cached !== undefined) return cached;
      const node = tree[n]!;
      const v = 'v' in node ? node.v : (expect(node.l) + expect(node.r)) / 2;
      memo.set(n, v);
      return v;
    };
    let n = 0;
    for (;;) {
      const node = tree[n]!;
      if ('v' in node) break;
      const next = x[node.f]! <= node.t ? node.l : node.r;
      contrib[node.f] += expect(next) - expect(n);
      n = next;
    }
  }
  return model.featureNames
    .map((feature, i) => ({ feature, value: x[i]!, contribution: contrib[i]! }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}
