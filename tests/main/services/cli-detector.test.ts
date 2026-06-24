import { describe, it, expect } from 'vitest';
import { detectInstalledClis } from '@main/services/cli-detector';
import { KNOWN_CLIS, type CliProbeResult } from '@main/services/cli-catalog';

describe('detectInstalledClis', () => {
  it('probes every catalog entry and returns a full merged report', async () => {
    const probed: string[] = [];
    const fakeProbe = async (def: { id: string }): Promise<CliProbeResult> => {
      probed.push(def.id);
      const installed = def.id === 'git' || def.id === 'node';
      return {
        id: def.id,
        installed,
        version: installed ? '1.2.3' : null,
        path: installed ? `/usr/bin/${def.id}` : null,
      };
    };
    const report = await detectInstalledClis(KNOWN_CLIS, fakeProbe);
    expect(probed.length).toBe(KNOWN_CLIS.length);
    expect(report.length).toBe(KNOWN_CLIS.length);
    expect(report.find((c) => c.id === 'git')!.installed).toBe(true);
    expect(report.find((c) => c.id === 'git')!.version).toBe('1.2.3');
    expect(report.find((c) => c.id === 'docker')!.installed).toBe(false);
  });

  it('survives a probe that throws (treats it as not installed)', async () => {
    const flakyProbe = async (def: { id: string }): Promise<CliProbeResult> => {
      if (def.id === 'git') throw new Error('boom');
      return { id: def.id, installed: false, version: null, path: null };
    };
    const report = await detectInstalledClis(KNOWN_CLIS, flakyProbe);
    expect(report.length).toBe(KNOWN_CLIS.length);
    expect(report.find((c) => c.id === 'git')!.installed).toBe(false);
  });
});
