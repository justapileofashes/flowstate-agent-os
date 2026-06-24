import { describe, it, expect } from 'vitest';
import {
  parseSnippets,
  serializeSnippets,
  snippetVars,
  expandSnippet,
  type Snippet,
} from '@main/services/prompt-snippets';

const sample: Snippet = {
  id: 's1',
  name: 'bugfix',
  label: 'Bug fix',
  body: 'Fix the {{area}} bug. Repro: {{steps}}',
};

describe('parse/serialize snippets', () => {
  it('round-trips a valid store', () => {
    const json = serializeSnippets([sample]);
    expect(parseSnippets(json)).toEqual([sample]);
  });

  it('returns [] for null/garbage/invalid shapes', () => {
    expect(parseSnippets(null)).toEqual([]);
    expect(parseSnippets('not json')).toEqual([]);
    expect(parseSnippets('{"not":"array"}')).toEqual([]);
    expect(parseSnippets('[{"id":"x"}]')).toEqual([]); // missing fields
  });

  it('rejects an invalid name on serialize', () => {
    expect(() => serializeSnippets([{ ...sample, name: 'Has Space' }])).toThrow();
  });
});

describe('snippetVars', () => {
  it('lists user vars in first-seen order, de-duped, excluding builtins', () => {
    expect(snippetVars('{{a}} {{b}} {{a}} {{date}}')).toEqual(['a', 'b']);
  });

  it('ignores the fallback part when collecting names', () => {
    expect(snippetVars('{{lang|TypeScript}}')).toEqual(['lang']);
  });
});

describe('expandSnippet', () => {
  it('substitutes supplied vars', () => {
    expect(expandSnippet('Hi {{name}}', { name: 'Ada' })).toBe('Hi Ada');
  });

  it('uses fallback when var missing or empty', () => {
    expect(expandSnippet('{{lang|TypeScript}}', {})).toBe('TypeScript');
    expect(expandSnippet('{{lang|TypeScript}}', { lang: '' })).toBe('TypeScript');
    expect(expandSnippet('{{lang|TypeScript}}', { lang: 'Rust' })).toBe('Rust');
  });

  it('expands date/time builtins', () => {
    const at = new Date('2026-06-13T09:05:07Z');
    expect(expandSnippet('on {{date}} at {{time}}', {}, at)).toBe('on 2026-06-13 at 09:05:07');
  });

  it('leaves an unfilled placeholder visible', () => {
    expect(expandSnippet('need {{missing}}', {})).toBe('need {{missing}}');
  });
});
