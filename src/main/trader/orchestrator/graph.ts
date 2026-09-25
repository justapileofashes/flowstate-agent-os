// The orchestrator: one typed state machine per tick.
//
//   reconcile → guard → data → researcher → quant → risk officer → trader → logger
//
// Deterministic control flow around the LLM ("AI does the logic; software does
// the action"): nodes exchange typed state; the only LLM touch points are the
// optional veto in the risk officer and rationale text in the logger. Any node
// that throws aborts the tick — nothing after it runs, so no order can be
// placed on a half-built state — and the cycle is recorded as `aborted`.

import {
  assetClassOf,
  TIMEFRAME_MS,
  universe as universeOf,
  type AccountKind,
  type CycleDto,
  type NodeMessageDto,
  type Timeframe,
  type TradingMode,
  type TraderConfig,
} from '@shared/trader/types';
import type { TraderEvent } from '@shared/trader/api';
import type { TraderDb } from '../db';
import type { DataPipeline } from '../data/pipeline';
import type { ModelRegistry } from '../model/registry';
import type { Predictor } from '../model/predictor';
import { FeatureEngine, namedFeatures } from '../features/engine';
import { decide, templateRationale, type TimeframeScore } from '../signals/core';
import type { RiskManager, RiskDecision } from '../risk/manager';
import { liveMarketContext } from '../risk/market';
import type { Oms } from '../execution/oms';
import type { ApprovedTrade, BrokerAdapter } from '../execution/types';
import type { TraderLlm } from './llm';
import type { Metrics } from '../monitor/metrics';
import type { AlertEngine } from '../monitor/alerts';
import type { PortfolioState, SignalProposal } from '../types';
import { LIMITS } from '../config';
import { isMarketOpen } from '../data/calendar';

export interface GraphDeps {
  db: TraderDb;
  config: () => TraderConfig;
  now: () => number;
  pipeline: DataPipeline;
  registry: ModelRegistry;
  risk: RiskManager;
  oms: Oms;
  llm: TraderLlm;
  metrics: Metrics;
  alerts: AlertEngine;
  mode: () => TradingMode;
  account: () => AccountKind;
  broker: (a: AccountKind) => BrokerAdapter | null;
  portfolio: (a: AccountKind) => Promise<PortfolioState>;
  guards: () => { killActive: boolean; killReason: string | null; consent: boolean; breakerTripped: boolean; breakerReason: string | null; liveAllowed: boolean };
  tripBreaker: (reason: string) => void;
  /** Book-wide daily-loss check every tick (not only when a proposal reaches the risk engine). */
  checkBreaker: (account: AccountKind) => Promise<void>;
  news?: (symbol: string) => Promise<string[]>;
  emit: (e: TraderEvent) => void;
  /** Skip network ingest (tests / offline replays drive bars directly). */
  skipIngest?: boolean;
}

interface LatestRow {
  barTs: number;
  close: number;
  atr: number;
  regime: string;
  x: number[];
  named: Record<string, number>;
}

interface TickState {
  cycle: CycleDto;
  advisory: boolean;
  mode: TradingMode;
  account: AccountKind;
  config: TraderConfig;
  universe: string[];
  stale: Set<string>;
  staleness: Array<{ symbol: string; timeframe: string; ms: number }>;
  baseTf: Timeframe | null;
  latest: Map<Timeframe, Map<string, LatestRow>>;
  research: NodeMessageDto | null;
  quant: NodeMessageDto | null;
  proposals: Array<{ proposal: SignalProposal; signalId: string }>;
  decisions: Array<{ signalId: string; proposal: SignalProposal; decision: RiskDecision; auditId: string; vetoed?: string }>;
  results: Array<{ signalId: string; orderId: string | null; error: string | null; shadowOrderId?: string | null }>;
  reconcileErrors: string[];
  nodes: NodeMessageDto[];
  signalTs: number;
  /** Set when every timeframe's ingest failed — no trading on stale features. */
  dataError: string | null;
}

class SkipTick extends Error {}

export class TraderGraph {
  private readonly engine = new FeatureEngine();

  constructor(private readonly deps: GraphDeps) {}

  private async node<T>(s: TickState, name: NodeMessageDto['node'], fn: () => Promise<{ summary: string; data?: unknown; out: T }>): Promise<T> {
    const started = this.deps.now();
    try {
      const r = await fn();
      s.nodes.push({ node: name, ok: true, ms: this.deps.now() - started, summary: r.summary, ...(r.data !== undefined ? { data: r.data } : {}) });
      return r.out;
    } catch (err) {
      if (err instanceof SkipTick) {
        s.nodes.push({ node: name, ok: true, ms: this.deps.now() - started, summary: err.message });
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      s.nodes.push({ node: name, ok: false, ms: this.deps.now() - started, summary: msg.slice(0, 500) });
      this.deps.metrics.inc('trader_agent_errors_total', { node: name });
      throw err;
    }
  }

  async runTick(opts: { trigger: CycleDto['trigger']; advisory: boolean }): Promise<CycleDto> {
    const config = this.deps.config();
    const mode = this.deps.mode();
    const account = this.deps.account();
    const started = this.deps.now();
    this.deps.llm.resetBudget();
    const cycle = this.deps.db.runs.createCycle(opts.trigger, mode, started);
    const s: TickState = {
      cycle,
      advisory: opts.advisory,
      mode,
      account,
      config,
      universe: universeOf(config),
      stale: new Set(),
      staleness: [],
      baseTf: null,
      latest: new Map(),
      research: null,
      quant: null,
      proposals: [],
      decisions: [],
      results: [],
      reconcileErrors: [],
      nodes: [],
      signalTs: 0,
      dataError: null,
    };
    let status: CycleDto['status'] = 'done';
    let abortReason: string | null = null;
    let skipReason: string | null = null;
    try {
      // Fresh bars first so fills, stops and time exits in reconcile see the latest prices.
      await this.data(s);
      await this.reconcile(s);
      await this.guard(s);
      if (s.dataError) throw new Error(s.dataError);
      await this.researcher(s);
      await this.quant(s);
      await this.riskOfficer(s);
      await this.trader(s);
    } catch (err) {
      if (err instanceof SkipTick) {
        status = 'skipped';
        skipReason = err.message;
      } else {
        status = 'aborted';
        abortReason = err instanceof Error ? err.message : String(err);
        this.deps.alerts.raise(
          { key: 'cycle_aborted', severity: 'warning', title: 'Trading cycle aborted — no orders were placed after the failure', detail: abortReason.slice(0, 1000) },
          this.deps.now(),
          15 * 60_000,
        );
      }
    }
    // Logger always runs (records what happened, even on abort/skip).
    await this.logger(s).catch((err) => {
      s.nodes.push({ node: 'logger', ok: false, ms: 0, summary: err instanceof Error ? err.message : String(err) });
    });
    const now = this.deps.now();
    this.deps.db.runs.finishCycle(cycle.id, {
      status,
      nodes: s.nodes,
      abortReason,
      skipReason,
      llmCalls: this.deps.llm.callsThisTick,
      signals: s.proposals.length,
      orders: s.results.filter((r) => r.orderId).length,
      now,
    });
    this.deps.metrics.inc('trader_cycles_total', { status });
    this.deps.metrics.observe('trader_tick_duration_ms', now - started);
    const done = this.deps.db.runs.cycle(cycle.id)!;
    this.deps.emit({ type: 'cycle', cycle: done });
    return done;
  }

  // ── nodes ────────────────────────────────────────────────────────────────

  private async reconcile(s: TickState): Promise<void> {
    await this.node(s, 'reconcile', async () => {
      const accounts: AccountKind[] = s.mode === 'live' ? ['live', 'shadow'] : ['paper'];
      const reports = [];
      for (const a of accounts) {
        if (!this.deps.broker(a)) continue;
        const r = await this.deps.oms.reconcile(a);
        reports.push(r);
        s.reconcileErrors.push(...r.errors);
      }
      const fills = reports.reduce((x, r) => x + r.fills, 0);
      const closed = reports.reduce((x, r) => x + r.closed, 0);
      return { summary: `${fills} fill(s), ${closed} trade(s) closed${s.reconcileErrors.length ? `, ${s.reconcileErrors.length} error(s)` : ''}`, data: reports, out: undefined };
    });
  }

  private async guard(s: TickState): Promise<void> {
    await this.node(s, 'guard', async () => {
      await this.deps.checkBreaker(s.account);
      const g = this.deps.guards();
      if (g.killActive) throw new SkipTick(`kill switch engaged${g.killReason ? `: ${g.killReason}` : ''}`);
      if (!g.consent) throw new SkipTick('risk disclosure not accepted yet');
      if (s.mode === 'live' && !g.liveAllowed) throw new SkipTick('live mode is not permitted (build flag or go-live checklist) — no trading');
      const cryptoEnabled = s.universe.some((x) => assetClassOf(x) === 'crypto');
      const now = this.deps.now();
      const clock = s.mode === 'live' || this.deps.broker(s.account)?.name.startsWith('alpaca') ? await this.deps.broker(s.account)?.getClock().catch(() => null) : null;
      const equityOpen = clock ? clock.isOpen : isMarketOpen('us_equity', now, s.config.schedule.extendedHours);
      if (!equityOpen && !cryptoEnabled) throw new SkipTick('market closed');
      if (g.breakerTripped && !s.advisory) throw new SkipTick(`circuit breaker tripped today${g.breakerReason ? `: ${g.breakerReason}` : ''} — no new entries`);
      if (!s.universe.length) throw new SkipTick('no enabled symbols');
      return { summary: `${s.advisory ? 'advisory scan' : 'autopilot'} · ${s.mode} · market ${equityOpen ? 'open' : 'closed (crypto only)'}`, out: undefined };
    });
  }

  private enabledTimeframes(s: TickState): Timeframe[] {
    const tfs = s.config.models.specs.filter((m) => m.enabled).map((m) => m.timeframe);
    return [...new Set(tfs)].sort((a, b) => TIMEFRAME_MS[a] - TIMEFRAME_MS[b]);
  }

  private async data(s: TickState): Promise<void> {
    await this.node(s, 'data', async () => {
      const tfs = this.enabledTimeframes(s);
      if (!tfs.length) throw new SkipTick('no model timeframes enabled');
      const summaries: string[] = [];
      let stored = 0;
      let failures = 0;
      if (!this.deps.skipIngest) {
        for (const tf of tfs) {
          const r = await this.deps.pipeline.ingest({ symbols: s.universe, timeframe: tf });
          stored += r.stored;
          if (r.errors.length) failures += 1;
          summaries.push(`${tf}: ${r.stored} bars via ${r.source}${r.errors.length ? ` (${r.errors.length} error)` : ''}`);
        }
        if (failures === tfs.length) s.dataError = `market data unavailable (${summaries.join('; ')}) — not trading without data`;
        try {
          await this.deps.pipeline.ingestTicks(s.universe);
        } catch {
          /* ticks are optional */
        }
      }
      const now = this.deps.now();
      const smallest = tfs[0]!;
      let worst = 0;
      for (const sym of s.universe) {
        const st = this.deps.pipeline.staleness(sym, smallest, now);
        if (st === null) {
          if (this.deps.db.market.lastTs(sym, smallest) === null) s.stale.add(sym);
          continue;
        }
        worst = Math.max(worst, st);
        s.staleness.push({ symbol: sym, timeframe: smallest, ms: st });
        if (st > s.config.monitor.dataGapMs) s.stale.add(sym);
      }
      this.deps.metrics.set('trader_data_max_staleness_ms', worst);
      this.deps.metrics.set('trader_stale_symbols', s.stale.size);
      return {
        summary: `${stored} bar(s) upserted (incl. 2-bar overlap)${summaries.length ? ` — ${summaries.join('; ')}` : ''}; ${s.stale.size} stale symbol(s)`,
        data: { stale: [...s.stale], staleness: s.staleness.slice(0, 50) },
        out: undefined,
      };
    });
  }

  private async researcher(s: TickState): Promise<void> {
    const msg = await this.node(s, 'researcher', async () => {
      const now = this.deps.now();
      const active = this.deps.registry.active();
      const regimes: Record<string, string> = {};
      let up = 0;
      let down = 0;
      for (const tf of this.enabledTimeframes(s)) {
        const perSymbol = new Map<string, LatestRow>();
        for (const sym of s.universe) {
          const bars = this.deps.db.market.bars(sym, tf, { limit: LIMITS.warmupBars * 4 });
          const frame = this.engine.compute(sym, tf, bars);
          const row = frame.rows[frame.rows.length - 1];
          if (!row) continue;
          const named = namedFeatures(row);
          perSymbol.set(sym, { barTs: row.ts, close: row.close, atr: row.atr, regime: row.regime, x: row.x, named });
          this.deps.db.market.upsertFeatures({
            symbol: sym,
            timeframe: tf,
            updated: now,
            barTs: row.ts,
            regime: row.regime,
            modelReady: active.has(tf) && row.ts === bars[bars.length - 1]?.ts,
            features: named,
          });
          if (!regimes[sym]) {
            regimes[sym] = row.regime;
            if (row.regime.startsWith('trend_up')) up += 1;
            if (row.regime.startsWith('trend_down')) down += 1;
          }
        }
        s.latest.set(tf, perSymbol);
      }
      const n = Object.keys(regimes).length || 1;
      const market = up / n > 0.6 ? 'broad up-trend' : down / n > 0.6 ? 'broad down-trend' : 'mixed / range-bound';
      let news: Record<string, string[]> = {};
      if (s.config.llm.news && this.deps.news) {
        const movers = [...(s.latest.get(this.enabledTimeframes(s)[0]!) ?? new Map<string, LatestRow>()).entries()]
          .sort((a, b) => Math.abs(b[1].named['roc_15'] ?? 0) - Math.abs(a[1].named['roc_15'] ?? 0))
          .slice(0, 3);
        news = Object.fromEntries(await Promise.all(movers.map(async ([sym]) => [sym, await this.deps.news!(sym).catch(() => [])] as const)));
      }
      const data = { marketRegime: market, trendUp: up, trendDown: down, symbols: n, regimes, news };
      return { summary: `market ${market}: ${up} up-trend, ${down} down-trend of ${n} symbols`, data, out: { node: 'researcher' as const, ok: true, ms: 0, summary: market, data } };
    });
    s.research = msg;
  }

  private async quant(s: TickState): Promise<void> {
    await this.node(s, 'quant', async () => {
      const active = this.deps.registry.active();
      if (!active.size) return { summary: 'no active model — train and promote one in Models', out: undefined };
      // Base timeframe: the smallest active timeframe with a new closed bar.
      const tfs = this.enabledTimeframes(s).filter((tf) => active.has(tf));
      let base: Timeframe | null = null;
      for (const tf of tfs) {
        const latestTs = Math.max(0, ...[...(s.latest.get(tf)?.values() ?? [])].map((r) => r.barTs));
        const scored = this.deps.db.ops.get<number>(`scored:${tf}`, 0);
        if (latestTs > scored || s.cycle.trigger !== 'schedule') {
          base = tf;
          break;
        }
      }
      if (!base) return { summary: 'no new closed bar since the last scan', out: undefined };
      s.baseTf = base;
      const strategies = this.deps.db.runs.strategies('active');
      const decisions: Array<{ symbol: string; reason: string; confidence: number }> = [];
      const candidates: SignalProposal[] = [];
      const basePred = active.get(base)!;
      let maxTs = 0;
      for (const sym of s.universe) {
        const row = s.latest.get(base)?.get(sym);
        if (!row) continue;
        maxTs = Math.max(maxTs, row.barTs);
        const scores: TimeframeScore[] = [];
        for (const [tf, pred] of active) {
          const r = s.latest.get(tf)?.get(sym);
          if (!r) continue;
          const p = pred.probUp(r.x);
          scores.push(this.score(tf, pred, p));
          this.deps.metrics.observe('trader_model_confidence', Math.max(p, 1 - p), { timeframe: tf });
          this.deps.db.ops.recordSamples([{ name: 'trader_model_confidence_sample', labels: tf, value: Math.max(p, 1 - p) }], this.deps.now());
          this.deps.registry.recordScores(tf, sym, r.barTs, r.x);
        }
        if (s.stale.has(sym)) {
          decisions.push({ symbol: sym, reason: 'stale data', confidence: 0 });
          continue;
        }
        if (this.deps.db.signals.existsForBar(sym, base, row.barTs) || this.deps.db.signals.existsForBar(sym, 'fused', row.barTs)) {
          decisions.push({ symbol: sym, reason: 'already scored this bar', confidence: 0 });
          continue;
        }
        const d = decide({
          symbol: sym,
          scores,
          base: { timeframe: base, barTs: row.barTs, close: row.close, atr: row.atr, regime: row.regime, features: row.named, drivers: '' },
          config: s.config,
          strategies,
        });
        decisions.push({ symbol: sym, reason: d.reason, confidence: Number(d.confidence.toFixed(3)) });
        if (d.proposal) {
          d.proposal.drivers = basePred.drivers(row.x);
          candidates.push(d.proposal);
        }
      }
      this.deps.db.ops.set(`scored:${base}`, maxTs, this.deps.now());
      candidates.sort((a, b) => b.confidence - a.confidence);
      const now = this.deps.now();
      s.signalTs = now;
      for (const p of candidates.slice(0, s.config.signals.maxSignalsPerTick)) {
        const sig = this.deps.db.signals.insert({
          cycleId: s.cycle.id,
          symbol: p.symbol,
          side: p.side,
          timeframe: p.timeframe,
          entry: p.entry,
          stop: p.stop,
          takeProfit: p.takeProfit,
          size: 0,
          confidence: p.confidence,
          edgePct: p.edgePct,
          horizonMin: p.horizonMin,
          modelVersion: p.modelVersion,
          strategyId: p.strategyId,
          source: 'model',
          status: 'proposed',
          rationale: templateRationale(p),
          perTimeframe: p.perTimeframe,
          features: { ...p.features, base_timeframe: p.baseTimeframe, max_hold_bars: p.maxHoldBars, model_hash: p.modelHash },
          barTs: p.barTs,
          now,
        });
        s.proposals.push({ proposal: p, signalId: sig.id });
        this.deps.metrics.observe('trader_signal_confidence', p.confidence);
        this.deps.emit({ type: 'signal', signal: sig });
      }
      const data = { base, decisions: decisions.slice(0, 60), emitted: s.proposals.map((x) => ({ symbol: x.proposal.symbol, side: x.proposal.side, confidence: x.proposal.confidence })) };
      s.quant = { node: 'quant', ok: true, ms: 0, summary: `${candidates.length} candidate(s) on ${base}`, data };
      return { summary: `scored ${decisions.length} symbol(s) on ${base}; ${s.proposals.length} signal(s)`, data, out: undefined };
    });
  }

  private score(tf: Timeframe, pred: Predictor, p: number): TimeframeScore {
    return { timeframe: tf, probUp: p, modelVersion: pred.version, modelHash: pred.hash, horizonBars: pred.meta.horizonBars, upAtr: pred.meta.upAtr, downAtr: pred.meta.downAtr };
  }

  private async riskOfficer(s: TickState): Promise<void> {
    if (!s.proposals.length) return;
    await this.node(s, 'risk', async () => {
      const portfolio = await this.deps.portfolio(s.account);
      const now = this.deps.now();
      const market = liveMarketContext({ db: this.deps.db, config: s.config, timeframe: s.baseTf ?? '15m', now, stale: s.stale });
      const lines: string[] = [];
      for (const { proposal, signalId } of s.proposals) {
        const decision = this.deps.risk.evaluate(proposal, {
          config: s.config.risk,
          minConfidence: s.config.signals.perSymbolThreshold[proposal.symbol] ?? s.config.signals.confidenceThreshold,
          maxTradesPerDay: s.config.risk.maxTradesPerDay,
          portfolio,
          market,
        });
        if (decision.tripBreaker) this.deps.tripBreaker(decision.reason);
        let vetoed: string | undefined;
        let llmMsg: NodeMessageDto['llm'] = null;
        if (decision.allowed && s.config.llm.riskReview && this.deps.llm.enabled()) {
          // Parse failure throws → tick aborts → no trade (by design).
          const review = await this.deps.llm.reviewRisk(proposal, decision);
          llmMsg = { model: review.call.model, prompt: review.call.prompt, reply: review.call.reply, ms: review.call.ms };
          if (review.veto) vetoed = review.reason || 'vetoed by the risk reviewer';
        }
        for (const r of decision.results.filter((x) => !x.passed)) this.deps.metrics.inc('trader_risk_rejections_total', { rule: r.rule });
        const auditId = this.deps.db.ledger.insertAudit({
          signalId,
          cycleId: s.cycle.id,
          features: proposal.features,
          modelVersion: proposal.modelVersion,
          modelHash: proposal.modelHash,
          research: s.research,
          quant: s.quant ? { ...s.quant, data: { proposal: { ...proposal, features: undefined } } } : null,
          risk: { allowed: decision.allowed && !vetoed, reason: vetoed ? `LLM veto: ${vetoed}` : decision.reason, suggestedSize: decision.suggestedSize, suggestedStop: decision.suggestedStop, suggestedTakeProfit: decision.suggestedTakeProfit, results: decision.results },
          trader: llmMsg ? { node: 'risk', ok: true, ms: llmMsg.ms, summary: vetoed ? `veto: ${vetoed}` : 'no veto', llm: llmMsg } : null,
          approvalTs: decision.allowed && !vetoed ? now : null,
          now,
        });
        if (!decision.allowed) {
          this.deps.db.signals.update(signalId, { status: 'rejected', reason: decision.reason.slice(0, 1000), size: 0 }, now);
        } else if (vetoed) {
          this.deps.db.signals.update(signalId, { status: 'vetoed', reason: `LLM risk review: ${vetoed}`.slice(0, 1000) }, now);
        } else {
          this.deps.db.signals.update(
            signalId,
            { status: s.advisory ? 'proposed' : 'approved', reason: s.advisory ? 'advisory scan — risk would approve; execute manually or turn on the autopilot' : null, size: decision.suggestedSize, stop: decision.suggestedStop, takeProfit: decision.suggestedTakeProfit },
            now,
          );
        }
        s.decisions.push({ signalId, proposal, decision, auditId, ...(vetoed ? { vetoed } : {}) });
        lines.push(`${proposal.symbol}: ${decision.allowed ? (vetoed ? 'VETOED' : `approved ×${decision.suggestedSize}`) : 'rejected'}`);
        if (decision.allowed && !vetoed && !s.advisory) {
          // Reserve room so the next proposal in this tick sees this one.
          portfolio.pendingEntries.push({ symbol: proposal.symbol, side: proposal.side, qty: decision.suggestedSize, price: proposal.entry });
          portfolio.openedToday += 1;
        }
      }
      return { summary: lines.join(', '), data: s.decisions.map((d) => ({ symbol: d.proposal.symbol, allowed: d.decision.allowed, reason: d.decision.reason, vetoed: d.vetoed ?? null })), out: undefined };
    });
  }

  private async trader(s: TickState): Promise<void> {
    const approved = s.decisions.filter((d) => d.decision.allowed && !d.vetoed);
    if (!approved.length || s.advisory) return;
    await this.node(s, 'trader', async () => {
      const now = this.deps.now();
      const lines: string[] = [];
      for (const d of approved) {
        const p = d.proposal;
        const trade: ApprovedTrade = {
          signalId: d.signalId,
          symbol: p.symbol,
          side: p.side,
          qty: d.decision.suggestedSize,
          entry: p.entry,
          stop: d.decision.suggestedStop,
          takeProfit: d.decision.suggestedTakeProfit,
          timeframe: p.baseTimeframe,
          maxHoldBars: p.maxHoldBars,
          expiresAt: now + s.config.signals.expiryBars * TIMEFRAME_MS[p.baseTimeframe] + 60_000,
          modelVersion: p.modelVersion,
          strategyId: p.strategyId,
        };
        if (!this.deps.db.signals.transition(d.signalId, ['approved'], 'submitted', now)) {
          lines.push(`${p.symbol}: skipped (signal no longer approved)`);
          continue;
        }
        const res = await this.deps.oms.submitEntry(trade, s.account);
        if (res.error || !res.order) {
          this.deps.db.signals.update(d.signalId, { status: 'failed', reason: (res.error ?? 'order not created').slice(0, 1000) }, this.deps.now());
          s.results.push({ signalId: d.signalId, orderId: res.order?.id ?? null, error: res.error ?? 'order not created' });
          lines.push(`${p.symbol}: FAILED ${res.error ?? ''}`.trim());
          if (res.error?.startsWith('validation failed')) throw new Error(`trader validation failed for ${p.symbol}: ${res.error}`);
          continue;
        }
        let shadowOrderId: string | null = null;
        if (s.mode === 'live' && this.deps.broker('shadow')) {
          const sh = await this.deps.oms.submitEntry(trade, 'shadow').catch(() => null);
          shadowOrderId = sh?.order?.id ?? null;
        }
        this.deps.metrics.observe('trader_signal_to_order_ms', this.deps.now() - s.signalTs);
        s.results.push({ signalId: d.signalId, orderId: res.order.id, error: null, shadowOrderId });
        lines.push(`${p.symbol}: ${res.order.side} ${res.order.qty} → ${res.order.status}`);
      }
      return { summary: lines.join('; '), data: s.results, out: undefined };
    });
  }

  private async logger(s: TickState): Promise<void> {
    const started = this.deps.now();
    // Audit: trader messages + order ids.
    for (const d of s.decisions) {
      const r = s.results.find((x) => x.signalId === d.signalId);
      if (!r) continue;
      const orderIds = [r.orderId, r.shadowOrderId].filter((x): x is string => Boolean(x));
      this.deps.db.ledger.updateAudit(d.auditId, {
        orderIds,
        trader: { node: 'trader', ok: !r.error, ms: 0, summary: r.error ? `order failed: ${r.error}` : `order ${r.orderId} submitted on ${s.account}`, data: { account: s.account, orderIds } },
      });
    }
    // Rationale: LLM within the remaining budget (after execution — never delays an order), template otherwise.
    let llmUsed = 0;
    for (const d of [...s.decisions].sort((a, b) => b.proposal.confidence - a.proposal.confidence)) {
      const res = await this.deps.llm.rationale(d.proposal, d.decision);
      if (res) {
        this.deps.db.signals.update(d.signalId, { rationale: res.text }, this.deps.now());
        if (res.call) llmUsed += 1;
      }
    }
    if (llmUsed) this.deps.metrics.inc('trader_llm_calls_total', {}, llmUsed);
    // Alerts + metric snapshot.
    this.deps.alerts.evaluate({ now: this.deps.now(), config: s.config, staleness: s.staleness, reconcileErrors: s.reconcileErrors });
    this.deps.db.ops.recordSamples(this.deps.metrics.samples(), this.deps.now());
    s.nodes.push({ node: 'logger', ok: true, ms: this.deps.now() - started, summary: `${s.decisions.length} audit record(s), ${llmUsed} LLM rationale(s)` });
  }
}
