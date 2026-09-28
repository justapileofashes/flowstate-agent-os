import { describe, it, expect } from 'vitest';
import {
  resolveModelChain,
  pickNextModel,
  isRetryableModelError,
  substituteModel,
} from '@main/agent/model-fallback';

describe('substituteModel', () => {
  const installed = ['llama3.1:8b', 'qwen2.5:7b', 'qwen2.5-coder:7b'];

  it('keeps the wanted model when it is installed', () => {
    expect(substituteModel('qwen2.5:7b', installed)).toBe('qwen2.5:7b');
  });

  it('prefers another size of the same family', () => {
    // Seeded agents ask for qwen2.5-coder:14b; a 7b coder is the closer match.
    expect(substituteModel('qwen2.5-coder:14b', installed)).toBe('qwen2.5-coder:7b');
  });

  it('falls back down the prefix ladder when the family is absent', () => {
    expect(substituteModel('mixtral:8x7b', ['phi3:mini', 'llama3.1:8b'])).toBe('llama3.1:8b');
  });

  it('takes whatever is installed when nothing on the ladder matches', () => {
    expect(substituteModel('mixtral:8x7b', ['phi3:mini'])).toBe('phi3:mini');
  });

  it('leaves the wanted model alone when the installed list is unknown', () => {
    // Ollama unreachable — rewriting to a guess would be worse than a clear 404.
    expect(substituteModel('qwen2.5-coder:14b', [])).toBe('qwen2.5-coder:14b');
  });
});

describe('resolveModelChain', () => {
  it('puts primary first then available fallbacks, de-duped', () => {
    expect(
      resolveModelChain('llama3', ['mistral', 'qwen', 'llama3'], ['llama3', 'mistral', 'qwen']),
    ).toEqual(['llama3', 'mistral', 'qwen']);
  });

  it('drops fallbacks that are not available', () => {
    expect(resolveModelChain('llama3', ['ghost', 'mistral'], ['llama3', 'mistral'])).toEqual([
      'llama3',
      'mistral',
    ]);
  });

  it('keeps primary even if unavailable when nothing else resolves', () => {
    expect(resolveModelChain('llama3', [], [])).toEqual(['llama3']);
  });

  it('substitutes an installed model when nothing in the chain is available', () => {
    // Seeded agents carry qwen2.5-coder:14b forever. On a machine that never
    // pulled it the whole chain resolves empty and every turn 404s.
    expect(resolveModelChain('qwen2.5-coder:14b', [], ['llama3.1:8b'])).toEqual(['llama3.1:8b']);
  });

  it('can fail over from an unavailable primary to an available fallback', () => {
    expect(resolveModelChain('gone', ['mistral'], ['mistral'])).toEqual(['mistral']);
  });
});

describe('pickNextModel', () => {
  it('returns first untried', () => {
    expect(pickNextModel(['a', 'b', 'c'], ['a'])).toBe('b');
  });
  it('returns null when exhausted', () => {
    expect(pickNextModel(['a', 'b'], ['a', 'b'])).toBeNull();
  });
});

describe('isRetryableModelError', () => {
  it('matches rate limits, 5xx, oom, timeouts, missing model', () => {
    for (const m of [
      'HTTP 429 rate limit',
      'server returned 503',
      'CUDA out of memory',
      'request timed out',
      'ECONNREFUSED',
      'model llama3 not found',
      'Overloaded',
    ]) {
      expect(isRetryableModelError(new Error(m))).toBe(true);
    }
  });

  it('does not match a plain logic error', () => {
    expect(isRetryableModelError(new Error('invalid argument: temperature'))).toBe(false);
  });
});
