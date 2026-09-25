// Alert rules (spec §2.9): circuit-breaker trips, fill-failure streaks, model
// drift (confidence distribution shift), data gaps; plus broker errors and
// repeated aborted cycles. Alerts are de-duplicated per key while open and
// delivered to the in-app feed, a desktop notification and an optional
// webhook.

import type { AlertDto, TraderConfig } from '@shared/trader/types';
import type { TraderDb } from '../db';
import { mean, psi } from '../model/metrics';

export interface AlertSink {
  (alert: AlertDto): void;
}

export interface AlertInputs {
  now: number;
  config: TraderConfig;
  /** Worst staleness per symbol (ms) where a bar was expected. */
  staleness: Array<{ symbol: string; timeframe: string; ms: number }>;
  reconcileErrors: string[];
}

export class AlertEngine {
  constructor(
    private readonly db: TraderDb,
    private readonly sink: AlertSink,
  ) {}

  raise(a: { key: string; severity: AlertDto['severity']; title: string; detail: string }, now: number, dedupeMs?: number): AlertDto | null {
    const alert = this.db.ops.raiseAlert(a, now, dedupeMs);
    if (alert) this.sink(alert);
    return alert;
  }

  evaluate(input: AlertInputs): AlertDto[] {
    const out: AlertDto[] = [];
    const push = (a: AlertDto | null): void => {
      if (a) out.push(a);
    };
    const { now, config } = input;

    // Data gap > threshold (never trade on stale features — the risk engine blocks those symbols).
    const gaps = input.staleness.filter((s) => s.ms > config.monitor.dataGapMs);
    if (gaps.length) {
      push(
        this.raise(
          {
            key: 'data_gap',
            severity: 'warning',
            title: `Market data gap on ${gaps.length} symbol(s)`,
            detail: gaps
              .slice(0, 10)
              .map((g) => `${g.symbol} ${g.timeframe}: ${Math.round(g.ms / 1000)}s late`)
              .join(', ') + '. Trading on these symbols is blocked until data resumes.',
          },
          now,
        ),
      );
    }

    // Fill-failure streak.
    const recent = this.db.oms.recentTerminal(Math.max(10, config.monitor.fillFailureStreak));
    let streak = 0;
    for (const o of recent) {
      if (o.status === 'failed' || o.status === 'rejected') streak += 1;
      else break;
    }
    if (streak >= config.monitor.fillFailureStreak) {
      push(
        this.raise(
          {
            key: 'fill_failures',
            severity: 'critical',
            title: `${streak} consecutive order failures`,
            detail: recent
              .slice(0, streak)
              .map((o) => `${o.symbol} ${o.side}: ${o.error ?? o.status}`)
              .join(' | '),
          },
          now,
        ),
      );
    }

    // Model drift: mean confidence of live scores (last 24h) vs the prior 7 days.
    const recentConf = this.db.ops.series('trader_model_confidence_sample', now - 86_400_000).map((s) => s.value);
    const baseConf = this.db.ops
      .series('trader_model_confidence_sample', now - 8 * 86_400_000)
      .filter((s) => s.ts < now - 86_400_000)
      .map((s) => s.value);
    if (recentConf.length >= 30 && baseConf.length >= 100) {
      const m1 = mean(recentConf);
      const m0 = mean(baseConf);
      const shift = m0 > 0 ? (Math.abs(m1 - m0) / m0) * 100 : 0;
      const p = psi(baseConf.map((c) => (c - 0.5) * 2), recentConf.map((c) => (c - 0.5) * 2));
      if (shift > config.monitor.driftThresholdPct || p > 0.25) {
        push(
          this.raise(
            {
              key: 'model_drift',
              severity: 'warning',
              title: 'Model confidence drift',
              detail: `Mean confidence ${m1.toFixed(3)} (24h) vs ${m0.toFixed(3)} (prior 7d): shift ${shift.toFixed(1)}% (threshold ${config.monitor.driftThresholdPct}%), PSI ${p.toFixed(3)}. Consider a retrain.`,
            },
            now,
            6 * 3_600_000,
          ),
        );
      }
    }

    if (input.reconcileErrors.length) {
      push(this.raise({ key: 'broker_errors', severity: 'warning', title: 'Broker reconciliation errors', detail: input.reconcileErrors.slice(0, 5).join(' | ') }, now));
    }

    const cycles = this.db.runs.cycles(5, { excludeSkipped: true });
    if (cycles.length === 5 && cycles.every((c) => c.status === 'aborted')) {
      push(this.raise({ key: 'cycle_aborts', severity: 'critical', title: '5 consecutive aborted cycles', detail: cycles.map((c) => c.abortReason ?? '').join(' | ') }, now));
    }
    return out;
  }
}
