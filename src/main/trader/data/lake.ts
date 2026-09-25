// Append-only bar lake: immutable NDJSON partitions
//   <root>/bars/<timeframe>/<symbol>/<YYYY-MM-DD>.ndjson
// A per-(symbol, timeframe) watermark guarantees each closed bar is written
// once and never rewritten. Training runs pin a dataset manifest
//   <root>/datasets/<datasetId>.json
// whose id is the sha256 of its content, so any model can be traced back to
// the exact bars it saw.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Timeframe } from '@shared/trader/types';
import type { Candle } from './types';

export interface DatasetManifest {
  timeframe: Timeframe;
  featureSet: string;
  horizonBars: number;
  symbols: Array<{ symbol: string; from: number; to: number; bars: number; sha256: string }>;
}

const safe = (s: string): string => s.replace(/[^A-Z0-9._-]/gi, '_');
const day = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

export function hashCandles(candles: Candle[]): string {
  const h = createHash('sha256');
  for (const c of candles) h.update(`${c.ts},${c.open},${c.high},${c.low},${c.close},${c.volume}\n`);
  return h.digest('hex');
}

export class BarLake {
  constructor(
    private readonly root: string,
    private readonly watermark: { get(key: string): number | null; set(key: string, ts: number): void },
  ) {}

  /** Append bars newer than the watermark. Returns how many were written. */
  append(symbol: string, timeframe: Timeframe, candles: Candle[]): number {
    const key = `lake:${timeframe}:${symbol}`;
    const wm = this.watermark.get(key) ?? -Infinity;
    const fresh = candles.filter((c) => c.ts > wm).sort((a, b) => a.ts - b.ts);
    if (!fresh.length) return 0;
    const dir = join(this.root, 'bars', timeframe, safe(symbol));
    mkdirSync(dir, { recursive: true });
    const byDay = new Map<string, string[]>();
    for (const c of fresh) {
      const d = day(c.ts);
      const lines = byDay.get(d) ?? [];
      lines.push(JSON.stringify({ symbol, ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume }));
      byDay.set(d, lines);
    }
    for (const [d, lines] of byDay) appendFileSync(join(dir, `${d}.ndjson`), lines.join('\n') + '\n', 'utf8');
    this.watermark.set(key, fresh[fresh.length - 1]!.ts);
    return fresh.length;
  }

  read(symbol: string, timeframe: Timeframe, from = 0, to = Infinity): Candle[] {
    const dir = join(this.root, 'bars', timeframe, safe(symbol));
    if (!existsSync(dir)) return [];
    const out: Candle[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ndjson')).sort()) {
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (!line) continue;
        const c = JSON.parse(line) as Candle & { symbol: string };
        if (c.ts >= from && c.ts <= to) out.push({ ts: c.ts, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
      }
    }
    return out;
  }

  /** Persist a manifest; the id is content-addressed. */
  writeManifest(m: DatasetManifest): string {
    const body = JSON.stringify(m);
    const id = `ds-${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
    const dir = join(this.root, 'datasets');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${id}.json`);
    if (!existsSync(path)) writeFileSync(path, JSON.stringify({ id, ...m }, null, 2), 'utf8');
    return id;
  }

  readManifest(id: string): (DatasetManifest & { id: string }) | null {
    const path = join(this.root, 'datasets', `${id}.json`);
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as DatasetManifest & { id: string }) : null;
  }
}

/** Dataset id without a lake (tests / lake disabled): same content hash. */
export function datasetId(m: DatasetManifest): string {
  return `ds-${createHash('sha256').update(JSON.stringify(m)).digest('hex').slice(0, 16)}`;
}
