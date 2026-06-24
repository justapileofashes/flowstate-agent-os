import { describe, it, expect } from 'vitest';
import {
  parseHistory,
  serializeHistory,
  pushHistory,
  recallHistory,
} from '@main/services/prompt-history';

describe('history parse/serialize', () => {
  it('round-trips', () => {
    expect(parseHistory(serializeHistory(['a', 'b']))).toEqual(['a', 'b']);
  });
  it('returns [] for garbage', () => {
    expect(parseHistory(null)).toEqual([]);
    expect(parseHistory('{')).toEqual([]);
  });
});

describe('pushHistory', () => {
  it('prepends most-recent-first', () => {
    expect(pushHistory(['a'], 'b')).toEqual(['b', 'a']);
  });
  it('ignores blank entries', () => {
    expect(pushHistory(['a'], '   ')).toEqual(['a']);
  });
  it('moves an existing entry to the front instead of duplicating', () => {
    expect(pushHistory(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
  });
  it('caps length', () => {
    const long = Array.from({ length: 60 }, (_, i) => `e${i}`);
    expect(pushHistory(long, 'new', 50)).toHaveLength(50);
    expect(pushHistory(long, 'new', 50)[0]).toBe('new');
  });
});

describe('recallHistory', () => {
  it('recalls by index, 0 = most recent', () => {
    expect(recallHistory(['b', 'a'], 0)).toBe('b');
    expect(recallHistory(['b', 'a'], 1)).toBe('a');
  });
  it('returns null out of range', () => {
    expect(recallHistory(['b'], 5)).toBeNull();
    expect(recallHistory(['b'], -1)).toBeNull();
  });
});
