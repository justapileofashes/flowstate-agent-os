// In-process metrics registry (counters, gauges, histograms) with Prometheus
// text exposition. Gauges/counters are snapshotted into trader_metrics every
// tick so the Monitor tab can chart them without Prometheus/Grafana.

import type { MetricsSnapshotDto } from '@shared/trader/types';

type Labels = Record<string, string>;

const labelKey = (labels: Labels): string =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');

const escape = (v: string): string => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

function promLabels(labels: Labels): string {
  const keys = Object.keys(labels);
  return keys.length ? `{${keys.sort().map((k) => `${k}="${escape(labels[k]!)}"`).join(',')}}` : '';
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

export const METRIC_HELP: Record<string, string> = {
  trader_orders_total: 'Orders by final status',
  trader_order_success_ratio: 'Filled / (filled + failed + rejected) over the last 24h',
  trader_fill_latency_ms: 'Submit → first fill latency',
  trader_slippage_bps: 'Actual fill vs assumed price, basis points (+ = worse)',
  trader_signal_confidence: 'Confidence of emitted signals',
  trader_model_confidence: 'max(p, 1−p) of every live model score',
  trader_daily_pnl: 'Realized + unrealized P&L today (active account)',
  trader_equity: 'Account equity (active account)',
  trader_gross_exposure_pct: 'Gross exposure as % of equity',
  trader_open_positions: 'Open positions (active account)',
  trader_risk_rejections_total: 'Risk-engine rejections by rule',
  trader_agent_errors_total: 'Orchestrator node failures by node',
  trader_tick_duration_ms: 'Orchestrator tick duration',
  trader_signal_to_order_ms: 'Signal → order submitted latency',
  trader_llm_calls_total: 'LLM calls made by the orchestrator',
  trader_data_max_staleness_ms: 'Worst data staleness across the universe',
  trader_stale_symbols: 'Symbols whose data is stale',
  trader_cycles_total: 'Orchestrator cycles by status',
};

export class Metrics {
  private readonly counters = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly gauges = new Map<string, { name: string; labels: Labels; value: number }>();
  private readonly hist = new Map<string, { name: string; labels: Labels; values: number[]; count: number; sum: number }>();

  inc(name: string, labels: Labels = {}, by = 1): void {
    const k = `${name}|${labelKey(labels)}`;
    const c = this.counters.get(k) ?? { name, labels, value: 0 };
    c.value += by;
    this.counters.set(k, c);
  }

  set(name: string, value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value)) return;
    this.gauges.set(`${name}|${labelKey(labels)}`, { name, labels, value });
  }

  observe(name: string, value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value)) return;
    const k = `${name}|${labelKey(labels)}`;
    const h = this.hist.get(k) ?? { name, labels, values: [], count: 0, sum: 0 };
    h.values.push(value);
    if (h.values.length > 1000) h.values.splice(0, h.values.length - 1000);
    h.count += 1;
    h.sum += value;
    this.hist.set(k, h);
  }

  histogramValues(name: string): number[] {
    const out: number[] = [];
    for (const h of this.hist.values()) if (h.name === name) out.push(...h.values);
    return out;
  }

  snapshot(): Omit<MetricsSnapshotDto, 'series'> {
    return {
      counters: [...this.counters.values()].map((c) => ({ name: c.name, labels: c.labels, value: c.value })),
      gauges: [...this.gauges.values()].map((g) => ({ name: g.name, labels: g.labels, value: g.value })),
      histograms: [...this.hist.values()].map((h) => {
        const s = [...h.values].sort((a, b) => a - b);
        return { name: h.name, labels: h.labels, count: h.count, sum: h.sum, p50: quantile(s, 0.5), p95: quantile(s, 0.95) };
      }),
    };
  }

  /** Samples to persist each tick (gauges + counters). */
  samples(): Array<{ name: string; labels: string; value: number }> {
    return [
      ...[...this.gauges.values()].map((g) => ({ name: g.name, labels: labelKey(g.labels), value: g.value })),
      ...[...this.counters.values()].map((c) => ({ name: c.name, labels: labelKey(c.labels), value: c.value })),
    ];
  }

  prometheus(): string {
    const lines: string[] = [];
    const seen = new Set<string>();
    const head = (name: string, type: string): void => {
      if (seen.has(name)) return;
      seen.add(name);
      if (METRIC_HELP[name]) lines.push(`# HELP ${name} ${METRIC_HELP[name]}`);
      lines.push(`# TYPE ${name} ${type}`);
    };
    for (const c of this.counters.values()) {
      head(c.name, 'counter');
      lines.push(`${c.name}${promLabels(c.labels)} ${c.value}`);
    }
    for (const g of this.gauges.values()) {
      head(g.name, 'gauge');
      lines.push(`${g.name}${promLabels(g.labels)} ${g.value}`);
    }
    for (const h of this.hist.values()) {
      head(h.name, 'summary');
      const s = [...h.values].sort((a, b) => a - b);
      for (const q of [0.5, 0.9, 0.99]) lines.push(`${h.name}${promLabels({ ...h.labels, quantile: String(q) })} ${quantile(s, q)}`);
      lines.push(`${h.name}_sum${promLabels(h.labels)} ${h.sum}`);
      lines.push(`${h.name}_count${promLabels(h.labels)} ${h.count}`);
    }
    return lines.join('\n') + '\n';
  }
}
