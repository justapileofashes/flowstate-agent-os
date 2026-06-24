// Connectors — one-click MCP integrations. Each preset is a known MCP
// server we know how to spawn. Adding a connector writes to the same
// settings.mcp_servers store the Settings page uses.

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ipc } from '../lib/ipc';
import type { McpServerDto, McpServerStatusDto, McpTestResultDto } from '@shared/ipc-channels';
import { BrandLogo } from '../lib/brand-logos';

interface Preset {
  id: string;
  name: string;
  description: string;
  command: string;
  args: (config: Record<string, string>) => string[];
  fields?: Array<{ key: string; label: string; placeholder: string; type?: 'text' | 'password' }>;
  category: 'files' | 'web' | 'dev' | 'productivity' | 'memory' | 'messaging' | 'education' | 'creative' | '3d';
  docsUrl?: string;
}

const PRESETS: Preset[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read + write files in a chosen folder. Sandboxed to that path.',
    command: 'npx',
    args: (c) => ['-y', '@modelcontextprotocol/server-filesystem', c.path ?? ''],
    fields: [{ key: 'path', label: 'Allowed folder', placeholder: 'C:\\Users\\you\\Documents' }],
    category: 'files',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Inspect git history, status + diff. Needs uv (uvx) installed.',
    command: 'uvx',
    args: (c) => ['mcp-server-git', '--repository', c.repo ?? ''],
    fields: [{ key: 'repo', label: 'Repo path', placeholder: 'D:\\projects\\my-repo' }],
    category: 'dev',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, PRs, repos, file contents, commits, code search. Needs a PAT.',
    command: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-github'],
    fields: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub token',
        placeholder: 'ghp_…',
        type: 'password',
      },
    ],
    category: 'dev',
    docsUrl: 'https://github.com/settings/tokens',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    description:
      'Browse + read Drive files (Docs / Sheets / Slides). OAuth flow runs once on first launch.',
    command: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-gdrive'],
    fields: [
      {
        key: 'GDRIVE_CREDENTIALS_PATH',
        label: 'OAuth credentials JSON path',
        placeholder: 'C:\\Users\\you\\gdrive-credentials.json',
      },
    ],
    category: 'files',
    docsUrl: 'https://developers.google.com/drive/api/quickstart/nodejs',
  },
  {
    id: 'fetch',
    name: 'Web fetch',
    description: 'Fetch + parse URLs as markdown. Public web pages only. Needs uv (uvx) installed.',
    command: 'uvx',
    args: () => ['mcp-server-fetch'],
    category: 'web',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search via Brave. Requires API key.',
    command: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-brave-search'],
    fields: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave API key',
        placeholder: 'BSA…',
        type: 'password',
      },
    ],
    category: 'web',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent key-value memory across sessions.',
    command: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-memory'],
    category: 'memory',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query a SQLite database file.',
    command: 'npx',
    args: (c) => ['-y', 'mcp-server-sqlite-npx', c.path ?? ''],
    fields: [{ key: 'path', label: 'Database file', placeholder: 'D:\\data\\app.sqlite' }],
    category: 'dev',
    docsUrl: 'https://github.com/johnnyoshika/mcp-server-sqlite-npx',
  },
  {
    id: 'puppeteer',
    name: 'Browser (Puppeteer)',
    description: 'Headless Chromium for screenshots, scraping, form automation.',
    command: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-puppeteer'],
    category: 'web',
  },
  {
    id: 'time',
    name: 'Time',
    description: 'Timezone-aware clock + date math. Needs uv (uvx) installed.',
    command: 'uvx',
    args: () => ['mcp-server-time'],
    category: 'productivity',
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
  },

  // —— Messaging ——
  {
    id: 'discord',
    name: 'Discord',
    description: 'Read channels + post messages. Needs a Discord bot token.',
    command: 'npx',
    args: () => ['-y', 'mcp-discord'],
    fields: [
      {
        key: 'DISCORD_BOT_TOKEN',
        label: 'Bot token',
        placeholder: 'MTk4N…',
        type: 'password',
      },
    ],
    category: 'messaging',
    docsUrl: 'https://discord.com/developers/applications',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Workspace channels + DMs. Needs xoxb bot token + team id.',
    command: 'npx',
    args: () => ['-y', '@modelcontextprotocol/server-slack'],
    fields: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Bot token',
        placeholder: 'xoxb-…',
        type: 'password',
      },
      { key: 'SLACK_TEAM_ID', label: 'Team ID', placeholder: 'T01…' },
    ],
    category: 'messaging',
    docsUrl: 'https://api.slack.com/apps',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read + send email. OAuth flow runs once on first launch.',
    command: 'npx',
    args: () => ['-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    fields: [
      {
        key: 'GMAIL_CREDENTIALS_PATH',
        label: 'OAuth credentials JSON path',
        placeholder: 'C:\\Users\\you\\gmail-credentials.json',
      },
    ],
    category: 'messaging',
    docsUrl: 'https://developers.google.com/gmail/api/quickstart',
  },
  {
    id: 'gcal',
    name: 'Google Calendar',
    description:
      'List, create, update + delete calendar events; check availability across calendars. OAuth flow runs once on first launch.',
    command: 'npx',
    args: () => ['-y', '@cocal/google-calendar-mcp'],
    fields: [
      {
        key: 'GOOGLE_OAUTH_CREDENTIALS',
        label: 'OAuth credentials JSON path',
        placeholder: 'C:\\Users\\you\\gcp-oauth.keys.json',
      },
    ],
    category: 'productivity',
    docsUrl: 'https://github.com/nspady/google-calendar-mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read + write pages, databases via the official Notion MCP.',
    command: 'npx',
    args: () => ['-y', '@notionhq/notion-mcp-server'],
    fields: [
      {
        key: 'NOTION_TOKEN',
        label: 'Integration token',
        placeholder: 'ntn_… or secret_…',
        type: 'password',
      },
    ],
    category: 'productivity',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issues, projects, cycles via Linear API.',
    command: 'npx',
    args: () => ['-y', 'mcp-linear'],
    fields: [
      {
        key: 'LINEAR_API_KEY',
        label: 'API key',
        placeholder: 'lin_api_…',
        type: 'password',
      },
    ],
    category: 'productivity',
    docsUrl: 'https://linear.app/settings/api',
  },

  // —— 3D / Creative ——
  {
    id: 'blender',
    name: 'Blender',
    description:
      'Drive Blender from agents — create + edit objects, materials, modifiers, run Python, render scenes. Needs the BlenderMCP add-on installed + its server started inside Blender.',
    command: 'uvx',
    args: () => ['blender-mcp'],
    category: '3d',
    docsUrl: 'https://github.com/ahujasid/blender-mcp',
  },

  // —— Creative / Design ——
  {
    id: 'figma',
    name: 'Figma',
    description: 'Pull frames, components + design context into agents. Needs a Figma API token.',
    command: 'npx',
    args: () => ['-y', 'figma-developer-mcp', '--stdio'],
    fields: [
      { key: 'FIGMA_API_KEY', label: 'Figma API token', placeholder: 'figd_…', type: 'password' },
    ],
    category: 'creative',
    docsUrl: 'https://www.framelink.ai/docs',
  },
  {
    id: 'canva',
    name: 'Canva',
    description:
      'Official Canva MCP via remote proxy. OAuth opens in your browser on first launch.',
    command: 'npx',
    args: () => ['-y', 'mcp-remote', 'https://mcp.canva.com/mcp'],
    category: 'creative',
    docsUrl: 'https://www.canva.dev/docs/apps/mcp-server/',
  },
  {
    id: 'gamma',
    name: 'Gamma',
    description: 'Generate decks + docs from prompts via the Gamma API. Needs an API key (beta).',
    command: 'npx',
    args: () => ['-y', 'gamma-mcp'],
    fields: [
      { key: 'GAMMA_API_KEY', label: 'Gamma API key', placeholder: 'sk-gamma-…', type: 'password' },
    ],
    category: 'creative',
    docsUrl: 'https://developers.gamma.app',
  },

  // —— Dev / Cloud ——
  {
    id: 'vercel',
    name: 'Vercel',
    description:
      'Official Vercel MCP via remote proxy — projects, deployments, logs. OAuth in browser.',
    command: 'npx',
    args: () => ['-y', 'mcp-remote', 'https://mcp.vercel.com'],
    category: 'dev',
    docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp',
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description:
      'Query + manage your Supabase project. Read-only by default. Needs a personal access token.',
    command: 'npx',
    args: (c) => [
      '-y',
      '@supabase/mcp-server-supabase@latest',
      '--read-only',
      ...(c.project ? ['--project-ref', c.project] : []),
    ],
    fields: [
      {
        key: 'SUPABASE_ACCESS_TOKEN',
        label: 'Access token',
        placeholder: 'sbp_…',
        type: 'password',
      },
      { key: 'project', label: 'Project ref (optional)', placeholder: 'abcdefghijklmnop' },
    ],
    category: 'dev',
    docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
  },
  {
    id: 'n8n',
    name: 'n8n',
    description: 'Build + inspect n8n workflows. Needs your n8n instance URL + API key.',
    command: 'npx',
    args: () => ['-y', 'n8n-mcp'],
    fields: [
      { key: 'N8N_API_URL', label: 'Instance URL', placeholder: 'https://your-n8n.example.com' },
      { key: 'N8N_API_KEY', label: 'API key', placeholder: 'n8n_api_…', type: 'password' },
    ],
    category: 'dev',
    docsUrl: 'https://github.com/czlonkowski/n8n-mcp',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments, customers, invoices via the official Stripe MCP. Needs a secret key.',
    command: 'npx',
    args: (c) => ['-y', '@stripe/mcp', '--tools=all', `--api-key=${c.STRIPE_SECRET_KEY ?? ''}`],
    fields: [
      {
        key: 'STRIPE_SECRET_KEY',
        label: 'Secret key',
        placeholder: 'sk_live_… or sk_test_…',
        type: 'password',
      },
    ],
    category: 'dev',
    docsUrl: 'https://docs.stripe.com/mcp',
  },

  // —— Research / Web ——
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Scrape, crawl, search + extract structured data from any site. Needs an API key.',
    command: 'npx',
    args: () => ['-y', 'firecrawl-mcp'],
    fields: [
      { key: 'FIRECRAWL_API_KEY', label: 'API key', placeholder: 'fc-…', type: 'password' },
    ],
    category: 'web',
    docsUrl: 'https://docs.firecrawl.dev/mcp-server',
  },
  {
    id: 'graphify',
    name: 'graphify',
    description:
      'Query a graphify knowledge graph live — nodes, neighbors, communities, shortest paths. Point it at a built graphify-out/graph.json.',
    command: 'python',
    args: (c) => ['-m', 'graphify.serve', c.graph ?? ''],
    fields: [
      {
        key: 'graph',
        label: 'graph.json path',
        placeholder: 'D:\\projects\\my-repo\\graphify-out\\graph.json',
      },
    ],
    category: 'dev',
    docsUrl: 'https://github.com/safishamsi/graphify',
  },
];

const CATEGORIES: Array<{ id: Preset['category'] | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'files', label: 'Files' },
  { id: 'dev', label: 'Dev' },
  { id: 'web', label: 'Web' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'creative', label: 'Creative' },
  { id: 'memory', label: 'Memory' },
  { id: '3d', label: '3D' },
];

/** Build the MCP server DTO from a preset + form values. All-caps keys become
 *  env vars (secrets); everything else is consumed by `preset.args`. Shared by
 *  Install and Test so a passing test reflects exactly what gets installed. */
function buildServerDto(preset: Preset, config: Record<string, string>): McpServerDto {
  const args = preset.args(config);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) {
    if (/^[A-Z][A-Z0-9_]*$/.test(k) && v.trim().length > 0) env[k] = v.trim();
  }
  return {
    id: preset.id,
    name: preset.name,
    command: preset.command,
    args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function Connectors(): JSX.Element {
  const [installed, setInstalled] = useState<McpServerDto[]>([]);
  const [status, setStatus] = useState<McpServerStatusDto[]>([]);
  const [filter, setFilter] = useState<Preset['category'] | 'all'>('all');
  const [query, setQuery] = useState('');
  const [configFor, setConfigFor] = useState<Preset | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await ipc.mcp.list();
    setInstalled(list.servers);
    setStatus(list.status);
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = ipc.mcp.subscribeStatus((p) => setStatus(p.status));
    return unsub;
  }, [refresh]);

  async function install(preset: Preset): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      const next: McpServerDto[] = [
        ...installed.filter((s) => s.id !== preset.id),
        buildServerDto(preset, config),
      ];
      await ipc.mcp.save(next);
      await refresh();
      setConfigFor(null);
      setConfig({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string): Promise<void> {
    const next = installed.filter((s) => s.id !== id);
    await ipc.mcp.save(next);
    await refresh();
  }

  const q = query.trim().toLowerCase();
  const visible = PRESETS.filter((p) => {
    if (filter !== 'all' && p.category !== filter) return false;
    if (q.length === 0) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q)
    );
  });
  const installedIds = new Set(installed.map((s) => s.id));

  return (
    <div
      className="screen-enter h-full overflow-y-auto"
      style={{ padding: '32px 48px 80px', maxWidth: 1100, margin: '0 auto' }}
    >
      <motion.header
        className="mb-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <div className="eyebrow">Connectors</div>
        <h2 className="section-title" style={{ marginBottom: 8, fontSize: 32 }}>
          One-click integrations
        </h2>
        <p className="muted mt-3" style={{ maxWidth: 560 }}>
          Each connector exposes MCP tools to every agent. Tokens stay on your machine; the
          agent only sees what you allow.
        </p>
      </motion.header>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search connectors…"
        className="field text-sm mt-6"
        style={{ maxWidth: 360 }}
      />

      <div className="row gap-2 mt-4 mb-4" style={{ flexWrap: 'wrap' }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setFilter(c.id)}
            className={'btn btn-sm ' + (filter === c.id ? '' : 'btn-ghost')}
          >
            {c.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="muted text-sm" style={{ padding: '32px 0' }}>
          No connectors match “{query.trim()}”.
        </div>
      ) : null}

      <div className="cnx-grid">
        {visible.map((p) => {
          const isInstalled = installedIds.has(p.id);
          const st = status.find((s) => s.id === p.id);
          return (
            <div key={p.id} className="cnx-card">
              <div className="row gap-3">
                <div className="cnx-icon"><BrandLogo name={p.name} size={18} /></div>
                <div>
                  <div className="nm">{p.name}</div>
                  <div className="muted text-xs mono">
                    {isInstalled && st
                      ? `${st.state}${st.state === 'ready' ? ` · ${st.toolCount} tools` : ''}`
                      : 'available'}
                  </div>
                </div>
              </div>
              <div className="ds">{p.description}</div>
              {isInstalled && st?.lastError ? (
                <div className="text-[10px] text-[var(--bad)]">{st.lastError}</div>
              ) : null}
              <div className="row" style={{ marginTop: 4 }}>
                {p.docsUrl ? (
                  <a
                    className="btn btn-sm btn-ghost"
                    href={p.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Docs ↗
                  </a>
                ) : (
                  <span />
                )}
                <div style={{ flex: 1 }} />
                {isInstalled ? (
                  <button type="button" className="btn btn-sm" onClick={() => void remove(p.id)}>
                    Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => {
                      setConfig({});
                      setError(null);
                      if (!p.fields || p.fields.length === 0) {
                        void install(p);
                      } else {
                        setConfigFor(p);
                      }
                    }}
                  >
                    Install
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {configFor ? (
        <ConfigDialog
          preset={configFor}
          config={config}
          onChange={setConfig}
          onCancel={() => {
            setConfigFor(null);
            setConfig({});
            setError(null);
          }}
          onInstall={() => void install(configFor)}
          saving={saving}
          error={error}
        />
      ) : null}
    </div>
  );
}

function ConfigDialog({
  preset,
  config,
  onChange,
  onCancel,
  onInstall,
  saving,
  error,
}: {
  preset: Preset;
  config: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  onCancel: () => void;
  onInstall: () => void;
  saving: boolean;
  error: string | null;
}): JSX.Element {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<McpTestResultDto | null>(null);

  async function runTest(): Promise<void> {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await ipc.mcp.test(buildServerDto(preset, config));
      setTestResult(res);
    } catch (err) {
      setTestResult({
        ok: false,
        toolCount: 0,
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={onCancel}
    >
      <div className="card glass w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 mb-3">
          <div className="cnx-icon"><BrandLogo name={preset.name} size={22} /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold">{preset.name}</h2>
            <p className="text-[11px] text-[var(--ink-muted)]">{preset.description}</p>
          </div>
        </header>
        <div className="space-y-3">
          {preset.fields?.map((f) => (
            <div key={f.key}>
              <label className="block text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold mb-1.5">
                {f.label}
              </label>
              <input
                type={f.type === 'password' ? 'password' : 'text'}
                value={config[f.key] ?? ''}
                onChange={(e) => onChange({ ...config, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                className="field text-xs"
              />
            </div>
          ))}
        </div>
        {error ? <div className="text-xs text-[var(--bad)] mt-3">{error}</div> : null}
        {testResult ? (
          <div
            className={'text-xs mt-3 break-words ' + (testResult.ok ? 'text-[var(--good)]' : 'text-[var(--bad)]')}
          >
            {testResult.ok
              ? `✓ Connected — ${testResult.toolCount} tool${testResult.toolCount === 1 ? '' : 's'}` +
                (testResult.tools.length > 0
                  ? ': ' +
                    testResult.tools.slice(0, 6).join(', ') +
                    (testResult.tools.length > 6 ? '…' : '')
                  : '')
              : `✗ ${testResult.error ?? 'Connection failed'}`}
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => void runTest()}
            disabled={testing || saving}
          >
            {testing ? 'Testing…' : 'Test'}
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn text-xs" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary text-xs"
              onClick={onInstall}
              disabled={saving}
            >
              {saving ? 'Installing…' : 'Install'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
