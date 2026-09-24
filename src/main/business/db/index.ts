// Aggregate of the business repos over one SQLite handle.

import type { Database } from 'better-sqlite3';
import { CompaniesRepo } from './companies';
import { RunsRepo } from './runs';
import { WorkRepo } from './work';
import { ApprovalsRepo } from './approvals';
import { KnowledgeRepo } from './knowledge';
import { BillingRepo } from './billing';
import { OpsRepo } from './ops';

export class BizDb {
  readonly companies: CompaniesRepo;
  readonly runs: RunsRepo;
  readonly work: WorkRepo;
  readonly approvals: ApprovalsRepo;
  readonly knowledge: KnowledgeRepo;
  readonly billing: BillingRepo;
  readonly ops: OpsRepo;

  constructor(readonly raw: Database) {
    this.companies = new CompaniesRepo(raw);
    this.runs = new RunsRepo(raw);
    this.work = new WorkRepo(raw);
    this.approvals = new ApprovalsRepo(raw);
    this.knowledge = new KnowledgeRepo(raw);
    this.billing = new BillingRepo(raw);
    this.ops = new OpsRepo(raw);
  }
}
