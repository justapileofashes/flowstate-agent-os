// Cost dashboard aggregation. Rolls the flat usage ledger up by agent, by model,
// and by day so the renderer can show "what's this costing me, and where".
// Pure: the IPC handler feeds it the ledger rows.

export interface UsageLedgerRow {
  chatId: string;
  agentId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  at: number;
}

export interface AgentSpend {
  agentId: string;
  costUsd: number;
  calls: number;
  tokens: number;
}
export interface ModelSpend {
  model: string;
  costUsd: number;
  calls: number;
}
export interface DaySpend {
  day: string; // YYYY-MM-DD (UTC)
  costUsd: number;
}

export interface UsageSummary {
  totalUsd: number;
  totalCalls: number;
  totalTokens: number;
  byAgent: AgentSpend[]; // sorted by costUsd desc
  byModel: ModelSpend[]; // sorted by costUsd desc
  byDay: DaySpend[]; // ascending by day
}

function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function summarizeUsage(rows: UsageLedgerRow[]): UsageSummary {
  const agents = new Map<string, AgentSpend>();
  const models = new Map<string, ModelSpend>();
  const days = new Map<string, DaySpend>();
  let totalUsd = 0;
  let totalTokens = 0;

  for (const r of rows) {
    const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
    const cost = r.costUsd || 0;
    totalUsd += cost;
    totalTokens += tokens;

    const a = agents.get(r.agentId) ?? { agentId: r.agentId, costUsd: 0, calls: 0, tokens: 0 };
    a.costUsd += cost;
    a.calls += 1;
    a.tokens += tokens;
    agents.set(r.agentId, a);

    const m = models.get(r.model) ?? { model: r.model, costUsd: 0, calls: 0 };
    m.costUsd += cost;
    m.calls += 1;
    models.set(r.model, m);

    const dk = dayOf(r.at);
    const d = days.get(dk) ?? { day: dk, costUsd: 0 };
    d.costUsd += cost;
    days.set(dk, d);
  }

  return {
    totalUsd,
    totalCalls: rows.length,
    totalTokens,
    byAgent: [...agents.values()].sort((x, y) => y.costUsd - x.costUsd),
    byModel: [...models.values()].sort((x, y) => y.costUsd - x.costUsd),
    byDay: [...days.values()].sort((x, y) => x.day.localeCompare(y.day)),
  };
}
