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
import { getTradingService } from '@main/services/trading-service';
import { rsi, macd, atr, bollinger, sma, ema, swingLevels, trend } from '@shared/indicators';
import { detectPatterns } from '@shared/patterns';
import { forecastCone } from '@shared/forecast';
import { buildStockChart } from '@shared/stock-chart';
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
  place_trade: z.object({
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
          const trading = getTradingService();
          if (!trading) return failure(toolCallId, name, 'Trading not initialized');
          if (!trading.isConfigured()) {
            return failure(toolCallId, name, 'Trading not connected — the user must add Alpaca API keys on the Stocks screen');
          }
          try {
            const [status, account] = [trading.status(), await trading.account()];
            return ok(
              toolCallId,
              name,
              JSON.stringify({
                mode: status.paper ? 'paper' : 'live',
                autopilot: status.autopilot,
                guardrails: status.guardrails,
                dayStats: trading.dayStats(),
                account,
              }),
            );
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'place_trade': {
          const trading = getTradingService();
          if (!trading) return failure(toolCallId, name, 'Trading not initialized');
          if (!trading.isConfigured()) {
            return failure(toolCallId, name, 'Trading not connected — the user must add Alpaca API keys on the Stocks screen');
          }
          const a = parsed.data as z.infer<typeof argsSchemas.place_trade>;
          try {
            const { verdict, trade } = await trading.placeTrade(a);
            return ok(
              toolCallId,
              name,
              JSON.stringify({
                placed: verdict.allowed,
                qty: verdict.qty,
                notional: verdict.notional,
                blocked: verdict.blocked,
                notes: verdict.reasons,
                ...(trade ? { tradeId: trade.id } : {}),
              }),
            );
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'close_trade': {
          const trading = getTradingService();
          if (!trading || !trading.isConfigured()) {
            return failure(toolCallId, name, 'Trading not connected');
          }
          const a = parsed.data as z.infer<typeof argsSchemas.close_trade>;
          try {
            const res = await trading.closeBySymbol(a.symbol, a.reason);
            return res.ok
              ? ok(toolCallId, name, JSON.stringify(res))
              : failure(toolCallId, name, res.detail);
          } catch (err) {
            return failure(toolCallId, name, err instanceof Error ? err.message : String(err));
          }
        }
        case 'list_strategies': {
          const trading = getTradingService();
          if (!trading) return failure(toolCallId, name, 'Trading not initialized');
          return ok(toolCallId, name, JSON.stringify({ strategies: trading.strategies() }));
        }
        case 'save_strategy': {
          const trading = getTradingService();
          if (!trading) return failure(toolCallId, name, 'Trading not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.save_strategy>;
          const s = trading.createStrategy(a);
          return ok(
            toolCallId,
            name,
            JSON.stringify({ ok: true, id: s.id, name: s.name, params: s.params, status: s.status }),
          );
        }
        case 'trade_journal': {
          const trading = getTradingService();
          if (!trading) return failure(toolCallId, name, 'Trading not initialized');
          const a = parsed.data as z.infer<typeof argsSchemas.trade_journal>;
          const trades = trading.trades(a.limit ?? 25).map((t) => ({
            symbol: t.symbol,
            side: t.side,
            qty: t.qty,
            entry: t.entryPrice,
            stoploss: t.stoploss,
            takeProfit: t.takeProfit,
            exit: t.exitPrice,
            status: t.status,
            outcome: t.outcome,
            pnl: t.pnl,
            review: t.review,
            openedAt: new Date(t.openedAt).toISOString(),
            rationale: t.rationale.slice(0, 1000),
          }));
          return ok(
            toolCallId,
            name,
            JSON.stringify({ trades, lessons: trading.recentLessons(10) }),
          );
        }
        case 'generate_3d_model': {
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

// ── DuckDuckGo HTML search (no API key) ────────────────────────────────────

interface SearchHit {
  title: string;
  snippet: string;
  url: string;
}

const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function duckDuckGoSearch(query: string, limit: number): Promise<SearchHit[]> {
  // Try html.duckduckgo.com first; fall back to lite.duckduckgo.com if that
  // returns 0 hits (their bot filter rotates which page works). Final fallback
  // is the public Instant Answer JSON API for at least an abstract.
  const headers = {
    'User-Agent': UA_DESKTOP,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://duckduckgo.com/',
  };

  const hits: SearchHit[] = [];

  // Helper to parse the standard HTML result page.
  const parseHtmlPage = (html: string): void => {
    const blockRe =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(html)) !== null && hits.length < limit) {
      const rawUrl = decodeURIComponent(match[1]!.replace(/&amp;/g, '&'));
      let target = rawUrl;
      const wrap = /uddg=([^&]+)/.exec(rawUrl);
      if (wrap) target = decodeURIComponent(wrap[1]!);
      hits.push({
        url: target,
        title: stripHtml(match[2]!),
        snippet: stripHtml(match[3]!),
      });
    }
  };

  // Helper for the lite version (simpler markup, table-based).
  const parseLitePage = (html: string): void => {
    const liteRe = /<a class="result-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
    let m: RegExpExecArray | null;
    while ((m = liteRe.exec(html)) !== null && hits.length < limit) {
      const target = m[1]!;
      hits.push({
        url: target,
        title: stripHtml(m[2]!),
        snippet: stripHtml(m[3]!),
      });
    }
    // Fallback to a more permissive pattern if the structured one missed.
    if (hits.length === 0) {
      const looseRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]{6,})<\/a>/g;
      let mm: RegExpExecArray | null;
      const seen = new Set<string>();
      while ((mm = looseRe.exec(html)) !== null && hits.length < limit) {
        const u = mm[1]!;
        if (seen.has(u)) continue;
        seen.add(u);
        if (/duckduckgo\.com/.test(u)) continue;
        hits.push({ url: u, title: stripHtml(mm[2]!), snippet: '' });
      }
    }
  };

  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      { headers },
    );
    if (res.ok) parseHtmlPage(await res.text());
  } catch {
    // ignore — try next endpoint
  }

  if (hits.length === 0) {
    try {
      const res = await fetch(
        `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
        { headers },
      );
      if (res.ok) parseLitePage(await res.text());
    } catch {
      // ignore
    }
  }

  if (hits.length === 0) {
    // Instant-answer JSON API — limited but reliable. Returns abstract + topic
    // results for many queries.
    try {
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
        { headers: { 'User-Agent': UA_DESKTOP, Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          AbstractText?: string;
          AbstractURL?: string;
          Heading?: string;
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
        };
        if (data.AbstractText && data.AbstractURL) {
          hits.push({
            url: data.AbstractURL,
            title: data.Heading ?? query,
            snippet: data.AbstractText,
          });
        }
        for (const t of data.RelatedTopics ?? []) {
          if (hits.length >= limit) break;
          if (t.FirstURL && t.Text) {
            hits.push({ url: t.FirstURL, title: t.Text.slice(0, 80), snippet: t.Text });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Wikipedia full-text fallback. Always reachable, returns at least an
  // abstract for almost any query — good safety net when DDG is throttled.
  if (hits.length === 0) {
    try {
      const res = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*&srlimit=${limit}&srsearch=${encodeURIComponent(query)}`,
        { headers: { 'User-Agent': UA_DESKTOP, Accept: 'application/json' } },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          query?: { search?: Array<{ title: string; snippet: string; pageid: number }> };
        };
        for (const r of data.query?.search ?? []) {
          if (hits.length >= limit) break;
          hits.push({
            url: `https://en.wikipedia.org/?curid=${r.pageid}`,
            title: r.title,
            snippet: stripHtml(r.snippet),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  if (hits.length === 0) {
    throw new Error(
      `No search results for "${query}" across DuckDuckGo HTML/lite, DDG Instant Answer, and Wikipedia. Likely network blocked or the query is too narrow — try broader wording or a specific site (e.g. "OpenAI blog announcements").`,
    );
  }
  return hits;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
