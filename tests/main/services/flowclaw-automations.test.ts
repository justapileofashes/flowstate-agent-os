import { describe, it, expect } from 'vitest';
import {
  parseAutomations,
  serializeAutomations,
  createAutomation,
  dueAutomations,
  markRan,
} from '@main/services/flowclaw-automations';

const T = 1_000_000;

describe('flowclaw automations', () => {
  it('creates with nextRunAt one interval out, enabled', () => {
    const a = createAutomation({ connectionId: 'c1', label: 'Digest', prompt: 'do it', intervalMinutes: 60 }, T);
    expect(a.enabled).toBe(true);
    expect(a.nextRunAt).toBe(T + 60 * 60_000);
    expect(a.deliverTo).toBe('inbox');
    expect(a.lastRunAt).toBeNull();
  });

  it('round-trips through parse/serialize', () => {
    const a = createAutomation({ connectionId: 'c1', label: 'X', prompt: 'p', intervalMinutes: 30 }, T);
    expect(parseAutomations(serializeAutomations([a]))).toEqual([a]);
  });

  it('returns [] for garbage', () => {
    expect(parseAutomations(null)).toEqual([]);
    expect(parseAutomations('nope')).toEqual([]);
  });

  it('dueAutomations only returns enabled + past-due', () => {
    const a = createAutomation({ connectionId: 'c', label: 'a', prompt: 'p', intervalMinutes: 60 }, T);
    const due = { ...a, id: 'due', nextRunAt: T };
    const future = { ...a, id: 'future', nextRunAt: T + 999_999 };
    const disabled = { ...a, id: 'off', nextRunAt: T, enabled: false };
    expect(dueAutomations([due, future, disabled], T).map((x) => x.id)).toEqual(['due']);
  });

  it('markRan stamps result + rolls nextRunAt forward', () => {
    const a = createAutomation({ connectionId: 'c', label: 'a', prompt: 'p', intervalMinutes: 15 }, T);
    const ran = markRan(a, 'result text', T + 1000);
    expect(ran.lastResult).toBe('result text');
    expect(ran.lastRunAt).toBe(T + 1000);
    expect(ran.nextRunAt).toBe(T + 1000 + 15 * 60_000);
  });
});
