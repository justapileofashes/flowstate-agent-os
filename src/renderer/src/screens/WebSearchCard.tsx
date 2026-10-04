// Settings → Web search. Picks what the agents' web_search tool (and the
// business agent's web.search) uses: the keyless built-in chain, Brave Search
// API, Tavily, or a search tool on a connected MCP server. Whatever is picked
// runs first; the built-in chain is always the fallback.

import { useEffect, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import { ipcErrorMessage } from '../lib/ipc-error';
import type { WebSearchMcpToolDto, WebSearchTestResponse } from '@shared/ipc-channels';

type Provider = 'builtin' | 'brave' | 'tavily' | 'mcp';

const KEYS = {
  provider: 'web_search_provider',
  brave: 'brave_search_api_key',
  tavily: 'tavily_api_key',
  mcpTool: 'web_search_mcp_tool',
} as const;

const OPTIONS: Array<{ id: Provider; label: string; hint: string }> = [
  { id: 'builtin', label: 'Built-in (free)', hint: 'DuckDuckGo, falling back to Wikipedia. No key. Some networks block DuckDuckGo.' },
  { id: 'brave', label: 'Brave Search API', hint: 'Full web results. Needs a Brave Search API key (free tier available).' },
  { id: 'tavily', label: 'Tavily', hint: 'Search built for AI agents. Needs a Tavily API key (free tier available).' },
  { id: 'mcp', label: 'MCP tool', hint: 'Use a search tool from a connected MCP server — Firecrawl, Brave, Tavily, Exa, Playwright…' },
];

export function WebSearchCard({ onOpenConnectors }: { onOpenConnectors?: () => void }): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<Provider>('builtin');
  const [braveKey, setBraveKey] = useState('');
  const [tavilyKey, setTavilyKey] = useState('');
  const [savedKeys, setSavedKeys] = useState<{ brave: string; tavily: string }>({ brave: '', tavily: '' });
  const [mcpTool, setMcpTool] = useState('');
  const [tools, setTools] = useState<WebSearchMcpToolDto[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<WebSearchTestResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [p, b, t, m] = await Promise.all([
          ipc.settings.get(KEYS.provider),
          ipc.settings.get(KEYS.brave),
          ipc.settings.get(KEYS.tavily),
          ipc.settings.get(KEYS.mcpTool),
        ]);
        const pv = p.value;
        setProvider(pv === 'brave' || pv === 'tavily' || pv === 'mcp' ? pv : 'builtin');
        setBraveKey(b.value ?? '');
        setTavilyKey(t.value ?? '');
        setSavedKeys({ brave: b.value ?? '', tavily: t.value ?? '' });
        setMcpTool(m.value ?? '');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (provider !== 'mcp' || tools !== null) return;
    void ipc.mcp
      .webSearchTools()
      .then((r) => setTools(r.tools))
      .catch(() => setTools([]));
  }, [provider, tools]);

  function flash(msg: string): void {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2500);
  }

  async function choose(next: Provider): Promise<void> {
    setProvider(next);
    setTest(null);
    await ipc.settings.set(KEYS.provider, next);
    flash(`Web search: ${OPTIONS.find((o) => o.id === next)?.label ?? next}`);
  }

  async function saveKey(which: 'brave' | 'tavily'): Promise<void> {
    const value = (which === 'brave' ? braveKey : tavilyKey).trim();
    await ipc.settings.set(which === 'brave' ? KEYS.brave : KEYS.tavily, value);
    setSavedKeys((s) => ({ ...s, [which]: value }));
    flash(value ? 'Key saved.' : 'Key removed.');
  }

  async function chooseTool(name: string): Promise<void> {
    setMcpTool(name);
    setTest(null);
    await ipc.settings.set(KEYS.mcpTool, name);
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    setTest(null);
    try {
      // Test what's typed, not only what was saved earlier.
      if (provider === 'brave' && braveKey.trim() !== savedKeys.brave) await saveKey('brave');
      if (provider === 'tavily' && tavilyKey.trim() !== savedKeys.tavily) await saveKey('tavily');
      setTest(await ipc.mcp.webSearchTest());
    } catch (err) {
      setTest({ ok: false, provider: '', count: 0, error: ipcErrorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  const current = OPTIONS.find((o) => o.id === provider) ?? OPTIONS[0]!;

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Web search</h3>
        <span className="muted text-xs">What agents use for web_search. Keys stay on this machine.</span>
      </div>

      <div className="settings-row">
        <div className="lab">
          Provider
          <span className="hint">{current.hint}</span>
        </div>
        <div className="row gap-2" style={{ flexWrap: 'wrap' }} role="radiogroup" aria-label="Web search provider">
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={provider === o.id}
              className={'btn btn-sm ' + (provider === o.id ? 'btn-primary' : 'btn-ghost')}
              disabled={!loaded}
              onClick={() => void choose(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {provider === 'brave' ? (
        <KeyRow
          label="Brave Search API key"
          hint="api-dashboard.search.brave.com → API keys"
          url="https://api-dashboard.search.brave.com/app/keys"
          value={braveKey}
          saved={savedKeys.brave}
          onChange={setBraveKey}
          onSave={() => void saveKey('brave')}
        />
      ) : null}

      {provider === 'tavily' ? (
        <KeyRow
          label="Tavily API key"
          hint="app.tavily.com → API keys (starts with tvly-)"
          url="https://app.tavily.com/home"
          value={tavilyKey}
          saved={savedKeys.tavily}
          onChange={setTavilyKey}
          onSave={() => void saveKey('tavily')}
        />
      ) : null}

      {provider === 'mcp' ? (
        <div className="settings-row">
          <div className="lab">
            MCP tool
            <span className="hint">Tools from servers that are connected right now. Search-like tools are listed first.</span>
          </div>
          {tools === null ? (
            <span className="muted text-sm">Loading tools…</span>
          ) : tools.length === 0 ? (
            <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="muted text-sm">No MCP server is connected. Add Firecrawl, Brave, Tavily, Exa or Playwright in Connectors.</span>
              {onOpenConnectors ? (
                <button type="button" className="btn btn-sm" onClick={onOpenConnectors}>
                  Open Connectors →
                </button>
              ) : null}
            </div>
          ) : (
            <div className="row gap-2">
              <select
                className="field"
                value={mcpTool}
                onChange={(e) => void chooseTool(e.target.value)}
                aria-label="MCP search tool"
              >
                <option value="">Choose a tool…</option>
                {mcpTool && !tools.some((t) => t.name === mcpTool) ? (
                  <option value={mcpTool}>{mcpTool} (not connected)</option>
                ) : null}
                {tools.map((t) => (
                  <option key={t.name} value={t.name} title={t.description}>
                    {t.server} · {t.tool}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setTools(null)} title="Reload the tool list">
                ↻
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="settings-row">
        <div className="lab">
          Check it
          <span className="hint">Runs one real search with the saved settings.</span>
        </div>
        <div className="row gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" disabled={!loaded || testing} onClick={() => void runTest()}>
            {testing ? 'Searching…' : 'Test search'}
          </button>
          {test ? (
            test.ok ? (
              <span className="text-[11px] text-[var(--good)]">
                {test.count} result{test.count === 1 ? '' : 's'} via {test.provider}
                {test.sample ? ` — “${test.sample.slice(0, 60)}”` : ''}
              </span>
            ) : (
              <span className="text-[11px] text-[var(--bad)]">{test.error ?? `No results via ${test.provider}`}</span>
            )
          ) : null}
          {test?.note ? <span className="text-[11px] muted">{test.note}</span> : null}
          {status ? <span className="text-[11px] muted">{status}</span> : null}
        </div>
      </div>
    </section>
  );
}

function KeyRow(props: {
  label: string;
  hint: string;
  url: string;
  value: string;
  saved: string;
  onChange: (v: string) => void;
  onSave: () => void;
}): JSX.Element {
  const dirty = props.value.trim() !== props.saved;
  return (
    <div className="settings-row">
      <div className="lab">
        {props.label}
        <span className="hint">
          {props.hint} ·{' '}
          <a
            href={props.url}
            onClick={(e) => {
              e.preventDefault();
              void ipc.shellOpen.url(props.url);
            }}
          >
            get a key
          </a>
        </span>
      </div>
      <div className="row gap-2">
        <input
          type="password"
          className="field"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.saved ? '•••••••• (saved)' : 'Paste key'}
          autoComplete="off"
          aria-label={props.label}
        />
        <button type="button" className="btn btn-sm btn-primary" disabled={!dirty} onClick={props.onSave}>
          {props.value.trim() || !props.saved ? 'Save' : 'Remove'}
        </button>
      </div>
    </div>
  );
}
