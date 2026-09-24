// Kill switch. One call:
//   halt    — persist the halted state first (no new entries from this
//             instant, even if a broker call below fails), cancel every open
//             order on every account;
//   flatten — halt + close every position (the simulator fills immediately at
//             the last price minus slippage; brokers get market orders).
// Stays engaged until the user resumes. Kill events are always logged; a kill
// in paper mode also counts as the go-live checklist's "kill switch tested".

import type { AccountKind, KillMode } from '@shared/trader/types';
import type { TraderDb } from '../db';
import type { Oms } from './oms';
import type { BrokerAdapter } from './types';

export interface KillState {
  active: boolean;
  mode: KillMode | null;
  at: number | null;
  reason: string | null;
}

export interface KillResult {
  state: KillState;
  canceled: number;
  flattened: string[];
  errors: string[];
  ms: number;
}

const KEY = 'kill_switch';

export class KillSwitch {
  constructor(
    private readonly deps: {
      db: TraderDb;
      oms: Oms;
      accounts: () => AccountKind[];
      broker: (a: AccountKind) => BrokerAdapter | null;
      now: () => number;
    },
  ) {}

  state(): KillState {
    return this.deps.db.ops.get<KillState>(KEY, { active: false, mode: null, at: null, reason: null });
  }

  async engage(mode: KillMode, reason: string, actor: string): Promise<KillResult> {
    const started = this.deps.now();
    const state: KillState = { active: true, mode, at: started, reason: reason.slice(0, 300) };
    this.deps.db.ops.set(KEY, state, started);
    const result: KillResult = { state, canceled: 0, flattened: [], errors: [], ms: 0 };
    for (const account of this.deps.accounts()) {
      const broker = this.deps.broker(account);
      if (!broker) continue;
      try {
        result.canceled += await this.deps.oms.cancelAll(account);
      } catch (err) {
        result.errors.push(`${account} cancel: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (mode !== 'flatten') continue;
      let positions: Awaited<ReturnType<BrokerAdapter['getPositions']>> = [];
      try {
        positions = await broker.getPositions();
      } catch (err) {
        result.errors.push(`${account} positions: ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const p of positions) {
        try {
          await this.deps.oms.closePosition(account, p.symbol, `kill switch (${reason})`, { role: 'flatten', emergency: true });
          result.flattened.push(`${account}:${p.symbol}`);
        } catch (err) {
          result.errors.push(`${account} flatten ${p.symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    result.ms = this.deps.now() - started;
    this.deps.db.ops.log(actor, 'kill.engage', { mode, reason, canceled: result.canceled, flattened: result.flattened, errors: result.errors, accounts: this.deps.accounts() }, this.deps.now());
    return result;
  }

  resume(actor: string): KillState {
    const now = this.deps.now();
    const state: KillState = { active: false, mode: null, at: null, reason: null };
    this.deps.db.ops.set(KEY, state, now);
    this.deps.db.ops.log(actor, 'kill.resume', {}, now);
    return state;
  }
}
