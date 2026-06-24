// Live resource meters (roadmap 2b backend): CPU / RAM via node:os, GPU via
// nvidia-smi when present. Pure sampling/parsing helpers are exported for
// tests; SystemStatsService holds the previous CPU sample between snapshots
// so percentages reflect the polling interval, not boot-to-now.

import os from 'node:os';
import { execFile } from 'node:child_process';

export interface CpuSample {
  idle: number;
  total: number;
}

export interface GpuStats {
  name: string;
  utilPct: number;
  vramUsedMB: number;
  vramTotalMB: number;
}

export interface SystemStatsDto {
  at: number;
  cpuPct: number;
  ramUsedMB: number;
  ramTotalMB: number;
  gpu: GpuStats | null;
}

export function takeCpuSample(cpus: os.CpuInfo[] = os.cpus()): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total };
}

export function cpuPercent(prev: CpuSample, next: CpuSample): number {
  const elapsed = next.total - prev.total;
  if (elapsed <= 0) return 0;
  const idle = next.idle - prev.idle;
  const busy = ((elapsed - idle) / elapsed) * 100;
  return Math.min(100, Math.max(0, Math.round(busy)));
}

/** Parse `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total
 *  --format=csv,noheader,nounits`. First GPU wins on multi-GPU boxes. */
export function parseGpuStats(stdout: string): GpuStats | null {
  const line = stdout.trim().split(/\r?\n/)[0];
  if (!line) return null;
  const parts = line.split(',').map((s) => s.trim());
  if (parts.length < 4) return null;
  const utilPct = Number(parts[1]);
  const vramUsedMB = Number(parts[2]);
  const vramTotalMB = Number(parts[3]);
  if (![utilPct, vramUsedMB, vramTotalMB].every(Number.isFinite)) return null;
  return { name: parts[0]!, utilPct, vramUsedMB, vramTotalMB };
}

function queryNvidiaSmi(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const child = execFile(
      'nvidia-smi',
      ['--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (err, stdout) => {
        if (settled) return;
        settled = true;
        resolve(err ? '' : String(stdout));
      },
    );
    child.on('error', () => {
      if (settled) return;
      settled = true;
      resolve('');
    });
  });
}

export class SystemStatsService {
  private prevCpu: CpuSample = takeCpuSample();
  // nvidia-smi missing → stop shelling out after the first failed probe.
  private gpuAvailable: boolean | null = null;

  async snapshot(): Promise<SystemStatsDto> {
    const next = takeCpuSample();
    const cpuPct = cpuPercent(this.prevCpu, next);
    this.prevCpu = next;

    let gpu: GpuStats | null = null;
    if (this.gpuAvailable !== false) {
      gpu = parseGpuStats(await queryNvidiaSmi(2000));
      if (this.gpuAvailable === null) this.gpuAvailable = gpu !== null;
    }

    const ramTotalMB = Math.round(os.totalmem() / 1024 / 1024);
    const ramUsedMB = ramTotalMB - Math.round(os.freemem() / 1024 / 1024);
    return { at: Date.now(), cpuPct, ramUsedMB, ramTotalMB, gpu };
  }
}
