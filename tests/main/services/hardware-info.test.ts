import { describe, it, expect } from 'vitest';
import {
  estimateGpuBandwidthGBs,
  REFERENCE_BANDWIDTH_GBS,
} from '@main/services/hardware-info';
import type { GpuInfo } from '@main/services/hardware-info';

const gpu = (name: string, vramMB: number, vendor: GpuInfo['vendor']): GpuInfo => ({
  name,
  vramMB,
  vendor,
});

describe('estimateGpuBandwidthGBs', () => {
  it('matches the reference GPU exactly', () => {
    expect(estimateGpuBandwidthGBs(gpu('NVIDIA GeForce RTX 4070 Ti SUPER', 16384, 'nvidia'))).toBe(
      REFERENCE_BANDWIDTH_GBS,
    );
  });

  it('prefers the most specific name match', () => {
    // '4070 ti super' (672) must win over '4070 ti' (504) and '4070' (504)
    expect(estimateGpuBandwidthGBs(gpu('RTX 4070 Ti Super', 16384, 'nvidia'))).toBe(672);
    expect(estimateGpuBandwidthGBs(gpu('RTX 4070 Ti', 12288, 'nvidia'))).toBe(504);
    expect(estimateGpuBandwidthGBs(gpu('RTX 4090', 24576, 'nvidia'))).toBe(1008);
  });

  it('resolves a known AMD card', () => {
    expect(estimateGpuBandwidthGBs(gpu('AMD Radeon RX 7900 XTX', 24576, 'amd'))).toBe(960);
  });

  it('falls back to a VRAM heuristic for unknown discrete GPUs', () => {
    // ~8GB → ~336 GB/s, never below the 100 floor
    expect(estimateGpuBandwidthGBs(gpu('NVIDIA Quantum 9999', 8192, 'nvidia'))).toBe(336);
    expect(estimateGpuBandwidthGBs(gpu('Tiny Discrete', 1024, 'amd'))).toBe(100);
  });

  it('treats integrated / other GPUs as low-bandwidth shared memory', () => {
    expect(estimateGpuBandwidthGBs(gpu('Intel UHD Graphics', 0, 'intel'))).toBe(80);
  });
});
