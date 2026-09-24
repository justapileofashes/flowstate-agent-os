import { describe, it, expect, vi } from 'vitest';
import { AlpacaClient, AlpacaError } from '@main/services/alpaca-client';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const creds = { keyId: 'k', secret: 's', paper: true };

describe('AlpacaClient', () => {
  it('uses the paper base URL by default and sends auth headers', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(200, { id: 'a1', equity: '10000.5', cash: '9000', buying_power: '18000', portfolio_value: '10000.5', status: 'ACTIVE', currency: 'USD', daytrade_count: 1, trading_blocked: false }),
    );
    const c = new AlpacaClient(creds, fetchFn);
    const acct = await c.getAccount();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://paper-api.alpaca.markets/v2/account');
    expect((init!.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('k');
    expect(acct.equity).toBe(10000.5);
    expect(acct.tradingBlocked).toBe(false);
  });

  it('uses the live base URL only when paper is false', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(200, {}));
    await new AlpacaClient({ ...creds, paper: false }, fetchFn).getAccount();
    expect(fetchFn.mock.calls[0]![0]).toContain('https://api.alpaca.markets');
  });

  it('maps 401 to an auth error', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(401, {}));
    await expect(new AlpacaClient(creds, fetchFn).getAccount()).rejects.toMatchObject({
      kind: 'auth',
    });
  });

  it('maps 422 to a rejected error', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(new Response('bad qty', { status: 422 }));
    const c = new AlpacaClient(creds, fetchFn);
    await expect(
      c.placeBracketOrder({ symbol: 'aapl', qty: 1, side: 'buy', takeProfit: 12, stopLoss: 9 }),
    ).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('maps network failures to AlpacaError network', async () => {
    const fetchFn = vi.fn<FetchLike>().mockRejectedValue(new Error('offline'));
    await expect(new AlpacaClient(creds, fetchFn).getClock()).rejects.toBeInstanceOf(AlpacaError);
  });

  it('places a bracket order with rounded prices + string qty', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(200, { id: 'o1', symbol: 'AAPL', qty: '5', filled_qty: '0', side: 'buy', type: 'market', status: 'new', legs: [] }),
    );
    const c = new AlpacaClient(creds, fetchFn);
    const order = await c.placeBracketOrder({
      symbol: 'aapl',
      qty: 5,
      side: 'buy',
      takeProfit: 123.456,
      stopLoss: 99.999,
    });
    const body = JSON.parse(String(fetchFn.mock.calls[0]![1]!.body));
    expect(body.symbol).toBe('AAPL');
    expect(body.qty).toBe('5');
    expect(body.order_class).toBe('bracket');
    expect(body.take_profit.limit_price).toBe('123.46');
    expect(body.stop_loss.stop_price).toBe('100');
    expect(order.id).toBe('o1');
  });

  it('maps positions with numeric coercion', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(200, [
        { symbol: 'MSFT', qty: '10', side: 'long', avg_entry_price: '400.5', current_price: '410', market_value: '4100', unrealized_pl: '95', unrealized_plpc: '0.0237' },
      ]),
    );
    const [p] = await new AlpacaClient(creds, fetchFn).getPositions();
    expect(p).toMatchObject({ symbol: 'MSFT', qty: 10, avgEntryPrice: 400.5 });
    expect(p!.unrealizedPlPct).toBeCloseTo(2.37);
  });

  it('maps nested bracket legs on orders', async () => {
    const fetchFn = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse(200, [
        {
          id: 'parent', symbol: 'AAPL', qty: '5', filled_qty: '5', side: 'buy', type: 'market',
          status: 'filled', filled_avg_price: '100.1',
          legs: [
            { id: 'tp', symbol: 'AAPL', qty: '5', filled_qty: '0', side: 'sell', type: 'limit', status: 'canceled', legs: [] },
            { id: 'sl', symbol: 'AAPL', qty: '5', filled_qty: '5', side: 'sell', type: 'stop', status: 'filled', filled_avg_price: '98', legs: [] },
          ],
        },
      ]),
    );
    const [o] = await new AlpacaClient(creds, fetchFn).getOrders('closed');
    expect(o!.filledAvgPrice).toBe(100.1);
    expect(o!.legs).toHaveLength(2);
    expect(o!.legs[1]).toMatchObject({ id: 'sl', filledQty: 5, filledAvgPrice: 98 });
  });
});
