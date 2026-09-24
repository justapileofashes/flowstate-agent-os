// Evaluation metrics shared by the trainer, backtester and shadow evaluator.

/** ROC AUC via the rank (Mann–Whitney U) formulation, ties averaged. */
export function auc(y: number[], p: number[]): number {
  const n = y.length;
  const pos = y.reduce((a, b) => a + (b ? 1 : 0), 0);
  const neg = n - pos;
  if (pos === 0 || neg === 0) return 0.5;
  const order = p.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]![0] === order[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]![1]] = r;
    i = j + 1;
  }
  let sumPos = 0;
  for (let k = 0; k < n; k++) if (y[k]) sumPos += ranks[k]!;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Hit rate among the top 10 % most confident "up" predictions. */
export function topDecileHitRate(y: number[], p: number[]): number {
  if (!y.length) return 0;
  const idx = p.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const k = Math.max(1, Math.floor(idx.length / 10));
  let hits = 0;
  for (let j = 0; j < k; j++) hits += y[idx[j]![1]] ? 1 : 0;
  return hits / k;
}

/** Annualized Sharpe of per-period returns (fractions, not %). */
export function sharpe(returns: number[], periodsPerYear: number): number {
  const r = returns.filter(Number.isFinite);
  if (r.length < 2) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  const sd = Math.sqrt(v);
  if (sd < 1e-12) return 0;
  return (m / sd) * Math.sqrt(periodsPerYear);
}

/** Max peak-to-trough drawdown of an equity series, in % (positive number). */
export function maxDrawdownPct(equity: number[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    if (peak > 0) dd = Math.max(dd, (peak - e) / peak);
  }
  return dd * 100;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Population stability index between two samples of probabilities
 * (drift monitor). 10 equal-width buckets on [0, 1].
 */
export function psi(expected: number[], actual: number[]): number {
  if (!expected.length || !actual.length) return 0;
  const bucket = (xs: number[]): number[] => {
    const c = new Array(10).fill(0);
    for (const x of xs) c[Math.min(9, Math.max(0, Math.floor(x * 10)))] += 1;
    return c.map((v) => Math.max(1e-4, v / xs.length));
  };
  const e = bucket(expected);
  const a = bucket(actual);
  let s = 0;
  for (let i = 0; i < 10; i++) s += (a[i]! - e[i]!) * Math.log(a[i]! / e[i]!);
  return s;
}
