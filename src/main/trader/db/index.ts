// TraderDb: every AI Trader repo over one SQLite handle.

import type { Database } from 'better-sqlite3';
import { MarketRepo } from './market';
import { ModelsRepo } from './models';
import { SignalsRepo } from './signals';
import { OmsRepo } from './oms';
import { LedgerRepo } from './ledger';
import { OpsRepo } from './ops';
import { RunsRepo } from './runs';

export class TraderDb {
  readonly market: MarketRepo;
  readonly models: ModelsRepo;
  readonly signals: SignalsRepo;
  readonly oms: OmsRepo;
  readonly ledger: LedgerRepo;
  readonly ops: OpsRepo;
  readonly runs: RunsRepo;

  constructor(readonly raw: Database) {
    this.market = new MarketRepo(raw);
    this.models = new ModelsRepo(raw);
    this.signals = new SignalsRepo(raw);
    this.oms = new OmsRepo(raw);
    this.ledger = new LedgerRepo(raw);
    this.ops = new OpsRepo(raw);
    this.runs = new RunsRepo(raw);
  }

  tx<T>(fn: () => T): T {
    return this.raw.transaction(fn)();
  }
}
