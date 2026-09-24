// AlpacaBroker — Alpaca Trading API v2 adapter (REST; fills are polled from
// orders + the FILL activity feed on every reconcile). Paper base URL unless
// constructed for the live account; the service only builds a live adapter
// when every go-live gate has passed. Equity entries go out as bracket orders
// (entry + stop-loss + take-profit, OCO at the broker). Alpaca has no crypto
// brackets, so crypto exits are managed by the OMS. Client order ids make
// every submit idempotent across retries.

import { assetClassOf, type AccountKind, type OrderSide, type OrderStatus } from '@shared/trader/types';
import {
  BrokerError,
  type BrokerAccount,
  type BrokerAdapter,
  type BrokerClock,
  type BrokerFill,
  type BrokerOrderRequest,
  type BrokerOrderState,
  type BrokerPosition,
} from './types';

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

export function mapAlpacaStatus(s: string): OrderStatus {
  switch (s) {
    case 'filled':
      return 'filled';
    case 'partially_filled':
      return 'partially_filled';
    case 'canceled':
    case 'done_for_day':
    case 'replaced':
      return 'canceled';
    case 'expired':
      return 'expired';
    case 'rejected':
    case 'suspended':
      return 'rejected';
    case 'new':
    case 'accepted':
    case 'pending_new':
    case 'accepted_for_bidding':
    case 'pending_cancel':
    case 'pending_replace':
    case 'calculated':
    case 'held':
    default:
      return 'submitted';
  }
}

function mapOrder(o: any): BrokerOrderState {
  const legs = Array.isArray(o.legs) ? o.legs : [];
  return {
    brokerOrderId: String(o.id ?? ''),
    clientOrderId: String(o.client_order_id ?? ''),
    symbol: String(o.symbol ?? ''),
    side: o.side === 'sell' ? 'sell' : 'buy',
    status: mapAlpacaStatus(String(o.status ?? '')),
    qty: num(o.qty),
    filledQty: num(o.filled_qty),
    avgFillPrice: numOrNull(o.filled_avg_price),
    legs: legs.map((l: any) => ({ ...mapOrder(l), legType: l.type === 'limit' ? 'take_profit' : 'stop' })),
    submittedAt: Date.parse(o.submitted_at ?? '') || 0,
    updatedAt: Date.parse(o.updated_at ?? '') || 0,
  };
}

export class AlpacaBroker implements BrokerAdapter {
  readonly name: string;
  private readonly base: string;

  constructor(
    readonly account: Extract<AccountKind, 'paper' | 'live'>,
    private readonly creds: { keyId: string; secret: string },
    private readonly fetchFn: FetchLike = fetch,
  ) {
    this.base = account === 'live' ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets';
    this.name = account === 'live' ? 'alpaca-live' : 'alpaca-paper';
  }

  managesExits(symbol: string): boolean {
    return assetClassOf(symbol) === 'us_equity';
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
      throw new BrokerError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 401) throw new BrokerError('auth', 'Alpaca rejected the API keys (check key id / secret and paper vs live)');
    if (res.status === 404) throw new BrokerError('not_found', `not found: ${path.split('?')[0]}`);
    if (res.status === 429) throw new BrokerError('rate_limited', 'Alpaca rate limit hit');
    if (res.status === 403 || res.status === 422 || res.status === 400) {
      const text = await res.text().catch(() => '');
      const insufficient = /insufficient|buying power/i.test(text);
      throw new BrokerError(insufficient ? 'insufficient_funds' : 'rejected', `Alpaca rejected the request: ${text.slice(0, 300)}`);
    }
    if (!res.ok && res.status !== 207) {
      const text = await res.text().catch(() => '');
      throw new BrokerError('network', `Alpaca HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async getAccount(): Promise<BrokerAccount> {
    const a = await this.request<Record<string, unknown>>('GET', '/v2/account');
    return {
      equity: num(a['equity']),
      cash: num(a['cash']),
      buyingPower: num(a['buying_power']),
      status: String(a['status'] ?? ''),
      tradingBlocked: Boolean(a['trading_blocked']) || Boolean(a['account_blocked']),
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const rows = await this.request<Array<Record<string, unknown>>>('GET', '/v2/positions');
    return (rows ?? []).map((p) => {
      const qty = Math.abs(num(p['qty']));
      return {
        symbol: normalizeAlpacaSymbol(String(p['symbol'] ?? '')),
        qty: p['side'] === 'short' ? -qty : qty,
        avgPrice: num(p['avg_entry_price']),
        lastPrice: num(p['current_price']),
      };
    });
  }

  async getClock(): Promise<BrokerClock | null> {
    const c = await this.request<Record<string, unknown>>('GET', '/v2/clock');
    return {
      isOpen: Boolean(c['is_open']),
      nextOpen: Date.parse(String(c['next_open'] ?? '')) || null,
      nextClose: Date.parse(String(c['next_close'] ?? '')) || null,
    };
  }

  async placeOrder(req: BrokerOrderRequest): Promise<BrokerOrderState> {
    const crypto = assetClassOf(req.symbol) === 'crypto';
    const round = (v: number): string => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
    const body: Record<string, unknown> = {
      symbol: req.symbol,
      qty: String(req.qty),
      side: req.side,
      type: req.type,
      time_in_force: crypto ? 'gtc' : req.timeInForce,
      client_order_id: req.clientOrderId,
      ...(req.type === 'limit' && req.limitPrice !== null ? { limit_price: round(req.limitPrice) } : {}),
    };
    if (req.bracket && !crypto) {
      body['order_class'] = 'bracket';
      body['take_profit'] = { limit_price: round(req.bracket.takeProfit) };
      body['stop_loss'] = { stop_price: round(req.bracket.stopLoss) };
    }
    return mapOrder(await this.request('POST', '/v2/orders', body));
  }

  async getOrder(brokerOrderId: string): Promise<BrokerOrderState> {
    return mapOrder(await this.request('GET', `/v2/orders/${encodeURIComponent(brokerOrderId)}?nested=true`));
  }

  async getOrderByClientId(clientOrderId: string): Promise<BrokerOrderState | null> {
    try {
      return mapOrder(await this.request('GET', `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`));
    } catch (err) {
      if (err instanceof BrokerError && err.kind === 'not_found') return null;
      throw err;
    }
  }

  async cancelOrder(brokerOrderId: string): Promise<void> {
    try {
      await this.request('DELETE', `/v2/orders/${encodeURIComponent(brokerOrderId)}`);
    } catch (err) {
      if (err instanceof BrokerError && (err.kind === 'not_found' || err.kind === 'rejected')) return; // already final
      throw err;
    }
  }

  async cancelAll(): Promise<number> {
    const res = await this.request<unknown[] | undefined>('DELETE', '/v2/orders');
    return Array.isArray(res) ? res.length : 0;
  }

  async fillsSince(since: number): Promise<Array<BrokerFill & { brokerOrderId: string; symbol: string; side: OrderSide }>> {
    const rows = await this.request<Array<Record<string, unknown>>>(
      'GET',
      `/v2/account/activities/FILL?after=${encodeURIComponent(new Date(since).toISOString())}&direction=asc&page_size=100`,
    );
    return (rows ?? []).map((r) => ({
      id: String(r['id'] ?? ''),
      brokerOrderId: String(r['order_id'] ?? ''),
      symbol: normalizeAlpacaSymbol(String(r['symbol'] ?? '')),
      side: r['side'] === 'sell' || r['side'] === 'sell_short' ? 'sell' : 'buy',
      qty: num(r['qty']),
      price: num(r['price']),
      ts: Date.parse(String(r['transaction_time'] ?? '')) || 0,
    }));
  }
}

/** Alpaca reports crypto positions as BTCUSD; canonical is BTC/USD. */
export function normalizeAlpacaSymbol(s: string): string {
  if (s.includes('/')) return s;
  const m = /^(BTC|ETH|SOL|LTC|DOGE|AVAX|LINK|UNI|AAVE|BCH|DOT|XRP|SHIB)(USD|USDT|USDC)$/.exec(s);
  return m ? `${m[1]}/${m[2]}` : s;
}
