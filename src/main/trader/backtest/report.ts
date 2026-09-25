// Backtest artifacts: backtest_report/<run_id>.json (config, metrics, full
// trade log, equity curve, rejections) + <run_id>.equity.csv.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BacktestMetricsDto, BacktestTradeDto, EquityPointDto } from '@shared/trader/types';

export interface ReportBody {
  id: string;
  kind: string;
  label: string;
  config: Record<string, unknown>;
  metrics: BacktestMetricsDto;
  trades: BacktestTradeDto[];
  equity: EquityPointDto[];
  rejected: Array<{ ts: number; symbol: string; reason: string }>;
  createdAt: number;
}

export function equityCsv(equity: EquityPointDto[]): string {
  return ['ts,iso,equity', ...equity.map((e) => `${e.ts},${new Date(e.ts).toISOString()},${e.equity.toFixed(2)}`)].join('\n') + '\n';
}

export function tradesCsv(trades: BacktestTradeDto[]): string {
  const head = 'symbol,side,qty,entry_ts,entry_price,exit_ts,exit_price,pnl,r,exit_reason,fees';
  return [
    head,
    ...trades.map((t) =>
      [t.symbol, t.side, t.qty, new Date(t.entryTs).toISOString(), t.entryPrice.toFixed(4), new Date(t.exitTs).toISOString(), t.exitPrice.toFixed(4), t.pnl.toFixed(2), t.r.toFixed(3), t.exitReason, t.fees.toFixed(2)].join(','),
    ),
  ].join('\n') + '\n';
}

export function writeReport(dir: string, body: ReportBody): { reportPath: string; equityPath: string } {
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, `${body.id}.json`);
  const equityPath = join(dir, `${body.id}.equity.csv`);
  writeFileSync(reportPath, JSON.stringify(body, null, 2), 'utf8');
  writeFileSync(equityPath, equityCsv(body.equity), 'utf8');
  writeFileSync(join(dir, `${body.id}.trades.csv`), tradesCsv(body.trades), 'utf8');
  return { reportPath, equityPath };
}

export function readReport(path: string | null): ReportBody | null {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ReportBody;
  } catch {
    return null;
  }
}
