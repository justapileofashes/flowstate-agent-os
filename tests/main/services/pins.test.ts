import { describe, it, expect } from 'vitest';
import { parsePins, serializePins, isPinned, togglePin, orderByPin } from '@main/services/pins';

describe('pins parse/serialize', () => {
  it('round-trips and de-dupes', () => {
    expect(parsePins(serializePins(['a', 'a', 'b']))).toEqual(['a', 'b']);
  });
  it('returns [] for garbage', () => {
    expect(parsePins(null)).toEqual([]);
    expect(parsePins('nope')).toEqual([]);
    expect(parsePins('[1,2,"a"]')).toEqual(['a']);
  });
});

describe('togglePin', () => {
  it('adds to front when absent', () => {
    expect(togglePin(['a'], 'b')).toEqual(['b', 'a']);
  });
  it('removes when present', () => {
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('isPinned', () => {
  it('reports membership', () => {
    expect(isPinned(['a'], 'a')).toBe(true);
    expect(isPinned(['a'], 'b')).toBe(false);
  });
});

describe('orderByPin', () => {
  it('floats pinned to top, stable within groups', () => {
    const chats = [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }];
    expect(orderByPin(chats, ['3', '1']).map((c) => c.id)).toEqual(['1', '3', '2', '4']);
  });
  it('is a no-op with no pins', () => {
    const chats = [{ id: '1' }, { id: '2' }];
    expect(orderByPin(chats, []).map((c) => c.id)).toEqual(['1', '2']);
  });
});
