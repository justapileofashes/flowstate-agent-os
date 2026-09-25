// A registered model ready to score: the GBDT plus the metadata the signal
// generator needs (expected up/down move in ATR units for the edge estimate).

import type { Timeframe } from '@shared/trader/types';
import { contributions, predictProba, type GbdtModel } from './gbdt';

export interface ModelMeta {
  timeframe: Timeframe;
  horizonBars: number;
  featureSet: string;
  /** Mean forward return when up / |mean| when down, in ATR% units (train set). */
  upAtr: number;
  downAtr: number;
  /** Latest label timestamp the model has seen (anything later is out-of-sample). */
  dataEnd: number;
}

export interface ModelBlob {
  gbdt: GbdtModel;
  meta: ModelMeta;
}

const LABELS: Record<string, string> = {
  ret_1: 'last-bar return',
  roc_5: '5-bar momentum',
  roc_15: '15-bar momentum',
  roc_60: '60-bar momentum',
  rsi_14: 'RSI(14)',
  macd_hist: 'MACD histogram',
  ema_ratio: 'EMA12/26 spread',
  bb_pctb: 'Bollinger %B',
  bb_width: 'Bollinger width',
  atr_pct: 'ATR%',
  atr_ratio: 'ATR14/ATR50',
  sma20_dist: 'distance to SMA20',
  sma50_dist: 'distance to SMA50',
  obv_slope: 'OBV slope',
  vol_z: 'volume z-score',
  vwap_dev: 'VWAP deviation',
  range_pct: 'bar range',
  close_pos: 'close position in bar',
  dist_high_20: 'distance to 20-bar high',
  dist_low_20: 'distance to 20-bar low',
  trend_slope: 'EMA20 slope',
  regime_trend: 'trend regime',
  regime_vol: 'volatility regime',
  tod: 'time of day',
};

export class Predictor {
  readonly meta: ModelMeta;
  private readonly gbdt: GbdtModel;

  constructor(
    readonly version: string,
    readonly hash: string,
    blob: string | ModelBlob,
  ) {
    const parsed = typeof blob === 'string' ? (JSON.parse(blob) as ModelBlob) : blob;
    if (!parsed?.gbdt || parsed.gbdt.kind !== 'gbdt-binary') throw new Error(`model ${version}: unsupported blob`);
    this.gbdt = parsed.gbdt;
    this.meta = parsed.meta;
  }

  probUp(x: number[]): number {
    return predictProba(this.gbdt, x);
  }

  /** Top drivers as readable text, e.g. "RSI(14) 31.2 (↑), 15-bar momentum −2.1 (↓)". */
  drivers(x: number[], k = 3): string {
    return contributions(this.gbdt, x)
      .slice(0, k)
      .map((c) => `${LABELS[c.feature] ?? c.feature} ${c.value.toFixed(2)} (${c.contribution >= 0 ? '↑' : '↓'})`)
      .join(', ');
  }
}
