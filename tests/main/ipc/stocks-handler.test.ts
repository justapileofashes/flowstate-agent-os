import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture ipcMain.handle registrations so we can invoke them directly.
const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();
vi.mock('electron', () => ({
  app: { getPath: () => '.' },
  ipcMain: { handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => handlers.set(ch, fn) },
}));

import { registerStocksHandlers } from '../../../src/main/ipc/handlers/stocks';
import { CHANNELS } from '../../../src/shared/ipc-channels';

interface FakeSettings {
  store: Map<string, string>;
  get(k: string): string | null;
  set(k: string, v: string): void;
}
function fakeSettings(): FakeSettings {
  const store = new Map<string, string>();
  return {
    store,
    get: (k) => store.get(k) ?? null,
    set: (k, v) => void store.set(k, v),
  };
}

beforeEach(() => {
  handlers.clear();
});

describe('stocks handlers', () => {
  it('watchlist round-trips, normalizing to upper-case + de-duped', async () => {
    const settings = fakeSettings();
    registerStocksHandlers({ settings: settings as never });

    const setRes = (await handlers.get(CHANNELS.STOCKS_WATCHLIST_SET)!({}, {
      symbols: ['aapl', 'AAPL', 'msft'],
    })) as { symbols: string[] };
    expect(setRes.symbols).toEqual(['AAPL', 'MSFT']);

    const getRes = (await handlers.get(CHANNELS.STOCKS_WATCHLIST_GET)!({}, {})) as {
      symbols: string[];
    };
    expect(getRes.symbols).toEqual(['AAPL', 'MSFT']);
  });

  it('returns a sensible default watchlist when none saved', async () => {
    const settings = fakeSettings();
    registerStocksHandlers({ settings: settings as never });
    const res = (await handlers.get(CHANNELS.STOCKS_WATCHLIST_GET)!({}, {})) as { symbols: string[] };
    expect(res.symbols.length).toBeGreaterThan(0);
  });
});
