import type { ToolSpec } from './types';

export const FILE_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'read_file',
    description:
      'Read a UTF-8 text file inside the agent workspace. Returns file contents (capped at 100 KB).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Workspace-relative path. No leading slash, no ".." traversal.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_dir',
    description: 'List entries in a workspace directory. Returns JSON array of {name, kind}.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: "Workspace-relative path. Use '.' for root." },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or overwrite a UTF-8 file. Parent directories are created automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file (not a directory). Irreversible.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description:
      'Search the workspace. kind="name" matches file paths against a glob (e.g. "*.ts" finds files at any depth). kind="content" greps file contents with a regex. Returns up to 200 hits.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string' },
        kind: { type: 'string', enum: ['name', 'content'] },
      },
      required: ['pattern', 'kind'],
    },
  },
];

export const SHELL_TOOL_SPEC: ToolSpec = {
  name: 'run_shell',
  description:
    'Run a non-interactive shell command in the workspace directory. No pipes, redirects, or interactive prompts. Always requires user approval (per agent policy).',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Full command with args, e.g. "npm install react".',
      },
    },
    required: ['command'],
  },
};

export const CODE_INTERPRETER_TOOL_SPEC: ToolSpec = {
  name: 'run_code',
  description:
    'Execute JavaScript in a sandboxed VM context (no fs, no network, no process). Captures console.log + return value. 5 second timeout. Use for math, data transformations, parsing, quick computation. Return statements in top-level work via implicit async wrapper.',
  parameters: {
    type: 'object',
    properties: {
      language: { type: 'string', enum: ['javascript'] },
      source: { type: 'string', description: 'JS code. console.log is captured. Last expression value returns.' },
    },
    required: ['language', 'source'],
  },
};

export const WEB_SEARCH_TOOL_SPEC: ToolSpec = {
  name: 'web_search',
  description:
    'Search the public web via DuckDuckGo HTML. Returns top results with title + snippet + URL. Use to verify facts, find recent docs, gather context the model could not memorize.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      limit: { type: 'number', description: 'Max results, 1-10. Default 5.' },
    },
    required: ['query'],
  },
};

export const STOCK_DATA_TOOL_SPEC: ToolSpec = {
  name: 'stock_data',
  description:
    'Fetch real OHLCV price history for a stock/ETF/index/forex/crypto symbol plus computed technical indicators and detected chart patterns. Use this for any market analysis — never guess prices. Returns JSON {symbol, range, trend, bars, indicators, swingLevels, patterns, quote}. Symbols: US tickers like AAPL, indices like ^spx, forex like eurusd, crypto like btcusd.',
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker, e.g. AAPL, ^spx, eurusd, btcusd.' },
      range: {
        type: 'string',
        enum: ['1m', '3m', '6m', '1y', '2y', '5y', 'max'],
        description: 'History window. Default 1y.',
      },
      indicators: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['rsi', 'macd', 'atr', 'bollinger', 'sma', 'ema', 'patterns'],
        },
        description: 'Which indicators/patterns to compute. Default: rsi, macd, atr.',
      },
    },
    required: ['symbol'],
  },
};

export const STOCK_CHART_TOOL_SPEC: ToolSpec = {
  name: 'stock_chart',
  description:
    "Render a candlestick chart for a symbol with your trade levels and forward forecast, for the user's Artifact view. Layers: candles, entry/stoploss/take-profit lines, a 3-line forecast (bull/base/bear) projected forward, and detected chart patterns. Pass the entry/stoploss/take-profit you derived, your outlook and confidence. After calling this, embed the returned `html` in your reply inside a fenced ```html block so the Artifact view renders it.",
  parameters: {
    type: 'object',
    properties: {
      symbol: { type: 'string', description: 'Ticker, e.g. AAPL, ^spx, eurusd, btcusd.' },
      range: {
        type: 'string',
        enum: ['1m', '3m', '6m', '1y', '2y', '5y', 'max'],
        description: 'History window to draw. Default 6m.',
      },
      entry: { type: 'number', description: 'Entry price level.' },
      stoploss: { type: 'number', description: 'Stoploss (invalidation) price level.' },
      takeProfit: { type: 'array', items: { type: 'number' }, description: 'One or more take-profit targets.' },
      outlook: {
        type: 'string',
        enum: ['bullish', 'bearish', 'neutral'],
        description: 'Direction of your forecast. Default neutral.',
      },
      confidence: { type: 'number', description: '0..1 confidence in the call. Default 0.5.' },
      horizon: { type: 'number', description: 'Bars to project forward. Default 20.' },
      patterns: { type: 'boolean', description: 'Detect + draw chart patterns. Default true.' },
    },
    required: ['symbol'],
  },
};

/** AI Trader tools. Agents can read state and PROPOSE trades; proposals enter
 *  the same deterministic pipeline as model signals (schema → risk engine →
 *  OMS) and never reach the broker directly. Paper trading by default. */
export const TRADING_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'trading_account',
    description:
      "Get the AI Trader's state: mode (paper/live), autopilot, kill switch and circuit breaker, active models, equity, cash, today's P&L, drawdown, open positions with stops/targets, and the risk limits. Call this before proposing any trade.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'propose_trade',
    description:
      'Propose a trade to the AI Trader. It is NOT sent to the broker by you: the deterministic risk engine validates the numbers, sizes it (fixed-fractional, ATR stops, exposure/sector/correlation/liquidity caps, daily loss breaker) or rejects it with reasons, and the OMS executes it only when the autopilot is on — otherwise it waits in Signals for the user. Use stock_data first; never invent prices.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'US equity/ETF ticker, e.g. AAPL.' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'buy = long. sell = short (only if shorting is enabled in the risk config).' },
        entry: { type: 'number', description: 'Current/intended entry price from stock_data.' },
        stoploss: { type: 'number', description: 'Stop price (below entry for a long).' },
        takeProfit: { type: 'number', description: 'Take-profit price.' },
        qty: { type: 'number', description: 'Optional share count; the risk engine can only shrink it.' },
        confidence: { type: 'number', description: 'Your 0..1 confidence. Below the configured threshold is rejected.' },
        reason: { type: 'string', description: 'One-paragraph rationale — stored with the signal and in the audit trail.' },
        strategyId: { type: 'string', description: 'Optional id from list_strategies.' },
      },
      required: ['symbol', 'side', 'entry', 'stoploss', 'takeProfit', 'confidence', 'reason'],
    },
  },
  {
    name: 'close_trade',
    description: 'Close an open position at market through the OMS (cancels its protective orders) and record your reason.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        reason: { type: 'string', description: 'Why you are closing.' },
      },
      required: ['symbol', 'reason'],
    },
  },
  {
    name: 'trader_signals',
    description: "List the AI Trader's recent model signals: confidence, expected edge, status (approved/rejected with the risk engine's reason), rationale and model version.",
    parameters: { type: 'object', properties: { limit: { type: 'number', description: 'Max signals, default 30.' } } },
  },
  {
    name: 'list_strategies',
    description:
      'List the strategy composer: each strategy filters model signals (timeframes, min confidence, sides, regimes, feature filters) and sets ATR stop/target multiples and max holding bars; with win/loss record, P&L, lessons and status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'save_strategy',
    description:
      'Create a strategy for the composer. Cite the traders/principles in `inspiration`. Strategies with proven negative expectancy retire automatically.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string', description: 'Entry/exit logic in plain language.' },
        inspiration: { type: 'string', description: 'Traders + principles this encodes, with sources.' },
        params: {
          type: 'object',
          description:
            'Rules: { timeframes?: ["5m"|"15m"|"1h"|"1d"], minConfidence?: 0.5..0.99, sides?: ["long"|"short"], regimes?: ["trend_up"|"trend_down"|"range"|"high_vol"|"normal_vol"|"low_vol"], featureFilters?: [{ feature: "rsi_14"|"roc_15"|"vol_z"|"bb_pctb"|…, op: ">"|">="|"<"|"<=", value }], stopAtrMult?: 0.3..10, takeProfitAtrMult?: 0.3..20, maxHoldBars?: int }',
        },
      },
      required: ['name', 'description', 'inspiration', 'params'],
    },
  },
  {
    name: 'trade_journal',
    description:
      'Read the trade ledger: recent trades with outcome, P&L, exit reason, model version and the post-mortem of every loss, plus distilled lessons. Consult it before proposing trades — do not repeat recorded mistakes.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max trades, default 25.' } },
    },
  },
];
export const DESIGN_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'design_artifact',
    description:
      "Declare a renderable HTML or SVG artifact for the user's Artifact view. Use this when the user asks for a UI mockup, landing page, chart, diagram, or any visual. After calling this tool, embed the actual source in your next reply inside a fenced ```html or ```svg block — the Artifact view renders the first such block found.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name for the artifact.' },
        language: { type: 'string', enum: ['html', 'svg'] },
        source: { type: 'string', description: 'Full HTML or SVG markup (will also be embedded in the reply).' },
      },
      required: ['title', 'language', 'source'],
    },
  },
];

export const MODEL_3D_TOOL_SPEC: ToolSpec = {
  name: 'generate_3d_model',
  description:
    "Build a 3D model from structured primitives (box, sphere, cylinder, cone, torus, plane). Writes an interactive Three.js viewer (models/<name>.html) the user can preview in the Artifact view, plus an OpenSCAD source (models/<name>.scad) for CAD/3D-print export. After calling this, embed the generated HTML in your next reply inside a fenced ```html block so the Artifact view renders the model. Compose shapes by positioning + rotating multiple primitives. Units are arbitrary (1 = 1 unit). Y is up.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short model name, used for filenames + title.' },
      background: { type: 'string', description: 'Optional hex background color, e.g. "#14110d".' },
      primitives: {
        type: 'array',
        description: 'List of shapes that compose the model.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] },
            size: { type: 'array', items: { type: 'number' }, description: 'box [w,h,d] / plane [w,_,d]' },
            radius: { type: 'number', description: 'sphere/cylinder/cone/torus radius' },
            height: { type: 'number', description: 'cylinder/cone height' },
            tube: { type: 'number', description: 'torus tube radius' },
            position: { type: 'array', items: { type: 'number' }, description: '[x,y,z]' },
            rotation: { type: 'array', items: { type: 'number' }, description: '[x,y,z] degrees' },
            color: { type: 'string', description: 'hex color, e.g. "#b0a080"' },
          },
          required: ['type'],
        },
      },
    },
    required: ['name', 'primitives'],
  },
};

export const BRAIN_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'brain_capture',
    description:
      "Append a single fleeting capture to today's daily note in the user's Second Brain (Obsidian vault). Use for quick observations, ideas, or reminders. Returns the relative path of the daily note that was appended.",
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The capture content. One short line ideal.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags (no # prefix). Up to 10.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'brain_note',
    description:
      "Create or update a structured note in the user's Second Brain. Use for evergreen knowledge, project pages, references, recurring routines. Pick the right category — projects (finite outcome), areas (ongoing responsibility), resources (topic/skill), archive (inactive), routines (recurring pattern).",
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['projects', 'areas', 'resources', 'archive', 'routines'],
        },
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown body. Use [[wiki-links]] freely.' },
        tags: { type: 'array', items: { type: 'string' } },
        links: {
          type: 'array',
          items: { type: 'string' },
          description: 'Titles of related notes — rendered as a Links section.',
        },
      },
      required: ['category', 'title', 'body'],
    },
  },
  {
    name: 'brain_search',
    description:
      "Full-text search across the user's Second Brain. Returns matching notes with a short snippet around the first hit. Use BEFORE writing a brain_note to see if a related note already exists.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
];

export interface ToolPermsLike {
  shell_enabled: boolean;
  delete_enabled: boolean;
}

/** Build the `skill` tool spec, with the available skill names as an enum so
 *  the model can only pick a valid one. */
export function buildSkillToolSpec(skills: Array<{ name: string }>): ToolSpec {
  return {
    name: 'skill',
    description:
      'Load the full instructions for one of your available skills (see the "Available skills" list in your system prompt). Call this BEFORE doing the work a skill covers — it returns the skill\'s step-by-step guidance, which you must then follow.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Exact skill name to load.',
          enum: skills.map((s) => s.name),
        },
      },
      required: ['name'],
    },
  };
}

export function getToolSpecsForAgent(
  perms: ToolPermsLike,
  mcpSpecs: ToolSpec[] = [],
  skills: Array<{ name: string }> = [],
): ToolSpec[] {
  const result: ToolSpec[] = [];
  for (const spec of FILE_TOOL_SPECS) {
    if (spec.name === 'delete_file' && !perms.delete_enabled) continue;
    result.push(spec);
  }
  if (perms.shell_enabled) result.push(SHELL_TOOL_SPEC);
  for (const spec of BRAIN_TOOL_SPECS) result.push(spec);
  for (const spec of DESIGN_TOOL_SPECS) result.push(spec);
  result.push(MODEL_3D_TOOL_SPEC);
  result.push(CODE_INTERPRETER_TOOL_SPEC);
  result.push(WEB_SEARCH_TOOL_SPEC);
  result.push(STOCK_DATA_TOOL_SPEC);
  result.push(STOCK_CHART_TOOL_SPEC);
  for (const spec of TRADING_TOOL_SPECS) result.push(spec);
  if (skills.length > 0) result.push(buildSkillToolSpec(skills));
  for (const m of mcpSpecs) result.push(m);
  return result;
}
