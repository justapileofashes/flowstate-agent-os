// Thin typed wrapper over the Alpaca Trading REST API (v2). Paper trading is
// the default and strongly preferred mode; the live base URL is only selected
// when the caller explicitly passes paper:false (the UI additionally requires
// a typed confirmation before allowing that). Injectable fetch keeps every
// call unit-testable without network.

export type AlpacaErrorKind = 'auth' | 'network' | 'rate-limited' | 'rejected' | 'not-found';

export class AlpacaError extends Error {
  constructor(
    public readonly kind: AlpacaErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AlpacaError';
  }
}

export interface AlpacaCredentials {
  keyId: string;
  secret: string;
  /** true → paper-api.alpaca.markets (default, no real money). */
  paper: boolean;
}

export interface AlpacaAccount {
  id: string;
  status: string;
  currency: string;
  equity: number;
  cash: number;
  buyingPower: number;
  portfolioValue: number;
  daytradeCount: number;
  tradingBlocked: boolean;
}

export interface AlpacaPosition {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlPct: number;
}

export interface AlpacaOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  qty: number;
  filledQty: number;
  side: 'buy' | 'sell';
  type: string;
  status: string;
  limitPrice: number | null;
  stopPrice: number | null;
  filledAvgPrice: number | null;
  submittedAt: string;
  filledAt: string | null;
  legs: AlpacaOrder[];
}

export interface AlpacaClock {
  isOpen: boolean;
  timestamp: string;
  nextOpen: string;
  nextClose: string;
}

export interface BracketOrderRequest {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  /** Take-profit limit price. */
  takeProfit: number;
  /** Stop-loss trigger price. */
  stopLoss: number;
  /** Optional client id so the journal can correlate fills. */
  clientOrderId?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapOrder(o: any): AlpacaOrder {
  return {
    id: String(o.id ?? ''),
    clientOrderId: String(o.client_order_id ?? ''),
    symbol: String(o.symbol ?? ''),
    qty: num(o.qty),
    filledQty: num(o.filled_qty),
    side: o.side === 'sell' ? 'sell' : 'buy',
    type: String(o.type ?? ''),
    status: String(o.status ?? ''),
    limitPrice: numOrNull(o.limit_price),
    stopPrice: numOrNull(o.stop_price),
    filledAvgPrice: numOrNull(o.filled_avg_price),
    submittedAt: String(o.submitted_at ?? ''),
    filledAt: o.filled_at ? String(o.filled_at) : null,
    legs: Array.isArray(o.legs) ? o.legs.map(mapOrder) : [],
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class AlpacaClient {
  private readonly base: string;

  constructor(
    private readonly creds: AlpacaCredentials,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    this.base = creds.paper ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
  }

  get isPaper(): boolean {
    return this.creds.paper;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: {
          'APCA-API-KEY-ID': this.creds.keyId,
          'APCA-API-SECRET-KEY': this.creds.secret,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new AlpacaError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 401 || res.status === 403) {
      throw new AlpacaError('auth', 'Alpaca rejected the API keys (check key id / secret / paper mode)');
    }
    if (res.status === 404) throw new AlpacaError('not-found', `not found: ${path}`);
    if (res.status === 429) throw new AlpacaError('rate-limited', 'Alpaca rate limit hit');
    if (res.status === 422 || res.status === 400 || res.status === 403) {
      const text = await res.text().catch(() => '');
      throw new AlpacaError('rejected', `order rejected: ${text.slice(0, 300)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AlpacaError('network', `HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async getAccount(): Promise<AlpacaAccount> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const a = await this.request<any>('GET', '/v2/account');
    return {
      id: String(a.id ?? ''),
      status: String(a.status ?? ''),
      currency: String(a.currency ?? 'USD'),
      equity: num(a.equity),
      cash: num(a.cash),
      buyingPower: num(a.buying_power),
      portfolioValue: num(a.portfolio_value),
      daytradeCount: num(a.daytrade_count),
      tradingBlocked: Boolean(a.trading_blocked),
    };
  }

  async getClock(): Promise<AlpacaClock> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const c = await this.request<any>('GET', '/v2/clock');
    return {
      isOpen: Boolean(c.is_open),
      timestamp: String(c.timestamp ?? ''),
      nextOpen: String(c.next_open ?? ''),
      nextClose: String(c.next_close ?? ''),
    };
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const rows = await this.request<any[]>('GET', '/v2/positions');
    return (rows ?? []).map((p) => ({
      symbol: String(p.symbol ?? ''),
      qty: Math.abs(num(p.qty)),
      side: p.side === 'short' ? 'short' : 'long',
      avgEntryPrice: num(p.avg_entry_price),
      currentPrice: num(p.current_price),
      marketValue: num(p.market_value),
      unrealizedPl: num(p.unrealized_pl),
      unrealizedPlPct: num(p.unrealized_plpc) * 100,
    }));
  }

  async getOrders(status: 'open' | 'closed' | 'all' = 'all', limit = 100): Promise<AlpacaOrder[]> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const rows = await this.request<any[]>(
      'GET',
      `/v2/orders?status=${status}&limit=${limit}&nested=true&direction=desc`,
    );
    return (rows ?? []).map(mapOrder);
  }

  async getOrder(id: string): Promise<AlpacaOrder> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const o = await this.request<any>('GET', `/v2/orders/${encodeURIComponent(id)}?nested=true`);
    return mapOrder(o);
  }

  /** Market entry + OCO stop-loss / take-profit exits in one atomic order. */
  async placeBracketOrder(req: BracketOrderRequest): Promise<AlpacaOrder> {
    const round2 = (v: number): number => Math.round(v * 100) / 100;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const o = await this.request<any>('POST', '/v2/orders', {
      symbol: req.symbol.toUpperCase(),
      qty: String(req.qty),
      side: req.side,
      type: 'market',
      time_in_force: 'day',
      order_class: 'bracket',
      take_profit: { limit_price: String(round2(req.takeProfit)) },
      stop_loss: { stop_price: String(round2(req.stopLoss)) },
      ...(req.clientOrderId ? { client_order_id: req.clientOrderId } : {}),
    });
    return mapOrder(o);
  }

  async cancelOrder(id: string): Promise<void> {
    await this.request<void>('DELETE', `/v2/orders/${encodeURIComponent(id)}`);
  }

  /** Close an open position at market (also cancels its bracket legs server-side). */
  async closePosition(symbol: string): Promise<AlpacaOrder> {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const o = await this.request<any>(
      'DELETE',
      `/v2/positions/${encodeURIComponent(symbol.toUpperCase())}`,
    );
    return mapOrder(o);
  }
}
