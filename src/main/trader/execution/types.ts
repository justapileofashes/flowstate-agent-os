// Broker adapter contract (Strategy pattern). The OMS talks only to this
// interface; PaperBroker (simulator) and AlpacaBroker implement it. An IBKR
// adapter would slot in here.

import type { AccountKind, OrderSide, OrderStatus, Side, Timeframe } from '@shared/trader/types';

export interface BrokerAccount {
  equity: number;
  cash: number;
  buyingPower: number;
  status: string;
  tradingBlocked: boolean;
}

export interface BrokerPosition {
  symbol: string;
  /** Signed (< 0 = short). */
  qty: number;
  avgPrice: number;
  lastPrice: number;
}

export interface BrokerOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: 'market' | 'limit';
  qty: number;
  limitPrice: number | null;
  timeInForce: 'day' | 'gtc';
  /** Broker-side protective exits (Alpaca bracket). */
  bracket: { stopLoss: number; takeProfit: number } | null;
  /** Simulator only: fill immediately at this price (emergency flatten, managed exits). */
  simFillPrice?: number;
}

export interface BrokerFill {
  id: string;
  qty: number;
  price: number;
  ts: number;
}

export interface BrokerOrderState {
  brokerOrderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  status: OrderStatus;
  qty: number;
  filledQty: number;
  avgFillPrice: number | null;
  /** Bracket legs (stop / take-profit), when the broker manages exits. */
  legs: Array<BrokerOrderState & { legType: 'stop' | 'take_profit' }>;
  submittedAt: number;
  updatedAt: number;
}

export interface BrokerClock {
  isOpen: boolean;
  nextOpen: number | null;
  nextClose: number | null;
}

export interface BrokerAdapter {
  readonly account: AccountKind;
  readonly name: string;
  /** Does this broker enforce bracket stops/TPs itself for this symbol? */
  managesExits(symbol: string): boolean;
  getAccount(): Promise<BrokerAccount>;
  getPositions(): Promise<BrokerPosition[]>;
  getClock(): Promise<BrokerClock | null>;
  placeOrder(req: BrokerOrderRequest): Promise<BrokerOrderState>;
  getOrder(brokerOrderId: string): Promise<BrokerOrderState>;
  getOrderByClientId(clientOrderId: string): Promise<BrokerOrderState | null>;
  cancelOrder(brokerOrderId: string): Promise<void>;
  cancelAll(): Promise<number>;
  /** Fills since a timestamp (for precise fill records). */
  fillsSince(since: number): Promise<Array<BrokerFill & { brokerOrderId: string; symbol: string; side: OrderSide }>>;
}

/** What the risk officer hands the trader node. */
export interface ApprovedTrade {
  signalId: string;
  symbol: string;
  side: Side;
  qty: number;
  /** Reference price at decision time (the assumed fill for slippage stats). */
  entry: number;
  stop: number;
  takeProfit: number;
  timeframe: Timeframe;
  maxHoldBars: number;
  /** Entry orders not filled by then are canceled. */
  expiresAt: number;
  modelVersion: string | null;
  strategyId: string | null;
}

export class BrokerError extends Error {
  constructor(
    readonly kind: 'auth' | 'network' | 'rate_limited' | 'rejected' | 'not_found' | 'insufficient_funds',
    message: string,
  ) {
    super(message);
    this.name = 'BrokerError';
  }
}

export function isTransientBrokerError(err: unknown): boolean {
  return err instanceof BrokerError ? err.kind === 'network' || err.kind === 'rate_limited' : /fetch failed|ECONN|timeout|socket/i.test(String(err));
}
