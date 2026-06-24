import { describe, it, expect } from 'vitest';
import { scoreCatalog } from '@main/services/model-catalog';
import type { HardwareInfo } from '@main/services/hardware-info';

const hw = (over: Partial<HardwareInfo>): HardwareInfo => ({
  platform: 'win32',
  cpuModel: 'Test CPU',
  cpuCount: 16,
  ramGB: 64,
  gpus: [],
  primaryVramGB: 24,
  perfFactor: 1,
  detectionNotes: [],
  ...over,
});

describe('scoreCatalog GPU-speed scaling', () => {
  it('scales fully-offloaded speed by the machine perfFactor', () => {
    const slow = scoreCatalog(hw({ perfFactor: 0.5 }));
    const ref = scoreCatalog(hw({ perfFactor: 1 }));
    const fast = scoreCatalog(hw({ perfFactor: 2 }));

    // Pick a local model that fits fully in 24GB VRAM on all three runs.
    const pick = (list: typeof ref): number => {
      const e = list.find((c) => !c.model.cloud && c.fit === 'gpu');
      expect(e).toBeTruthy();
      return e!.estTokPerSec;
    };

    const s = pick(slow);
    const r = pick(ref);
    const f = pick(fast);
    expect(s).toBeLessThan(r);
    expect(f).toBeGreaterThan(r);
    // 2x perfFactor ≈ 2x the reference speed (allow rounding slack)
    expect(f).toBeCloseTo(r * 2, -1);
  });

  it('leaves cloud model speed untouched by local GPU', () => {
    const slow = scoreCatalog(hw({ perfFactor: 0.5 }), {
      anthropic: true,
      openai: false,
      gemini: false,
      perplexity: false,
      groq: false,
      mistral: false,
      xai: false,
    });
    const fast = scoreCatalog(hw({ perfFactor: 4 }), {
      anthropic: true,
      openai: false,
      gemini: false,
      perplexity: false,
      groq: false,
      mistral: false,
      xai: false,
    });
    const cloudSlow = slow.find((c) => c.model.cloud === 'anthropic' && c.fit === 'cloud')!;
    const cloudFast = fast.find((c) => c.model.cloud === 'anthropic' && c.fit === 'cloud')!;
    expect(cloudSlow.estTokPerSec).toBe(cloudFast.estTokPerSec);
  });
});
