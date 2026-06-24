import { describe, it, expect } from 'vitest';
import {
  resolveModelChain,
  pickNextModel,
  isRetryableModelError,
} from '@main/agent/model-fallback';

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
