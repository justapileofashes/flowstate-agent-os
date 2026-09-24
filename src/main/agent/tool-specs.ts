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

/** Autonomous-trading tools. Every order passes the shared risk guardrails in
 *  the main process — the model can propose trades but can never bypass the
 *  position-size / daily-loss / cooldown rules. Paper trading by default. */
export const TRADING_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'trading_account',
    description:
      'Get the connected Alpaca trading account: mode (paper/live), equity, cash, open positions with P&L, today\'s realized P&L and loss streak, and the active risk guardrails. Call this before proposing any trade.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'place_trade',
    description:
      'Propose a trade on the connected Alpaca account. It is submitted as a bracket order (market entry + stoploss + take-profit, atomic) ONLY if it passes the risk guardrails (max position %, risk % per trade, daily loss halt, open-position cap, loss-streak cooldown, confidence floor). Returns the verdict either way — read the blocked reasons, they encode the account rules. Use stock_data first; never invent prices.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'US equity/ETF ticker, e.g. AAPL.' },
        side: { type: 'string', enum: ['buy', 'sell'], description: 'buy = long. sell (short) only with a strong, stated reason.' },
        entry: { type: 'number', description: 'Current/intended entry price from stock_data.' },
        stoploss: { type: 'number', description: 'Stoploss price (below entry for long).' },
        takeProfit: { type: 'number', description: 'Take-profit limit price.' },
        qty: { type: 'number', description: 'Optional share count; omitted → sized from the risk % guardrail. May be clamped down.' },
        confidence: { type: 'number', description: 'Your 0..1 confidence. Trades under the guardrail floor are rejected.' },
        reason: { type: 'string', description: 'One-paragraph rationale — stored in the trade journal for the post-mortem loop.' },
        strategyId: { type: 'string', description: 'Optional id from list_strategies so results update that strategy\'s stats.' },
      },
      required: ['symbol', 'side', 'entry', 'stoploss', 'takeProfit', 'confidence', 'reason'],
    },
  },
  {
    name: 'close_trade',
    description: 'Close an open position at market (cancels its bracket legs) and journal the exit with your reason.',
    parameters: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        reason: { type: 'string', description: 'Why you are closing — stored in the journal.' },
      },
      required: ['symbol', 'reason'],
    },
  },
  {
    name: 'list_strategies',
    description:
      'List the trading strategy library: params, inspiration (which successful traders/principles each encodes), win/loss record, total P&L, distilled lessons, and active/retired status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'save_strategy',
    description:
      'Create a new trading strategy from your research into successful traders. Cite the traders/principles in `inspiration`. The autopilot will trade active strategies and retire them automatically if they prove negative expectancy.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string', description: 'Entry/exit logic in plain language.' },
        inspiration: { type: 'string', description: 'Traders + principles this encodes, with sources.' },
        params: {
          type: 'object',
          description:
            'Machine rules: { minConfidence: 0..0.95, requireTrend: "up"|"down"|"any", minFactorScores: {trend|momentum|volatility|levels|volume|pattern: -1..1}, takeProfitR: 0.5..10, stopAtrMult: 0.5..5 }',
        },
      },
      required: ['name', 'description', 'inspiration', 'params'],
    },
  },
  {
    name: 'trade_journal',
    description:
      'Read the trade journal: recent trades with entry rationale, outcome, P&L, and the post-mortem review of every loss, plus the distilled lessons list. ALWAYS consult this before creating strategies or placing trades — do not repeat recorded mistakes.',
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
