import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT_PRESETS } from '@shared/system-prompt-presets';

describe('SYSTEM_PROMPT_PRESETS', () => {
  it('has 4 presets', () => {
    expect(SYSTEM_PROMPT_PRESETS).toHaveLength(4);
  });

  it('all ids are unique', () => {
    const ids = SYSTEM_PROMPT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each preset has a non-trivial prompt', () => {
    for (const p of SYSTEM_PROMPT_PRESETS) {
      expect(p.prompt.length).toBeGreaterThan(50);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
