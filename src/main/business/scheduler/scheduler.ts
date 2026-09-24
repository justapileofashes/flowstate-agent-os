// Lease-based scheduler (spec Phase 6; Redis/BullMQ replaced by an
// in-process ticker + biz_cron_state leases). Per active company:
//   morning:<id>        daily at config.schedule.morning → plan + execute
//   evening:<id>        daily at config.schedule.evening → digest + drift
//   role:<id>:<role>    agent_configs.schedule_cron (5-field cron)
//   grant:<id>          1st of each month → monthly credit allowance
// Every tick also applies elapsed objection windows. A job runs only if its
// lease is free, so overlapping ticks (or a slow cycle) never double-start.
// Missed runs later than the company's catch-up window are skipped and
// rescheduled (spec: 15-min skew window, configurable). Paused/archived
// companies and the global kill switch skip everything.

import { randomUUID } from 'node:crypto';
import type { CompanyDto, RoleKey } from '@shared/business/types';
import type { BizDb } from '../db';
import type { ActionGate } from '../guardrails/approval';
import type { CycleRunner } from '../agent/orchestrator';
import { nextCron } from '@main/util/cron';
import { LIMITS } from '../config';

export interface ScheduledJob {
  name: string;
  companyId: string;
  kind: 'morning' | 'evening' | 'role' | 'grant';
  role?: RoleKey;
  label: string;
  next(from: number): number;
}

export function nextDaily(hhmm: string, from: number): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(from);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function nextMonthStart(from: number): number {
  const d = new Date(from);
  d.setDate(1);
  d.setHours(0, 5, 0, 0);
  if (d.getTime() <= from) d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

export function monthKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface SchedulerDeps {
  db: BizDb;
  runner: CycleRunner;
  gate: ActionGate;
  /** Global kill switch (settings). */
  enabled: () => boolean;
  grantMonthly: (companyId: string, at: number) => void;
  onSkip?: (companyId: string, text: string) => void;
  now?: () => number;
}

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly holder = `sched-${randomUUID()}`;
  private readonly inflight = new Set<Promise<unknown>>();
  private ticking = false;
  private readonly now: () => number;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now;
  }

  jobsFor(company: CompanyDto): ScheduledJob[] {
    const jobs: ScheduledJob[] = [
      {
        name: `grant:${company.id}`,
        companyId: company.id,
        kind: 'grant',
        label: 'Monthly credit grant',
        next: nextMonthStart,
      },
    ];
    const s = company.config.schedule;
    if (!s.enabled) return jobs;
    jobs.push(
      {
        name: `morning:${company.id}`,
        companyId: company.id,
        kind: 'morning',
        label: `Morning plan (${s.morning})`,
        next: (from) => nextDaily(s.morning, from),
      },
      {
        name: `evening:${company.id}`,
        companyId: company.id,
        kind: 'evening',
        label: `Evening summary (${s.evening})`,
        next: (from) => nextDaily(s.evening, from),
      },
    );
    for (const a of this.deps.db.companies.agentConfigs(company.id)) {
      if (!a.enabled || !a.scheduleCron.trim() || a.role === 'ceo') continue;
      const expr = a.scheduleCron.trim();
      jobs.push({
        name: `role:${company.id}:${a.role}`,
        companyId: company.id,
        kind: 'role',
        role: a.role,
        label: `${a.role} (${expr})`,
        next: (from) => nextCron(expr, from),
      });
    }
    return jobs;
  }

  /** Upcoming runs for the dashboard. */
  nextRuns(companyId: string): Array<{ job: string; at: number }> {
    const company = this.deps.db.companies.get(companyId);
    if (!company || company.status !== 'active') return [];
    return this.jobsFor(company)
      .filter((j) => j.kind !== 'grant')
      .map((j) => ({ job: j.label, at: this.deps.db.ops.cronState(j.name)?.nextRunAt ?? j.next(this.now()) }))
      .sort((a, b) => a.at - b.at);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (!this.deps.enabled()) return;
      await this.deps.gate.sweepObjectionWindows();
      for (const company of this.deps.db.companies.list()) {
        const jobs = this.jobsFor(company);
        this.pruneStale(company.id, jobs);
        if (company.status !== 'active') continue;
        for (const job of jobs) this.maybeRun(company, job);
      }
    } finally {
      this.ticking = false;
    }
  }

  private pruneStale(companyId: string, jobs: ScheduledJob[]): void {
    const names = new Set(jobs.map((j) => j.name));
    for (const st of this.deps.db.ops.cronStates(companyId)) {
      if (!names.has(st.jobName) && !st.lockHolder) this.deps.db.ops.deleteCron(st.jobName);
    }
  }

  private maybeRun(company: CompanyDto, job: ScheduledJob): void {
    const ops = this.deps.db.ops;
    const now = this.now();
    const st = ops.ensureCron(job.name, company.id, job.next(now));
    if (st.nextRunAt === null || st.nextRunAt > now) return;
    const lateBy = now - st.nextRunAt;
    const windowMs = company.config.schedule.catchUpMinutes * 60_000;
    if (job.kind !== 'grant' && lateBy > windowMs) {
      ops.setNextRun(job.name, job.next(now));
      const mins = Math.round(lateBy / 60_000);
      this.deps.onSkip?.(
        company.id,
        `Skipped ${job.label}: missed by ${mins >= 120 ? `${Math.round(mins / 60)}h` : `${mins}m`} (catch-up window ${company.config.schedule.catchUpMinutes}m). Run it manually if you need it.`,
      );
      return;
    }
    if (!ops.acquireLease(job.name, this.holder, LIMITS.cycleWallClockMs + LIMITS.leaseMarginMs, now)) return;
    const trigger = lateBy > 60_000 ? 'catchup' : 'schedule';
    const p = this.runJob(company, job, trigger)
      .then(
        () => ops.releaseLease(job.name, this.holder, { ranAt: now, nextRunAt: job.next(this.now()), succeeded: true }),
        (err: unknown) =>
          ops.releaseLease(job.name, this.holder, {
            ranAt: now,
            nextRunAt: job.next(this.now()),
            succeeded: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      )
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  private async runJob(company: CompanyDto, job: ScheduledJob, trigger: 'schedule' | 'catchup'): Promise<void> {
    if (job.kind === 'grant') {
      this.deps.grantMonthly(company.id, this.now());
      return;
    }
    const kind = job.kind === 'role' ? 'role' : job.kind;
    const r = this.deps.runner.begin(company.id, kind, trigger, job.role ? { role: job.role } : {});
    if ('error' in r) throw new Error(r.error);
    if (r.alreadyRunning) return; // another cycle is running — this slot is satisfied by it
    await r.done;
  }

  /** Wait for jobs started by previous ticks (tests + shutdown). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  start(intervalMs: number = LIMITS.schedulerTickMs): void {
    this.stop();
    this.timer = setInterval(() => void this.tick().catch(() => undefined), intervalMs);
    setTimeout(() => void this.tick().catch(() => undefined), 5_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
