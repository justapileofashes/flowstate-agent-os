// CLI catalog — the curated registry of command-line tools Flowstate knows how
// to detect, plus pure helpers to turn raw probe results into a report and to
// describe the connected set to agents. Kept pure (no child_process) so it is
// trivially unit-testable; the actual PATH/version probing lives in
// cli-detector.ts.

export type CliCategory =
  | 'vcs'
  | 'runtime'
  | 'package'
  | 'container'
  | 'cloud'
  | 'ai'
  | 'data'
  | 'media'
  | 'other';

export interface CliDef {
  /** Stable id (also the catalog key). */
  id: string;
  /** Pretty display name. */
  name: string;
  /** Executable name as found on PATH. */
  command: string;
  category: CliCategory;
  description: string;
  /** Args used to print a version. Defaults to ['--version']. */
  versionArgs?: string[];
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
}

/** The known CLIs Flowstate scans for. Order here drives display order. */
export const KNOWN_CLIS: CliDef[] = [
  // —— Version control ——
  { id: 'git', name: 'Git', command: 'git', category: 'vcs', description: 'Version control.' },
  {
    id: 'gh',
    name: 'GitHub CLI',
    command: 'gh',
    category: 'vcs',
    description: 'GitHub from the terminal — repos, PRs, issues, releases.',
  },
  {
    id: 'glab',
    name: 'GitLab CLI',
    command: 'glab',
    category: 'vcs',
    description: 'GitLab from the terminal.',
  },

  // —— Runtimes ——
  { id: 'node', name: 'Node.js', command: 'node', category: 'runtime', description: 'JavaScript runtime.' },
  { id: 'deno', name: 'Deno', command: 'deno', category: 'runtime', description: 'Secure TS/JS runtime.' },
  { id: 'bun', name: 'Bun', command: 'bun', category: 'runtime', description: 'Fast JS runtime + toolkit.' },
  { id: 'python', name: 'Python', command: 'python', category: 'runtime', description: 'Python interpreter.' },
  { id: 'python3', name: 'Python 3', command: 'python3', category: 'runtime', description: 'Python 3 interpreter.' },
  { id: 'go', name: 'Go', command: 'go', category: 'runtime', description: 'Go toolchain.' },
  { id: 'rustc', name: 'Rust', command: 'rustc', category: 'runtime', description: 'Rust compiler.' },
  { id: 'ruby', name: 'Ruby', command: 'ruby', category: 'runtime', description: 'Ruby interpreter.' },
  { id: 'java', name: 'Java', command: 'java', category: 'runtime', description: 'Java runtime.' },
  { id: 'dotnet', name: '.NET', command: 'dotnet', category: 'runtime', description: '.NET SDK + CLI.' },
  { id: 'php', name: 'PHP', command: 'php', category: 'runtime', description: 'PHP interpreter.' },

  // —— Package / build managers ——
  { id: 'npm', name: 'npm', command: 'npm', category: 'package', description: 'Node package manager.' },
  { id: 'pnpm', name: 'pnpm', command: 'pnpm', category: 'package', description: 'Fast, disk-efficient Node package manager.' },
  { id: 'yarn', name: 'Yarn', command: 'yarn', category: 'package', description: 'Node package manager.' },
  { id: 'pip', name: 'pip', command: 'pip', category: 'package', description: 'Python package installer.' },
  { id: 'uv', name: 'uv', command: 'uv', category: 'package', description: 'Fast Python package + project manager.' },
  { id: 'uvx', name: 'uvx', command: 'uvx', category: 'package', description: 'Run Python tools in ephemeral envs (used by some connectors).' },
  { id: 'cargo', name: 'Cargo', command: 'cargo', category: 'package', description: 'Rust package manager.' },
  { id: 'brew', name: 'Homebrew', command: 'brew', category: 'package', description: 'macOS/Linux package manager.' },

  // —— Containers / orchestration ——
  { id: 'docker', name: 'Docker', command: 'docker', category: 'container', description: 'Build + run containers.' },
  { id: 'podman', name: 'Podman', command: 'podman', category: 'container', description: 'Daemonless container engine.' },
  { id: 'kubectl', name: 'kubectl', command: 'kubectl', category: 'container', description: 'Kubernetes control.' },
  { id: 'helm', name: 'Helm', command: 'helm', category: 'container', description: 'Kubernetes package manager.' },

  // —— Cloud / infra ——
  { id: 'aws', name: 'AWS CLI', command: 'aws', category: 'cloud', description: 'Amazon Web Services.' },
  { id: 'gcloud', name: 'gcloud', command: 'gcloud', category: 'cloud', description: 'Google Cloud.' },
  { id: 'az', name: 'Azure CLI', command: 'az', category: 'cloud', description: 'Microsoft Azure.' },
  { id: 'terraform', name: 'Terraform', command: 'terraform', category: 'cloud', description: 'Infrastructure as code.' },
  { id: 'vercel', name: 'Vercel', command: 'vercel', category: 'cloud', description: 'Deploy to Vercel.' },
  { id: 'supabase', name: 'Supabase', command: 'supabase', category: 'cloud', description: 'Supabase project + local dev.' },
  { id: 'wrangler', name: 'Wrangler', command: 'wrangler', category: 'cloud', description: 'Cloudflare Workers.' },

  // —— AI / agents ——
  { id: 'ollama', name: 'Ollama', command: 'ollama', category: 'ai', description: 'Local model runtime (powers Flowstate).' },
  { id: 'claude', name: 'Claude Code', command: 'claude', category: 'ai', description: "Anthropic's agentic CLI." },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', category: 'ai', description: "Google's agentic CLI." },
  { id: 'codex', name: 'Codex CLI', command: 'codex', category: 'ai', description: "OpenAI's agentic CLI." },

  // —— Data ——
  { id: 'psql', name: 'PostgreSQL', command: 'psql', category: 'data', description: 'Postgres client.' },
  { id: 'mysql', name: 'MySQL', command: 'mysql', category: 'data', description: 'MySQL client.' },
  { id: 'sqlite3', name: 'SQLite', command: 'sqlite3', category: 'data', description: 'SQLite shell.' },
  { id: 'redis-cli', name: 'Redis', command: 'redis-cli', category: 'data', description: 'Redis client.' },
  { id: 'jq', name: 'jq', command: 'jq', category: 'data', description: 'Command-line JSON processor.' },

  // —— Media / misc ——
  { id: 'ffmpeg', name: 'FFmpeg', command: 'ffmpeg', category: 'media', description: 'Audio/video processing.' },
  { id: 'pandoc', name: 'Pandoc', command: 'pandoc', category: 'media', description: 'Universal document converter.' },
  { id: 'curl', name: 'curl', command: 'curl', category: 'other', description: 'HTTP from the command line.' },
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
    };
  });
}

/** Look up a catalog entry by id. */
export function cliDef(id: string): CliDef | undefined {
  return CATALOG_BY_ID.get(id);
}

/** A compact system-prompt block telling an agent which CLIs it may invoke via
 *  run_shell. Empty string when nothing is connected (so callers can append
 *  unconditionally). */
export function buildCliContext(connected: DetectedCli[]): string {
  if (connected.length === 0) return '';
  const lines = connected
    .map((c) => `- \`${c.command}\` — ${c.name}: ${c.description}`)
    .join('\n');
  return (
    '\n\n## Connected CLIs\n' +
    'These command-line tools are installed on this machine and available to you ' +
    'via the run_shell tool. Prefer them for the jobs they are built for.\n' +
    lines
  );
}
