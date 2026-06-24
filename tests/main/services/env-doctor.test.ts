import { describe, it, expect } from 'vitest';
import { runDoctor, type DoctorProbes } from '@main/services/env-doctor';

const healthy: DoctorProbes = {
  ollamaReachable: true,
  modelsInstalled: 3,
  cloudKeysConfigured: 1,
  diskFreeGB: 120,
  workspacesWritable: true,
  gpuPresent: true,
};

describe('runDoctor', () => {
  it('all pass on a healthy setup', () => {
    const r = runDoctor(healthy);
    expect(r.overall).toBe('pass');
    expect(r.checks.every((c) => c.status === 'pass')).toBe(true);
  });

  it('fails when Ollama is down', () => {
    const r = runDoctor({ ...healthy, ollamaReachable: false });
    expect(r.overall).toBe('fail');
    expect(r.checks.find((c) => c.id === 'ollama')!.status).toBe('fail');
  });

  it('no local models is only a warn when cloud keys exist', () => {
    const r = runDoctor({ ...healthy, modelsInstalled: 0 });
    expect(r.checks.find((c) => c.id === 'models')!.status).toBe('warn');
  });

  it('no models and no cloud is a fail', () => {
    const r = runDoctor({ ...healthy, modelsInstalled: 0, cloudKeysConfigured: 0 });
    expect(r.checks.find((c) => c.id === 'models')!.status).toBe('fail');
  });

  it('warns on low disk and provides a hint', () => {
    const r = runDoctor({ ...healthy, diskFreeGB: 2 });
    const disk = r.checks.find((c) => c.id === 'disk')!;
    expect(disk.status).toBe('warn');
    expect(disk.hint).toBeTruthy();
  });

  it('omits the disk check when disk is unknown', () => {
    const r = runDoctor({ ...healthy, diskFreeGB: null });
    expect(r.checks.find((c) => c.id === 'disk')).toBeUndefined();
  });

  it('no GPU is a warn, not a fail', () => {
    const r = runDoctor({ ...healthy, gpuPresent: false });
    expect(r.checks.find((c) => c.id === 'gpu')!.status).toBe('warn');
    expect(r.overall).toBe('warn');
  });
});
