// Scheduler: a 15-second heartbeat that
//   - runs one orchestrator tick per closed bar of the smallest enabled
//     timeframe (bar close + tickDelaySec), under a single-flight lease, when
//     the autopilot is on and a market is open;
//   - otherwise keeps reconciling (fills, stops, time exits still matter when
//     the AI is off or the market is closed);
//   - fires the nightly incremental retrain, the weekly full retrain, the
//     daily shadow evaluation + promotion policy, and retention pruning.

import { TIMEFRAME_MS, type Timeframe, type TraderConfig } from '@shared/trader/types';
import { nextCron } from '@main/util/cron';
import type { TraderDb } from './db';
import { etParts, isMarketOpen, sessionFor } from './data/calendar';

export interface SchedulerDeps {
  db: TraderDb;
  config: () => TraderConfig;
  now: () => number;
  autopilot: () => boolean;
  anyMarketOpen: () => boolean;
  tick: () => Promise<unknown>;
  reconcile: () => Promise<unknown>;
  retrain: (kind: 'full' | 'incremental') => Promise<unknown>;
  dailyReview: (dayStart: number, dayEnd: number, day: string) => Promise<unknown>;
  housekeeping: () => Promise<unknown>;
  log?: (msg: string) => void;
  heartbeatMs?: number;
}

const HOLDER = `sched-${process.pid}`;

export class TraderScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.beat(), this.deps.heartbeatMs ?? 15_000);
    setTimeout(() => void this.beat(), 2_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private smallestTf(): Timeframe {
    const tfs = this.deps.config().models.specs.filter((s) => s.enabled).map((s) => s.timeframe);
    return (tfs.sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b])[0] ?? '15m') as Timeframe;
  }

  /** When the next scheduled tick is due. */
  nextTickAt(now = this.deps.now()): number {
    const tf = TIMEFRAME_MS[this.smallestTf()];
    const delay = this.deps.config().schedule.tickDelaySec * 1000;
    const boundary = Math.floor(now / tf) * tf;
    const last = this.deps.db.ops.get<number>('sched:last_boundary', 0);
    const due = boundary + delay;
    return last < boundary ? due : boundary + tf + delay;
  }

  /** One heartbeat; exposed for tests. */
  async beat(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const now = this.deps.now();
    try {
      await this.cron('retrain_nightly', this.deps.config().models.nightlyRetrainCron, now, () => this.deps.retrain('incremental'));
      await this.cron('retrain_weekly', this.deps.config().models.weeklyRetrainCron, now, () => this.deps.retrain('full'));
      await this.daily(now);

      const tf = TIMEFRAME_MS[this.smallestTf()];
      const boundary = Math.floor(now / tf) * tf;
      const last = this.deps.db.ops.get<number>('sched:last_boundary', 0);
      const delay = this.deps.config().schedule.tickDelaySec * 1000;
      if (last >= boundary || now < boundary + delay) return;
      if (!this.deps.db.ops.tryLease('lease:tick', HOLDER, now, 5 * 60_000)) return;
      try {
        this.deps.db.ops.set('sched:last_boundary', boundary, now);
        if (this.deps.autopilot() && this.deps.anyMarketOpen()) await this.deps.tick();
        else await this.deps.reconcile();
      } finally {
        this.deps.db.ops.releaseLease('lease:tick', HOLDER);
      }
    } catch (err) {
      this.deps.log?.(`[trader] scheduler: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.busy = false;
    }
  }

  private async cron(name: string, expr: string, now: number, run: () => Promise<unknown>): Promise<void> {
    const key = `cron:${name}`;
    const last = this.deps.db.ops.get<number>(key, 0);
    if (!last) {
      this.deps.db.ops.set(key, now, now); // first boot: schedule from now, don't fire immediately
      return;
    }
    if (nextCron(expr, last) > now) return;
    this.deps.db.ops.set(key, now, now);
    try {
      await run();
    } catch (err) {
      this.deps.log?.(`[trader] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** After the US session closes (or at local midnight on non-trading days): shadow eval, policy, housekeeping. */
  private async daily(now: number): Promise<void> {
    const p = etParts(now);
    const key = 'daily:last';
    if (this.deps.db.ops.get<string>(key, '') === p.date) return;
    const s = sessionFor(now);
    const afterClose = s ? now >= s.close + 30 * 60_000 : p.hh >= 18;
    if (!afterClose || isMarketOpen('us_equity', now)) return;
    this.deps.db.ops.set(key, p.date, now);
    const dayStart = s ? s.open - 9.5 * 3_600_000 : now - 86_400_000;
    const dayEnd = s ? s.close + 1 : now;
    try {
      await this.deps.dailyReview(dayStart, dayEnd, p.date);
      await this.deps.housekeeping();
    } catch (err) {
      this.deps.log?.(`[trader] daily review: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
