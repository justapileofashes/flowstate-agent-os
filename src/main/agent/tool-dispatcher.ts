import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { FileTools } from '@main/tools';
import { runShell } from '@main/tools/shell-tool';
import { resolveSafe } from '@main/tools/path-sandbox';
import type { ToolResult } from './types';
import type { ApprovalGate } from './approval-gate';
import type { AgentRow, ChatRow } from '@main/repos/chat-repository';
import type { McpManager } from '@main/services/mcp-manager';
import type { SecondBrain } from '@main/services/second-brain';
import type { AuditLogger } from '@main/services/audit-logger';
import type { ConstitutionRule } from './constitution';
import type { SnapshotService } from '@main/services/snapshot-service';
import type { SkillRegistry } from '@main/services/skill-registry';
import type { HookRunner } from './hook-runner';
import {
  shouldCheckpoint,
  dueForCheckpoint,
  checkpointLabel,
} from './checkpoint-policy';
import { sceneSchema, buildThreeViewer, buildOpenSCAD } from './model-3d';
import { app } from 'electron';
import { join } from 'node:path';
import { MarketDataService } from '@main/services/market-data';
import { getTraderService } from '@main/trader/service';
import { strategyParamsSchema } from '@shared/trader/types';
import { rsi, macd, atr, bollinger, sma, ema, swingLevels, trend } from '@shared/indicators';
import { detectPatterns } from '@shared/patterns';
import { forecastCone } from '@shared/forecast';
import { buildStockChart } from '@shared/stock-chart';
import { duckDuckGoSearch } from '@main/services/web-search';
import type { Range } from '@shared/market-types';

export const MAX_TOOL_OUTPUT_BYTES = 100_000;

const argsSchemas = {
  read_file: z.object({ path: z.string() }),
  list_dir: z.object({ path: z.string() }),
  write_file: z.object({ path: z.string(), content: z.string() }),
  delete_file: z.object({ path: z.string() }),
  search_files: z.object({
    pattern: z.string(),
    kind: z.enum(['name', 'content']),
  }),
  run_shell: z.object({ command: z.string() }),
  brain_capture: z.object({
    text: z.string().min(1).max(2000),
    tags: z.array(z.string()).max(10).optional(),
  }),
  brain_note: z.object({
    category: z.enum(['projects', 'areas', 'resources', 'archive', 'routines']),
    title: z.string().min(1).max(120),
    body: z.string().max(50000),
    tags: z.array(z.string()).max(20).optional(),
    links: z.array(z.string()).max(40).optional(),
  }),
  brain_search: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().positive().max(50).optional(),
  }),
  design_artifact: z.object({
    title: z.string().min(1).max(120),
    language: z.enum(['html', 'svg']),
    source: z.string().min(1).max(200_000),
  }),
  run_code: z.object({
    language: z.enum(['javascript']),
    source: z.string().min(1).max(50_000),
  }),
  web_search: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().positive().max(10).optional(),
  }),
  stock_data: z.object({
    symbol: z.string().min(1).max(20),
    range: z.enum(['1m', '3m', '6m', '1y', '2y', '5y', 'max']).optional(),
    indicators: z
      .array(z.enum(['rsi', 'macd', 'atr', 'bollinger', 'sma', 'ema', 'patterns']))
      .optional(),
  }),
  stock_chart: z.object({
    symbol: z.string().min(1).max(20),
    range: z.enum(['1m', '3m', '6m', '1y', '2y', '5y', 'max']).optional(),
    entry: z.number().optional(),
    stoploss: z.number().optional(),
    takeProfit: z.array(z.number()).max(5).optional(),
    outlook: z.enum(['bullish', 'bearish', 'neutral']).optional(),
    confidence: z.number().min(0).max(1).optional(),
    horizon: z.number().int().positive().max(120).optional(),
    patterns: z.boolean().optional(),
  }),
  generate_3d_model: sceneSchema,
  skill: z.object({ name: z.string().min(1).max(80) }),
  trading_account: z.object({}),
  propose_trade: z.object({
    symbol: z.string().min(1).max(10),
    side: z.enum(['buy', 'sell']),
    entry: z.number().positive(),
    stoploss: z.number().positive(),
    takeProfit: z.number().positive(),
    qty: z.number().positive().max(100_000).optional(),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(2000),
    strategyId: z.string().max(64).optional(),
  }),
  close_trade: z.object({
    symbol: z.string().min(1).max(10),
    reason: z.string().min(1).max(2000),
  }),
  list_strategies: z.object({}),
  save_strategy: z.object({
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(2000),
    inspiration: z.string().min(1).max(2000),
    params: z.record(z.unknown()),
  }),
  trade_journal: z.object({ limit: z.number().int().positive().max(200).optional() }),
  trader_signals: z.object({ limit: z.number().int().positive().max(200).optional() }),
} as const;

type ToolName = keyof typeof argsSchemas;

function isKnownTool(name: string): name is ToolName {
  return name in argsSchemas;
}

function ok(id: string, name: string, content: string): ToolResult {
  return { toolCallId: id, toolName: name, ok: true, content: cap(content) };
}

function failure(id: string, name: string, msg: string): ToolResult {
  // Prefix sentinel so renderer can distinguish failure from success after
  // the result is persisted as a tool message (the ok flag is not stored
  // in chat-repository — only the content string is).
  const text = msg.startsWith('ERROR:') ? msg : 'ERROR: ' + msg;
  return { toolCallId: id, toolName: name, ok: false, content: cap(text) };
}

function cap(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT_BYTES) return s;
  return (
    s.slice(0, MAX_TOOL_OUTPUT_BYTES) +
    `\n\n[truncated: ${s.length - MAX_TOOL_OUTPUT_BYTES} more bytes]`
  );
}

export interface ToolDispatcherDeps {
  fileTools: FileTools;
  workspaceRoot: string;
  approvalGate?: ApprovalGate;
  agent?: AgentRow;
  chat?: ChatRow;
  streamId?: string;
  mcpManager?: McpManager;
  brain?: SecondBrain;
  audit?: AuditLogger;
  constitution?: ConstitutionRule[];
  snapshots?: SnapshotService;
  skillRegistry?: SkillRegistry;
  hooks?: HookRunner;
}

export class ToolDispatcher {
  private lastCheckpointTs = 0;
  private marketData?: MarketDataService;

  constructor(private readonly deps: ToolDispatcherDeps) {}

  private getMarketData(): MarketDataService {
    if (!this.marketData) {
      const cacheDir = join(app.getPath('userData'), 'market-cache');
      this.marketData = new MarketDataService({ cacheDir });
    }
    return this.marketData;
  }

  async call(toolCallId: string, name: string, rawArgs: unknown): Promise<ToolResult> {
    const start = Date.now();

    // Plugin PreToolUse hooks (consent-gated upstream) can veto a tool call.
    if (this.deps.hooks) {
      const pre = await this.deps.hooks.fire('PreToolUse', this.hookContext(name));
      if (pre.blocked) {
        return failure(toolCallId, name, `Blocked by plugin hook: ${pre.reason ?? 'denied'}`);
      }
    }

    const result = await this.callInner(toolCallId, name, rawArgs);

    if (this.deps.hooks) {
      await this.deps.hooks.fire('PostToolUse', this.hookContext(name));
    }
    if (this.deps.audit && this.deps.agent) {
      this.deps.audit.toolCall(
        {
          agentId: this.deps.agent.id,
          chatId: this.deps.chat?.id ?? null,
          streamId: this.deps.streamId ?? null,
        },
        {
          toolName: name,
          args: rawArgs,
          ok: result.ok,
          durationMs: Date.now() - start,
        },
      );
    }
    return result;
  }

  private async callInner(toolCallId: string, name: string, rawArgs: unknown): Promise<ToolResult> {
    // Pre-2.0 prompts call place_trade; it now only proposes (same deterministic pipeline).
    if (name === 'place_trade') return this.callInner(toolCallId, 'propose_trade', rawArgs);
    // MCP tools (mcp__<server>__<tool>) route through the manager.
    if (name.startsWith('mcp__')) {
      if (!this.deps.mcpManager) {
        return failure(toolCallId, name, 'MCP not configured on this dispatcher');
      }
      try {
        const res = await this.deps.mcpManager.callTool(name, rawArgs);
        if (res.isError) return failure(toolCallId, name, res.content);
        return ok(toolCallId, name, res.content);
      } catch (err) {
        return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
      }
    }
    if (!isKnownTool(name)) {
      return failure(toolCallId, name, `unknown tool: ${name}`);
    }
    const schema = argsSchemas[name];
    const parsed = schema.safeParse(rawArgs);
    if (!parsed.success) {
      const detail = parsed.error.errors
        .map((e) => `${e.path.join('.') || '<root>'}: ${e.message}`)
        .join('; ');
      return failure(toolCallId, name, `invalid args: ${detail}`);
    }

    const gate = this.deps.approvalGate;
    if (gate && this.deps.agent && this.deps.chat && this.deps.streamId) {
      let isOverwrite = false;
      if (name === 'write_file') {
        try {
          const target = resolveSafe(
            this.deps.workspaceRoot,
            (parsed.data as { path: string }).path,
          );
          isOverwrite = existsSync(target);
        } catch {
          isOverwrite = false;
        }
      }
      const decision = await gate.require({
        streamId: this.deps.streamId,
        chatId: this.deps.chat.id,
        agent: this.deps.agent,
        toolCallId,
        toolName: name,
        args: parsed.data,
        cwd: this.deps.workspaceRoot,
        isOverwrite,
        ...(this.deps.constitution ? { constitution: this.deps.constitution } : {}),
      });
      if (decision === 'deny') {
        return failure(toolCallId, name, 'Denied by approval policy or agent constitution.');
      }
    }

    // Auto safety checkpoint before destructive changes, so the user can always
    // roll back via the Snapshots UI. Best-effort — never blocks the tool call.
    await this.maybeCheckpoint(name, parsed.data);

    try {
      switch (name) {
        case 'read_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.read_file>;
          const content = await this.deps.fileTools.readFile(a.path);
          return ok(toolCallId, name, content);
        }
        case 'list_dir': {
          const a = parsed.data as z.infer<typeof argsSchemas.list_dir>;
          const entries = await this.deps.fileTools.listDir(a.path);
          return ok(toolCallId, name, JSON.stringify(entries));
        }
        case 'write_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.write_file>;
          const result = await this.deps.fileTools.writeFile(a.path, a.content);
          return ok(toolCallId, name, JSON.stringify(result));
        }
        case 'delete_file': {
          const a = parsed.data as z.infer<typeof argsSchemas.delete_file>;
          await this.deps.fileTools.deleteFile(a.path);
          return ok(toolCallId, name, 'ok');
        }
        case 'search_files': {
          const a = parsed.data as z.infer<typeof argsSchemas.search_files>;
          const hits = await this.deps.fileTools.searchFiles({
            pattern: a.pattern,
            kind: a.kind,
          });
          return ok(toolCallId, name, JSON.stringify(hits));
        }
        case 'run_shell': {
          const a = parsed.data as z.infer<typeof argsSchemas.run_shell>;
          const result = await runShell(a.command, this.deps.workspaceRoot);
          return ok(
            toolCallId,
            name,
            JSON.stringify({
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              truncated: result.truncated,
              durationMs: result.durationMs,
            }),
          );
        }
        case 'brain_capture': {
          if (!this.deps.brain) return failure(toolCallId, name, 'Brain not configured');
          const a = parsed.data as z.infer<typeof argsSchemas.brain_capture>;
          const res = await this.deps.brain.capture(a.text, {
            ...(this.deps.agent ? { source: this.deps.agent.name } : {}),
            ...(a.tags ? { tags: a.tags } : {}),
          });
          return ok(toolCallId, name, JSON.stringify(res));
        }
        case 'brain_note': {
          if (!this.deps.brain) return failure(toolCallId, name, 'Brain not configured');
          const a = parsed.data as z.infer<typeof argsSchemas.brain_note>;
          const res = await this.deps.brain.writeNote({
            category: a.category,
            title: a.title,
            body: a.body,
            ...(a.tags ? { tags: a.tags } : {}),
            ...(a.links ? { links: a.links } : {}),
          });
          return ok(toolCallId, name, JSON.stringify(res));
        }
        case 'brain_search': {
          if (!this.deps.brain) return failure(toolCallId, name, 'Brain not configured');
          const a = parsed.data as z.infer<typeof argsSchemas.brain_search>;
          const hits = await this.deps.brain.search(a.query, a.limit ?? 25);
          return ok(toolCallId, name, JSON.stringify(hits));
        }
        case 'run_code': {
          const a = parsed.data as z.infer<typeof argsSchemas.run_code>;
          const result = await runJavaScriptSandbox(a.source, 5000);
          return ok(toolCallId, name, JSON.stringify(result));
        }
        case 'web_search': {
          const a = parsed.data as z.infer<typeof argsSchemas.web_search>;
          try {
            const hits = await duckDuckGoSearch(a.query, a.limit ?? 5);
            return ok(toolCallId, name, JSON.stringify(hits));
          } catch (err) {
            return failure(
              toolCallId,
              name,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        case 'stock_data': {
          const a = parsed.data as z.infer<typeof argsSchemas.stock_data>;
          try {
            const range = (a.range ?? '1y') as Range;
            const bars = await this.getMarketData().history(a.symbol, range);
            const want = new Set(a.indicators ?? ['rsi', 'macd', 'atr']);
            const closes = bars.map((b) => b.close);
            const indicators: Record<string, unknown> = {};
            if (want.has('rsi')) indicators.rsi = lastDefined(rsi(bars, 14));
            if (want.has('macd')) {
              const m = macd(bars);
              indicators.macd = m[m.length - 1] ?? null;
            }
            if (want.has('atr')) indicators.atr = lastDefined(atr(bars, 14));
            if (want.has('bollinger')) {
              const b = bollinger(bars);
              indicators.bollinger = b[b.length - 1] ?? null;
            }
            if (want.has('sma')) indicators.sma = lastDefined(sma(closes, 20));
            if (want.has('ema')) indicators.ema = lastDefined(ema(closes, 20));
            const swings = swingLevels(bars);
            const patterns = want.has('patterns') ? detectPatterns(bars, swings) : undefined;
            const last = bars[bars.length - 1];
            return ok(
              toolCallId,
              name,
              JSON.stringify({
                symbol: a.symbol,
                range,
                trend: trend(bars),
                bars: bars.slice(-400),
                indicators,
                swingLevels: swings,
                ...(patterns ? { patterns } : {}),
                quote: last ? { price: last.close, asOf: last.time } : null,
              }),
            );
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'stock_chart': {
          const a = parsed.data as z.infer<typeof argsSchemas.stock_chart>;
          try {
            const range = (a.range ?? '6m') as Range;
            const bars = await this.getMarketData().history(a.symbol, range);
            if (bars.length === 0) return failure(toolCallId, name, `no data for ${a.symbol}`);
            const lastClose = bars[bars.length - 1]!.close;
            const atrNow = lastDefined(atr(bars, 14)) ?? Math.max(0.01, lastClose * 0.02);
            const confidence = a.confidence ?? 0.5;
            const sign = a.outlook === 'bullish' ? 1 : a.outlook === 'bearish' ? -1 : 0;
            const drift = sign * atrNow * (0.15 + 0.25 * confidence);
            const horizon = a.horizon ?? 20;
            const forecast = forecastCone({ lastClose, atr: atrNow, drift, horizon, confidence });
            const patterns =
              a.patterns === false ? undefined : detectPatterns(bars, swingLevels(bars));
            const html = buildStockChart({
              symbol: a.symbol,
              bars,
              ...(typeof a.entry === 'number' ? { entry: a.entry } : {}),
              ...(typeof a.stoploss === 'number' ? { stoploss: a.stoploss } : {}),
              ...(a.takeProfit ? { takeProfit: a.takeProfit } : {}),
              forecast,
              ...(patterns ? { patterns } : {}),
              confidence,
            });
            const safeName = a.symbol.replace(/[^a-z0-9-_^]+/gi, '_').slice(0, 40) || 'chart';
            const path = `charts/${safeName}-chart.html`;
            await this.deps.fileTools.writeFile(path, html);
            return ok(
              toolCallId,
              name,
              JSON.stringify({
                ok: true,
                symbol: a.symbol,
                file: path,
                bars: bars.length,
                note: 'Chart written. Embed the returned html in your reply inside a ```html fenced block so the Artifact view renders it.',
                html,
              }),
            );
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'trading_account': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          try {
            return ok(toolCallId, name, JSON.stringify(await trader.summary()));
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'propose_trade': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.propose_trade>;
          try {
            const res = await trader.proposeFromAgent({
              symbol: a.symbol.toUpperCase(),
              side: a.side === 'sell' ? 'short' : 'long',
              entry: a.entry,
              stop: a.stoploss,
              takeProfit: a.takeProfit,
              confidence: a.confidence,
              reason: a.reason,
              ...(a.qty ? { qty: a.qty } : {}),
              ...(a.strategyId ? { strategyId: a.strategyId } : {}),
            });
            return ok(
              toolCallId,
              name,
              JSON.stringify({
                ...res,
                note: 'Proposals never reach the broker directly: the risk engine sizes or rejects them, and they execute only when the autopilot is on (or the user clicks Execute).',
              }),
            );
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'close_trade': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.close_trade>;
          try {
            const res = await trader.handle('positions.close', { symbol: a.symbol.toUpperCase() }, 'agent');
            return res.ok ? ok(toolCallId, name, JSON.stringify({ ok: true, order: res.order, reason: a.reason })) : failure(toolCallId, name, res.error ?? 'close failed');
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'list_strategies': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          return ok(toolCallId, name, JSON.stringify({ strategies: trader.db.runs.strategies() }));
        }
        case 'save_strategy': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.save_strategy>;
          const params = strategyParamsSchema.safeParse(a.params);
          if (!params.success) {
            return failure(
              toolCallId,
              name,
              `invalid params: ${params.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}. Expected { timeframes?: ("5m"|"15m"|"1h"|"1d")[], minConfidence?: 0.5..0.99, sides?: ("long"|"short")[], regimes?: ("trend_up"|"trend_down"|"range"|"high_vol"|"normal_vol"|"low_vol")[], featureFilters?: [{feature, op: ">"|">="|"<"|"<=", value}], stopAtrMult?, takeProfitAtrMult?, maxHoldBars? }`,
            );
          }
          const res = await trader.handle('strategies.save', { name: a.name, description: a.description, inspiration: a.inspiration, params: params.data }, 'agent');
          return ok(toolCallId, name, JSON.stringify({ ok: true, strategy: res.strategy }));
        }
        case 'trade_journal': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.trade_journal>;
          const res = await trader.handle('trades.list', { limit: a.limit ?? 25 });
          return ok(
            toolCallId,
            name,
            JSON.stringify({
              trades: res.trades.map((t) => ({
                symbol: t.symbol,
                side: t.side,
                account: t.account,
                qty: t.qty,
                entry: t.entryPrice,
                exit: t.exitPrice,
                stop: t.stop,
                takeProfit: t.takeProfit,
                status: t.status,
                outcome: t.outcome,
                pnl: t.pnl,
                exitReason: t.exitReason,
                model: t.modelVersion,
                review: t.review,
                openedAt: new Date(t.openedAt).toISOString(),
              })),
              lessons: res.lessons,
            }),
          );
        }
        case 'trader_signals': {
          const trader = getTraderService();
          if (!trader) return failure(toolCallId, name, 'AI Trader not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.trader_signals>;
          const res = await trader.handle('signals.list', { since: 'week', limit: a.limit ?? 30 });
          return ok(
            toolCallId,
            name,
            JSON.stringify(
              res.signals.map((s) => ({
                symbol: s.symbol,
                side: s.side,
                confidence: s.confidence,
                edgePct: s.edgePct,
                status: s.status,
                reason: s.reason,
                rationale: s.rationale,
                model: s.modelVersion,
                at: new Date(s.createdAt).toISOString(),
              })),
            ),
          );
        }        case 'generate_3d_model': {
          const scene = parsed.data as z.infer<typeof argsSchemas.generate_3d_model>;
          const safeName = (scene.name || 'model').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60) || 'model';
          const html = buildThreeViewer(scene);
          const scad = buildOpenSCAD(scene);
          const htmlPath = `models/${safeName}.html`;
          const scadPath = `models/${safeName}.scad`;
          await this.deps.fileTools.writeFile(htmlPath, html);
          await this.deps.fileTools.writeFile(scadPath, scad);
          return ok(
            toolCallId,
            name,
            JSON.stringify({
              ok: true,
              name: scene.name,
              parts: scene.primitives.length,
              viewer: htmlPath,
              openscad: scadPath,
              note: 'Model written. Embed the viewer HTML in your reply inside a ```html fenced block so the Artifact view renders the interactive 3D model. The .scad file can be opened in OpenSCAD to export an STL for 3D printing.',
              html,
            }),
          );
        }
        case 'skill': {
          if (!this.deps.skillRegistry) return failure(toolCallId, name, 'Skills not configured');
          if (!this.deps.agent) return failure(toolCallId, name, 'No agent context for skill');
          const a = parsed.data as z.infer<typeof argsSchemas.skill>;
          try {
            const body = await this.deps.skillRegistry.load(this.deps.agent.id, a.name);
            return ok(toolCallId, name, body);
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'design_artifact': {
          // Artifact is rendered by the renderer from the assistant message —
          // this tool exists to make the agent commit to producing the
          // exact fenced output downstream renderers expect. We just echo
          // a confirmation; the next assistant message should embed the
          // source as ```<language>\n...\n``` for the Artifact view.
          const a = parsed.data as z.infer<typeof argsSchemas.design_artifact>;
          return ok(
            toolCallId,
            name,
            JSON.stringify({
              ok: true,
              title: a.title,
              language: a.language,
              chars: a.source.length,
              note: 'Embed the source in your reply inside a fenced code block so the Artifact view can render it.',
            }),
          );
        }
      }
    } catch (err) {
      return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
    }
  }

  private hookContext(toolName: string): {
    toolName: string;
    cwd: string;
    agentId?: string;
    chatId?: string | null;
    streamId?: string | null;
  } {
    return {
      toolName,
      cwd: this.deps.workspaceRoot,
      ...(this.deps.agent ? { agentId: this.deps.agent.id } : {}),
      chatId: this.deps.chat?.id ?? null,
      streamId: this.deps.streamId ?? null,
    };
  }

  /** Snapshot the workspace before a destructive tool call (throttled). */
  private async maybeCheckpoint(name: string, args: unknown): Promise<void> {
    const snaps = this.deps.snapshots;
    if (!snaps || !this.deps.agent) return;

    let isOverwrite = false;
    if (name === 'write_file') {
      try {
        const target = resolveSafe(this.deps.workspaceRoot, (args as { path: string }).path);
        isOverwrite = existsSync(target);
      } catch {
        isOverwrite = false;
      }
    }
    if (!shouldCheckpoint(name, { isOverwrite })) return;

    const now = Date.now();
    if (!dueForCheckpoint(this.lastCheckpointTs, now)) return;

    try {
      await snaps.create({
        agentId: this.deps.agent.id,
        workspacePath: this.deps.workspaceRoot,
        label: checkpointLabel(name),
      });
      this.lastCheckpointTs = now;
      this.deps.audit?.checkpoint(
        {
          agentId: this.deps.agent.id,
          chatId: this.deps.chat?.id ?? null,
          streamId: this.deps.streamId ?? null,
        },
        { toolName: name, detail: checkpointLabel(name) },
      );
    } catch {
      // Snapshotting must never block the agent — ignore failures.
    }
  }
}

// ── JS sandbox for the run_code tool ───────────────────────────────────────

interface SandboxResult {
  ok: boolean;
  logs: string[];
  result: unknown;
  error?: string;
  durationMs: number;
}

async function runJavaScriptSandbox(source: string, timeoutMs: number): Promise<SandboxResult> {
  const vm = await import('node:vm');
  const start = Date.now();
  const logs: string[] = [];
  const fakeConsole = {
    log: (...args: unknown[]) => logs.push(args.map(formatArg).join(' ')),
    info: (...args: unknown[]) => logs.push(args.map(formatArg).join(' ')),
    warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(formatArg).join(' ')),
    error: (...args: unknown[]) => logs.push('[error] ' + args.map(formatArg).join(' ')),
  };
  const ctx: Record<string, unknown> = {
    console: fakeConsole,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Buffer: undefined, // explicitly omit
    process: undefined,
    require: undefined,
    fetch: undefined,
  };
  try {
    const script = new vm.Script(`(async () => { ${source} \n })()`);
    const context = vm.createContext(ctx);
    const result = await Promise.race([
      script.runInContext(context, { timeout: timeoutMs }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs + 200),
      ),
    ]);
    return {
      ok: true,
      logs,
      result: serializeResult(result),
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      logs,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function serializeResult(v: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
}

function lastDefined<T>(arr: (T | null)[]): T | null {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null) return arr[i] as T;
  return null;
}
