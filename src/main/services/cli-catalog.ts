// Coding-CLI catalog — the curated registry of AI coding / agentic command-line
// tools Flowstate knows how to detect (Claude Code, Gemini CLI, Codex, Aider,
// …), plus pure helpers to turn raw probe results into a report and to describe
// the connected set to agents. Kept pure (no child_process) so it is trivially
// unit-testable; the actual PATH/version probing lives in cli-detector.ts.

export type CliCategory = 'agentic' | 'assistant' | 'other';

export interface CliDef {
  /** Stable id (also the catalog key). */
  id: string;
  /** Pretty display name. */
  name: string;
  /** Executable name as found on PATH (also the command used to launch it). */
  command: string;
  category: CliCategory;
  description: string;
  /** Args used to print a version. Defaults to ['--version']. */
  versionArgs?: string[];
  /** Where to install / learn more (shown when not installed). */
  docsUrl?: string;
}

/** Result of probing a single CLI on the machine. */
export interface CliProbeResult {
  id: string;
  installed: boolean;
  version: string | null;
  path: string | null;
}

/** A catalog entry merged with its probe result — what the UI + agents see. */
export interface DetectedCli {
  id: string;
  name: string;
  command: string;
  category: CliCategory;
  description: string;
  installed: boolean;
  version: string | null;
  path: string | null;
  docsUrl: string | null;
}

/** The coding CLIs Flowstate scans for. Order here drives display order. */
export const KNOWN_CLIS: CliDef[] = [
  // —— Agentic coders (autonomous, multi-step) ——
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    category: 'agentic',
    description: "Anthropic's agentic coding CLI.",
    docsUrl: 'https://claude.com/claude-code',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    category: 'agentic',
    description: "OpenAI's terminal coding agent.",
    docsUrl: 'https://github.com/openai/codex',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    category: 'agentic',
    description: "Google's open-source terminal AI agent.",
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    category: 'agentic',
    description: 'AI pair programming in your terminal, git-native.',
    docsUrl: 'https://aider.chat',
  },
  {
    id: 'cursor-agent',
    name: 'Cursor CLI',
    command: 'cursor-agent',
    category: 'agentic',
    description: "Cursor's agent in the terminal.",
    docsUrl: 'https://docs.cursor.com/en/cli/overview',
  },
  {
    id: 'opencode',
    name: 'opencode',
    command: 'opencode',
    category: 'agentic',
    description: 'Open-source terminal coding agent (provider-agnostic).',
    docsUrl: 'https://opencode.ai',
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'goose',
    category: 'agentic',
    description: "Block's open-source on-machine coding agent.",
    docsUrl: 'https://block.github.io/goose/',
  },
  {
    id: 'crush',
    name: 'Crush',
    command: 'crush',
    category: 'agentic',
    description: "Charm's glamourous terminal coding agent.",
    docsUrl: 'https://github.com/charmbracelet/crush',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    command: 'qwen',
    category: 'agentic',
    description: "Alibaba's Qwen-Coder terminal agent.",
    docsUrl: 'https://github.com/QwenLM/qwen-code',
  },
  {
    id: 'amp',
    name: 'Amp',
    command: 'amp',
    category: 'agentic',
    description: "Sourcegraph's agentic coding tool.",
    docsUrl: 'https://ampcode.com',
  },
  {
    id: 'droid',
    name: 'Factory Droid',
    command: 'droid',
    category: 'agentic',
    description: "Factory's terminal coding agent.",
    docsUrl: 'https://factory.ai',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    category: 'agentic',
    description: "GitHub Copilot's standalone terminal agent.",
    docsUrl: 'https://github.com/github/copilot-cli',
  },
  {
    id: 'openhands',
    name: 'OpenHands',
    command: 'openhands',
    category: 'agentic',
    description: 'Open-source autonomous software-development agent.',
    docsUrl: 'https://docs.all-hands.dev',
  },
  {
    id: 'continue',
    name: 'Continue CLI',
    command: 'cn',
    category: 'agentic',
    description: "Continue's terminal agent (cn).",
    docsUrl: 'https://docs.continue.dev/guides/cli',
  },

  // —— Prompt / shell assistants (single-shot, scriptable) ——
  {
    id: 'llm',
    name: 'llm',
    command: 'llm',
    category: 'assistant',
    description: "Simon Willison's CLI for LLMs + plugins.",
    docsUrl: 'https://llm.datasette.io',
  },
  {
    id: 'aichat',
    name: 'aichat',
    command: 'aichat',
    category: 'assistant',
    description: 'All-in-one LLM CLI with shell assistant + REPL.',
    docsUrl: 'https://github.com/sigoden/aichat',
  },
  {
    id: 'sgpt',
    name: 'ShellGPT',
    command: 'sgpt',
    category: 'assistant',
    description: 'Command-line productivity assistant.',
    docsUrl: 'https://github.com/TheR1D/shell_gpt',
  },
  {
    id: 'mods',
    name: 'Mods',
    command: 'mods',
    category: 'assistant',
    description: "Charm's AI for the command line, built for pipelines.",
    docsUrl: 'https://github.com/charmbracelet/mods',
  },
];

const CATALOG_BY_ID = new Map(KNOWN_CLIS.map((c) => [c.id, c]));

/** Pull the first `x.y[.z[.w]]` version token out of arbitrary --version output. */
export function parseVersion(raw: string): string | null {
  const m = raw.match(/(\d+\.\d+(?:\.\d+){0,2})/);
  return m ? m[1]! : null;
}

/** Merge probe results onto the catalog (catalog order preserved). Probe
 *  results for ids not in the catalog are ignored. */
export function buildCliReport(results: CliProbeResult[]): DetectedCli[] {
  const byId = new Map(results.map((r) => [r.id, r]));
  return KNOWN_CLIS.map((def) => {
    const r = byId.get(def.id);
    return {
      id: def.id,
      name: def.name,
      command: def.command,
      category: def.category,
      description: def.description,
      installed: r?.installed ?? false,
      version: r?.version ?? null,
      path: r?.path ?? null,
      docsUrl: def.docsUrl ?? null,
    };
  });
}

/** Look up a catalog entry by id. */
export function cliDef(id: string): CliDef | undefined {
  return CATALOG_BY_ID.get(id);
}

/** A compact system-prompt block telling an agent which coding CLIs it may
 *  invoke via run_shell. Empty string when nothing is connected (so callers can
 *  append unconditionally). */
export function buildCliContext(connected: DetectedCli[]): string {
  if (connected.length === 0) return '';
  const lines = connected
    .map((c) => `- \`${c.command}\` — ${c.name}: ${c.description}`)
    .join('\n');
  return (
    '\n\n## Connected coding CLIs\n' +
    'These AI coding CLIs are installed on this machine and available to you via ' +
    'the run_shell tool (use their non-interactive / one-shot flags when delegating).\n' +
    lines
  );
}
