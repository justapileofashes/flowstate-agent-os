import { describe, it, expect } from 'vitest';
import { shapeRelease } from '../lib/releases';

describe('shapeRelease', () => {
  it('maps a db row to the public payload', () => {
    const out = shapeRelease({
      version: '1.0.1',
      notes: 'fixes',
      setup_url: 'https://x/setup.exe',
      portable_url: 'https://x/portable.exe',
      pub_date: '2026-06-20T00:00:00Z',
    });
    expect(out).toEqual({
      version: '1.0.1',
      notes: 'fixes',
      pubDate: '2026-06-20T00:00:00Z',
      assets: { setup: 'https://x/setup.exe', portable: 'https://x/portable.exe' },
    });
  });
});
