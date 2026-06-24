import { describe, it, expect } from 'vitest';
import { cpuPercent, parseGpuStats, takeCpuSample } from '@main/services/system-stats';
import type { CpuSample } from '@main/services/system-stats';

describe('cpuPercent', () => {
  it('computes busy percentage from two samples', () => {
    const prev: CpuSample = { idle: 1000, total: 2000 };
    const next: CpuSample = { idle: 1500, total: 3000 }; // 500 idle of 1000 elapsed
    expect(cpuPercent(prev, next)).toBe(50);
  });

  it('clamps to 0..100 and survives zero elapsed', () => {
    const s: CpuSample = { idle: 1000, total: 2000 };
    expect(cpuPercent(s, s)).toBe(0); // no elapsed time
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(100);
  });

  it('takeCpuSample returns monotonic-ish counters', () => {
    const s = takeCpuSample();
    expect(s.total).toBeGreaterThan(0);
    expect(s.idle).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeGreaterThanOrEqual(s.idle);
  });
});

describe('parseGpuStats', () => {
  it('parses nvidia-smi CSV output', () => {
    const g = parseGpuStats('NVIDIA GeForce RTX 4070 Ti SUPER, 34, 5210, 16376\n');
    expect(g).toEqual({
      name: 'NVIDIA GeForce RTX 4070 Ti SUPER',
      utilPct: 34,
      vramUsedMB: 5210,
      vramTotalMB: 16376,
    });
  });

  it('takes the first GPU on multi-GPU output', () => {
    const g = parseGpuStats('GPU A, 10, 100, 8192\nGPU B, 90, 7000, 24576\n');
    expect(g!.name).toBe('GPU A');
  });

  it('returns null on garbage or empty output', () => {
    expect(parseGpuStats('')).toBeNull();
    expect(parseGpuStats('not, a, gpu')).toBeNull();
    expect(parseGpuStats('name only')).toBeNull();
  });
});
