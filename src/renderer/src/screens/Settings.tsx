import { useEffect, useRef, useState, type JSX } from 'react';
import { ipc } from '../lib/ipc';
import { ShortcutsList } from '../chat/ShortcutsModal';
import { McpServersCard } from './McpServersCard';
import { DevToolsSettings } from './DevToolsSettings';
import { ClisPicker } from '../chat/ClisOnboardingModal';
import { BrandLogo } from '../lib/brand-logos';

function ClisSection(): JSX.Element {
  const [savedAt, setSavedAt] = useState<number>(0);
  return (
    <section className="settings-section">
      <div className="head">
        <h3>Connected CLIs</h3>
        <span className="muted text-xs">
          Installed command-line tools your agents can use via the shell tool.
        </span>
      </div>
      {/* key forces a fresh re-scan each time the user saves */}
      <ClisPicker key={savedAt} onDone={() => setSavedAt(Date.now())} />
      {savedAt > 0 ? (
        <div className="muted text-xs" style={{ marginTop: 8, color: 'var(--good)' }}>
          ✓ Saved — agents now see your selected CLIs.
        </div>
      ) : null}
    </section>
  );
}

function NotificationsSection(): JSX.Element {
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void ipc.settings.get('notifications_enabled').then((res) => {
      setEnabled(res.value !== 'false'); // null/unset → enabled
      setLoaded(true);
    });
  }, []);

  function toggle(): void {
    const next = !enabled;
    setEnabled(next); // optimistic
    void ipc.settings
      .set('notifications_enabled', next ? 'true' : 'false')
      .catch(() => setEnabled(!next)); // revert on failure
  }

  return (
    <section className="settings-section">
      <div className="head"><h3>Notifications</h3></div>
      <div className="settings-row">
        <div className="lab">
          Desktop notifications
          <span className="hint">
            Notify when an agent needs approval or finishes a run while the window is in the
            background.
          </span>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className={'biz-switch ' + (enabled ? 'on' : '')}
            onClick={toggle}
            disabled={!loaded}
            role="switch"
            aria-checked={enabled}
            aria-label="Desktop notifications"
          >
            <span className="biz-switch-knob" />
          </button>
          <span className="muted text-sm">{enabled ? 'On' : 'Off'}</span>
        </div>
      </div>
    </section>
  );
}

interface OllamaState {
  reachable: boolean;
  version?: string;
  host: string;
  errorMessage?: string;
}

interface State {
  ollama: OllamaState | null;
  workspacesDir: string;
  ollamaHost: string;
  orchestratorModel: string;
  models: Array<{ name: string }>;
  anthropicKey: string;
  openaiKey: string;
  geminiKey: string;
  perplexityKey: string;
  groqKey: string;
  mistralKey: string;
  xaiKey: string;
  loading: boolean;
  bridgeAvailable: boolean;
  fatalError: string | null;
  saveStatus: string | null;
}

export function Settings(): JSX.Element {
  const [state, setState] = useState<State>({
    ollama: null,
    workspacesDir: '',
    ollamaHost: '',
    orchestratorModel: '',
    models: [],
    anthropicKey: '',
    openaiKey: '',
    geminiKey: '',
    perplexityKey: '',
    groqKey: '',
    mistralKey: '',
    xaiKey: '',
    loading: true,
    bridgeAvailable: typeof window.flowstate !== 'undefined',
    fatalError: null,
    saveStatus: null,
  });

  async function refresh(): Promise<void> {
    if (!state.bridgeAvailable) {
      setState((s) => ({
        ...s,
        loading: false,
        fatalError:
          'Preload bridge not available. The renderer cannot reach the main process. Try restarting `npm run dev`.',
      }));
      return;
    }
    setState((s) => ({ ...s, loading: true, fatalError: null }));
    try {
      const [health, ws, host, model, modelsRes, anthropicKey, openaiKey, geminiKey, perplexityKey, groqKey, mistralKey, xaiKey] =
        await Promise.all([
          ipc.ollama.health(),
          ipc.settings.get('workspaces_dir'),
          ipc.settings.get('ollama_host'),
          ipc.settings.get('orchestrator_model'),
          ipc.chat.listModels(),
          ipc.settings.get('anthropic_api_key'),
          ipc.settings.get('openai_api_key'),
          ipc.settings.get('gemini_api_key'),
          ipc.settings.get('perplexity_api_key'),
          ipc.settings.get('groq_api_key'),
          ipc.settings.get('mistral_api_key'),
          ipc.settings.get('xai_api_key'),
        ]);
      setState((s) => ({
        ...s,
        ollama: health,
        workspacesDir: ws.value ?? '',
        ollamaHost: host.value ?? 'http://localhost:11434',
        orchestratorModel: model.value ?? '',
        models: modelsRes.models,
        anthropicKey: anthropicKey.value ?? '',
        openaiKey: openaiKey.value ?? '',
        geminiKey: geminiKey.value ?? '',
        perplexityKey: perplexityKey.value ?? '',
        groqKey: groqKey.value ?? '',
        mistralKey: mistralKey.value ?? '',
        xaiKey: xaiKey.value ?? '',
        loading: false,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        fatalError: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveOllamaHost(): Promise<void> {
    await ipc.settings.set('ollama_host', state.ollamaHost.trim() || 'http://localhost:11434');
    setState((s) => ({ ...s, saveStatus: 'Saved. Restart app to take effect.' }));
    setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 4000);
  }

  async function saveOrchestratorModel(): Promise<void> {
    if (!state.orchestratorModel) return;
    await ipc.settings.set('orchestrator_model', state.orchestratorModel);
    setState((s) => ({ ...s, saveStatus: 'Saved.' }));
    setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 3000);
  }

  if (state.fatalError) {
    return (
      <div className="card border-[var(--bad)]/40">
        <h3 className="text-base font-semibold mb-2 text-[var(--bad)]">Connection error</h3>
        <p className="text-sm text-[var(--ink-muted)]">{state.fatalError}</p>
      </div>
    );
  }

  return (
    <div className="screen-enter h-full overflow-y-auto settings-page space-y-5">
      <header className="mb-2">
        <div className="eyebrow">Settings</div>
        <h2 className="section-title" style={{ marginBottom: 8, fontSize: 32 }}>Preferences</h2>
      </header>
      <OllamaCard
        loading={state.loading}
        ollama={state.ollama}
        onRecheck={() => void refresh()}
      />

      <section className="settings-section">
        <div className="head">
          <h3>Local runtime</h3>
          <span className="muted text-xs">Restart app to apply changes.</span>
        </div>
        <div className="settings-row">
          <div className="lab">
            Host
            <span className="hint">HTTP endpoint of your local Ollama server</span>
          </div>
          <div className="row gap-2">
            <input
              value={state.ollamaHost}
              onChange={(e) => setState((s) => ({ ...s, ollamaHost: e.target.value }))}
              className="field"
              placeholder="http://localhost:11434"
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void saveOllamaHost()}>
              Save
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div className="lab">
            Orchestrator model
            <span className="hint">Picks an agent when you use the global "Ask anything" box</span>
          </div>
          <div className="row gap-2">
            <select
              value={state.orchestratorModel}
              onChange={(e) => setState((s) => ({ ...s, orchestratorModel: e.target.value }))}
              className="field"
            >
              <option value="">(auto-pick)</option>
              {state.models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void saveOrchestratorModel()}
              disabled={state.orchestratorModel === ''}
            >
              Save
            </button>
          </div>
        </div>
      </section>

      <OllamaCloudCard onSaved={(msg) => {
        setState((s) => ({ ...s, saveStatus: msg }));
        setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
      }} />

      <section className="settings-section">
        <div className="head">
          <h3>Cloud models</h3>
          <span className="muted text-xs">API key per provider. Keys stay on this machine.</span>
        </div>
        <CloudConnector
          provider="anthropic"
          label="Anthropic (Claude)"
          accountUrl="https://console.anthropic.com/login"
          keysUrl="https://console.anthropic.com/settings/keys"
          placeholder="sk-ant-…"
          settingsKey="anthropic_api_key"
          currentKey={state.anthropicKey}
          onKeyChange={(v) => setState((s) => ({ ...s, anthropicKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
        <CloudConnector
          provider="openai"
          label="OpenAI (GPT)"
          accountUrl="https://platform.openai.com/login"
          keysUrl="https://platform.openai.com/api-keys"
          placeholder="sk-…"
          settingsKey="openai_api_key"
          currentKey={state.openaiKey}
          onKeyChange={(v) => setState((s) => ({ ...s, openaiKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
        <CloudConnector
          provider="gemini"
          label="Google (Gemini)"
          accountUrl="https://aistudio.google.com/"
          keysUrl="https://aistudio.google.com/app/apikey"
          placeholder="AIza…"
          settingsKey="gemini_api_key"
          currentKey={state.geminiKey}
          onKeyChange={(v) => setState((s) => ({ ...s, geminiKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
        <CloudConnector
          provider="perplexity"
          label="Perplexity (Sonar)"
          accountUrl="https://www.perplexity.ai/"
          keysUrl="https://www.perplexity.ai/settings/api"
          placeholder="pplx-…"
          settingsKey="perplexity_api_key"
          currentKey={state.perplexityKey}
          onKeyChange={(v) => setState((s) => ({ ...s, perplexityKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
        <CloudConnector
          provider="groq"
          label="Groq (fast Llama / Qwen)"
          accountUrl="https://console.groq.com/login"
          keysUrl="https://console.groq.com/keys"
          placeholder="gsk_…"
          settingsKey="groq_api_key"
          currentKey={state.groqKey}
          onKeyChange={(v) => setState((s) => ({ ...s, groqKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
        <CloudConnector
          provider="mistral"
          label="Mistral"
          accountUrl="https://console.mistral.ai/"
          keysUrl="https://console.mistral.ai/api-keys"
          placeholder="…"
          settingsKey="mistral_api_key"
          currentKey={state.mistralKey}
          onKeyChange={(v) => setState((s) => ({ ...s, mistralKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
        <CloudConnector
          provider="xai"
          label="xAI (Grok)"
          accountUrl="https://console.x.ai/"
          keysUrl="https://console.x.ai/team/default/api-keys"
          placeholder="xai-…"
          settingsKey="xai_api_key"
          currentKey={state.xaiKey}
          onKeyChange={(v) => setState((s) => ({ ...s, xaiKey: v }))}
          onSaved={(msg) => {
            setState((s) => ({ ...s, saveStatus: msg }));
            setTimeout(() => setState((s) => ({ ...s, saveStatus: null })), 2500);
          }}
        />
      </section>

      <section className="settings-section">
        <div className="head"><h3>Workspaces</h3></div>
        <div className="settings-row">
          <div className="lab">
            Root folder
            <span className="hint">Each agent gets a sandboxed subfolder here</span>
          </div>
          <code className="kbd" style={{ alignSelf: 'flex-start' }}>{state.workspacesDir || '—'}</code>
        </div>
      </section>

      <PersonasCard />

      <section className="settings-section">
        <div className="head"><h3>MCP servers</h3></div>
        <McpServersCard />
      </section>

      <ClisSection />

      <NotificationsSection />

      <DevToolsSettings />

      <section className="settings-section">
        <div className="head"><h3>Keyboard shortcuts</h3></div>
        <ShortcutsList />
      </section>

      {state.saveStatus ? (
        <div className="rounded-md bg-[var(--good-soft)] text-[var(--good)] px-3 py-2 text-sm">
          {state.saveStatus}
        </div>
      ) : null}
    </div>
  );
}

interface OllamaCardProps {
  loading: boolean;
  ollama: OllamaState | null;
  onRecheck: () => void;
}

function OllamaCard({ loading, ollama, onRecheck }: OllamaCardProps): JSX.Element {
  const reachable = ollama?.reachable === true;
  const dotClass = loading ? 'dot dot-good dot-pulse' : reachable ? 'dot dot-good' : 'dot dot-bad';
  const pillText = loading ? 'Checking…' : reachable ? 'Connected' : 'Not detected';
  const pillClass =
    reachable && !loading
      ? 'pill pill-good'
      : !reachable && !loading
        ? 'pill pill-bad'
        : 'pill';

  return (
    <section className="card">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className={dotClass} />
            <h3 className="text-base font-semibold">Ollama runtime</h3>
          </div>
          <p className="text-sm text-[var(--ink-muted)] mt-1">
            Local model server that powers your agents. Required to chat.
          </p>
        </div>
        <button type="button" className="btn" onClick={onRecheck} disabled={loading}>
          {loading ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      <div className="card-row flex flex-wrap items-center gap-4 text-sm">
        <span className={pillClass}>{pillText}</span>
        {ollama?.version ? (
          <span className="text-[var(--ink-muted)]">
            Version <span className="kbd">v{ollama.version}</span>
          </span>
        ) : null}
        <span className="text-[var(--ink-faint)]">
          Host <span className="kbd">{ollama?.host ?? 'http://localhost:11434'}</span>
        </span>
      </div>

      {!loading && !reachable ? (
        <div className="card-row text-sm text-[var(--ink-muted)] space-y-1">
          <p>To get started:</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Install Ollama from{' '}
              <a
                href="https://ollama.com"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline-offset-2 hover:underline"
              >
                ollama.com
              </a>
              .
            </li>
            <li>
              Run <span className="kbd">ollama serve</span> in a terminal.
            </li>
            <li>Click Re-check above.</li>
          </ol>
          {ollama?.errorMessage ? (
            <p className="text-xs text-[var(--bad)] mt-2">Last error: {ollama.errorMessage}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface WorkspaceCardProps {
  loading: boolean;
  workspacesDir: string;
}

function WorkspaceCard({ loading, workspacesDir }: WorkspaceCardProps): JSX.Element {
  return (
    <section className="card">
      <h3 className="text-base font-semibold">Workspaces directory</h3>
      <p className="text-sm text-[var(--ink-muted)] mt-1 mb-3">
        Each agent gets a sandboxed folder created inside this directory.
      </p>
      {loading ? (
        <div className="h-5 w-2/3 bg-[var(--surface-2)] rounded animate-pulse" />
      ) : (
        <code className="text-sm break-all kbd inline-block max-w-full">
          {workspacesDir || '—'}
        </code>
      )}
    </section>
  );
}

interface CloudConnectorProps {
  provider: 'anthropic' | 'openai' | 'gemini' | 'perplexity' | 'groq' | 'mistral' | 'xai';
  label: string;
  accountUrl: string;
  keysUrl: string;
  placeholder: string;
  settingsKey: string;
  currentKey: string;
  onKeyChange: (v: string) => void;
  onSaved: (msg: string) => void;
}

function CloudConnector({
  provider,
  label,
  accountUrl,
  keysUrl,
  placeholder,
  settingsKey,
  currentKey,
  onKeyChange,
  onSaved,
}: CloudConnectorProps): JSX.Element {
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; models: number; error?: string } | null>(null);
  const [pasteHint, setPasteHint] = useState<string | null>(null);
  const keyInputRef = useRef<HTMLInputElement | null>(null);
  const connected = currentKey.trim().length > 0;

  /** Provider's API key prefixes. Used to validate clipboard contents
   *  and to skip auto-paste when the clipboard holds something unrelated. */
  const prefixForProvider: Record<typeof provider, string[]> = {
    anthropic: ['sk-ant-'],
    openai: ['sk-', 'sess-'],
    gemini: ['AIza'],
    perplexity: ['pplx-'],
    groq: ['gsk_'],
    mistral: [''], // mistral keys are alphanumeric, no fixed prefix
    xai: ['xai-'],
  };

  function looksLikeProviderKey(s: string): boolean {
    const t = s.trim();
    if (t.length < 8 || t.length > 256 || /\s/.test(t)) return false;
    const prefixes = prefixForProvider[provider];
    if (!prefixes || prefixes.length === 0) return /^[A-Za-z0-9_\-.]+$/.test(t);
    return prefixes.some((p) => p === '' || t.startsWith(p));
  }

  async function pasteFromClipboard(): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        setPasteHint('Clipboard is empty.');
        setTimeout(() => setPasteHint(null), 2200);
        return;
      }
      if (!looksLikeProviderKey(text)) {
        setPasteHint(`That clipboard text does not look like a ${label} API key.`);
        setTimeout(() => setPasteHint(null), 3200);
        return;
      }
      onKeyChange(text);
      setPasteHint('Pasted from clipboard — review then Save.');
      setTimeout(() => setPasteHint(null), 2200);
      keyInputRef.current?.focus();
      keyInputRef.current?.select();
    } catch {
      setPasteHint('Could not read clipboard — paste manually below.');
      setTimeout(() => setPasteHint(null), 2500);
    }
  }

  async function openSignIn(): Promise<void> {
    await ipc.shellOpen.url(accountUrl);
    // Also open the keys page in a second tab so the user lands on the
    // page where they actually create the key after signing in.
    setTimeout(() => void ipc.shellOpen.url(keysUrl), 600);
    // Focus the paste field so the next thing the user does (paste) lands
    // in the right place when they tab back to Flowstate.
    setTimeout(() => keyInputRef.current?.focus(), 1200);
    // Try one automatic clipboard read shortly after — if the user copied
    // the key in the browser already, this just works.
    setTimeout(() => {
      void (async () => {
        try {
          const text = (await navigator.clipboard.readText()).trim();
          if (looksLikeProviderKey(text) && currentKey.trim().length === 0) {
            onKeyChange(text);
            setPasteHint('Auto-detected an API key on your clipboard. Click Save to confirm.');
            setTimeout(() => setPasteHint(null), 3500);
          }
        } catch {
          /* clipboard permission denied — silent */
        }
      })();
    }, 2500);
  }

  async function save(): Promise<void> {
    await ipc.settings.set(settingsKey, currentKey.trim());
    onSaved(`${label} key saved.`);
  }

  async function disconnect(): Promise<void> {
    onKeyChange('');
    await ipc.settings.set(settingsKey, '');
    setTest(null);
    onSaved(`${label} disconnected.`);
  }

  async function runTest(): Promise<void> {
    setTesting(true);
    try {
      const res = await ipc.cloud.test(provider);
      setTest(res);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-elev)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--ink)',
            }}
          >
            <BrandLogo name={label} size={16} />
          </span>
          <span
            className={
              connected ? 'dot dot-good' : 'dot dot-bad'
            }
          />
          <span className="text-sm font-medium text-[var(--ink)]">{label}</span>
          <span className="text-[10px] text-[var(--ink-faint)] uppercase tracking-[0.12em] font-semibold">
            {connected ? 'connected' : 'not connected'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void openSignIn()}
            title={`Open ${label} in your browser → sign in → create a key → Flowstate auto-detects it from your clipboard`}
          >
            Sign in to {label.split(' ')[0]}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 4 }}>
              <path d="M3 7L7 3 M4 3h3v3" stroke="currentColor" strokeWidth={1.2} fill="none" />
            </svg>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void pasteFromClipboard()}
            title="Paste a key from your clipboard"
          >
            Paste key
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          ref={keyInputRef}
          type="password"
          value={currentKey}
          onChange={(e) => onKeyChange(e.target.value)}
          onPaste={() => {
            // Mark a hint so user knows their key was pasted; they still
            // need to hit Save to persist.
            setPasteHint('Key pasted — click Save to confirm.');
            setTimeout(() => setPasteHint(null), 2000);
          }}
          placeholder={placeholder}
          className="field text-xs"
          autoComplete="off"
        />
        <button
          type="button"
          className="btn btn-primary text-xs"
          onClick={() => void save()}
          disabled={currentKey.trim().length === 0}
        >
          Save
        </button>
      </div>
      {pasteHint ? (
        <div
          aria-live="polite"
          className="text-[11px]"
          style={{ color: 'var(--ink-muted)', marginTop: 2 }}
        >
          {pasteHint}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn text-xs"
          onClick={() => void runTest()}
          disabled={!connected || testing}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {connected ? (
          <button
            type="button"
            className="text-[11px] px-2 py-1 rounded text-[var(--bad)] hover:bg-[var(--surface)] transition-colors"
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        ) : null}
        {test ? (
          test.ok ? (
            <span className="text-[11px] text-[var(--good)]">
              {test.models} models available
            </span>
          ) : (
            <span className="text-[11px] text-[var(--bad)]">{test.error ?? 'Failed'}</span>
          )
        ) : null}
      </div>

      <p className="text-[10px] text-[var(--ink-faint)] leading-relaxed">
        Sign in with your {label.split(' ')[0]} account → create an API key on the keys
        page → paste it above. The key never leaves this machine.
      </p>
    </div>
  );
}

function OllamaCloudCard({ onSaved }: { onSaved: (msg: string) => void }): JSX.Element {
  const [status, setStatus] = useState<{ signedIn: boolean; user: string; error?: string } | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const [log, setLog] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const r = await ipc.ollama.cloudStatus();
      setStatus(r);
    } catch (err) {
      setStatus({
        signedIn: false,
        user: '',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  async function signin(): Promise<void> {
    setWorking(true);
    setLog('Opening browser for Ollama sign-in…');
    try {
      const res = await ipc.ollama.cloudSignin();
      if (res.ok) {
        setLog('Signed in. Cloud models are now available via `ollama pull`.');
        onSaved('Signed in to Ollama cloud.');
        await refresh();
      } else {
        setLog(res.error || 'Sign-in failed.');
      }
    } finally {
      setWorking(false);
    }
  }

  async function signout(): Promise<void> {
    setWorking(true);
    try {
      const res = await ipc.ollama.cloudSignout();
      if (res.ok) {
        onSaved('Signed out of Ollama cloud.');
        setLog('Signed out.');
        await refresh();
      } else {
        setLog(res.error || 'Sign-out failed.');
      }
    } finally {
      setWorking(false);
    }
  }

  const connected = !!status?.signedIn;

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Ollama cloud (Turbo)</h3>
        <span className="muted text-xs">
          Use your Ollama account subscription to run large cloud-only models.
        </span>
      </div>
      <div className="settings-row" style={{ alignItems: 'start' }}>
        <div className="lab">
          Account
          <span className="hint">
            Runs <code className="mono">ollama signin</code> — opens your browser, no API key
            required. After signing in, models like <code className="mono">gpt-oss:120b</code>,{' '}
            <code className="mono">llama3.3:70b-cloud</code>, and other Turbo-only models become
            pull-able from the library browser below.
          </span>
        </div>
        <div className="col gap-2">
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <span
              className={connected ? 'pill good' : 'pill'}
              aria-live="polite"
            >
              <span className="dot" />
              <span>
                {connected
                  ? `Signed in${status?.user ? ` · ${status.user}` : ''}`
                  : 'Not signed in'}
              </span>
            </span>
            {connected ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void signout()}
                disabled={working}
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => void signin()}
                disabled={working}
              >
                {working ? 'Opening browser…' : 'Sign in to Ollama'}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 4 }}>
                  <path d="M3 7L7 3 M4 3h3v3" stroke="currentColor" strokeWidth={1.2} fill="none" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void ipc.shellOpen.url('https://ollama.com/turbo')}
              title="Learn about Ollama Turbo (cloud subscription)"
            >
              About Turbo
            </button>
          </div>
          {log ? (
            <div className="text-[11px] muted" aria-live="polite">
              {log}
            </div>
          ) : null}
          {status?.error ? (
            <div className="text-[11px]" style={{ color: 'var(--bad)' }}>
              {status.error}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

interface Persona {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
}

function PersonasCard(): JSX.Element {
  const [items, setItems] = useState<Persona[]>([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [draft, setDraft] = useState<Persona>({ id: '', name: '', description: '', agentIds: [] });
  const [editing, setEditing] = useState<boolean>(false);

  async function refresh(): Promise<void> {
    const [s, a] = await Promise.all([ipc.settings.get('personas_v1'), ipc.chat.listAgents()]);
    setAgents(a.agents);
    try {
      const parsed = s.value ? (JSON.parse(s.value) as Persona[]) : [];
      setItems(Array.isArray(parsed) ? parsed : []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function persist(next: Persona[]): Promise<void> {
    setItems(next);
    await ipc.settings.set('personas_v1', JSON.stringify(next));
  }

  async function save(): Promise<void> {
    if (draft.name.trim().length === 0 || draft.agentIds.length === 0) return;
    const id = draft.id || crypto.randomUUID();
    const row: Persona = { ...draft, id };
    const next = items.some((p) => p.id === id)
      ? items.map((p) => (p.id === id ? row : p))
      : [...items, row];
    await persist(next);
    setDraft({ id: '', name: '', description: '', agentIds: [] });
    setEditing(false);
  }

  async function remove(id: string): Promise<void> {
    await persist(items.filter((p) => p.id !== id));
  }

  function toggleAgent(id: string): void {
    setDraft((d) => ({
      ...d,
      agentIds: d.agentIds.includes(id) ? d.agentIds.filter((x) => x !== id) : [...d.agentIds, id],
    }));
  }

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Agent personas</h3>
        <span className="muted text-xs">
          Saved team compositions. Pick a set, launch them together.
        </span>
      </div>

      {items.length > 0 ? (
        <div className="col gap-2 mb-3">
          {items.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 90px 80px', gap: 10, alignItems: 'center' }}
            >
              <div>
                <div style={{ color: 'var(--ink-strong)', fontWeight: 500 }}>{p.name}</div>
                <div className="muted text-xs" style={{ marginTop: 2 }}>{p.description || '—'}</div>
                <div className="row gap-1 mt-2" style={{ flexWrap: 'wrap' }}>
                  {p.agentIds.map((id) => {
                    const a = agents.find((x) => x.id === id);
                    return (
                      <span key={id} className="pill" style={{ height: 18, padding: '0 7px', fontSize: 10 }}>
                        <span>{a?.name ?? id.slice(0, 8)}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { setDraft(p); setEditing(true); }}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ color: 'var(--bad)' }}
                onClick={() => void remove(p.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {editing ? (
        <div className="settings-row" style={{ alignItems: 'start' }}>
          <div className="lab">
            {draft.id ? 'Edit persona' : 'New persona'}
            <span className="hint">Group agents that work well together.</span>
          </div>
          <div className="col gap-2">
            <input
              className="field"
              placeholder="Persona name — e.g. Design Review Crew"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
            <input
              className="field"
              placeholder="Short description"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
            />
            <div
              className="row gap-1"
              style={{ flexWrap: 'wrap', maxHeight: 180, overflowY: 'auto', padding: 6, border: '1px solid var(--border)', borderRadius: 6 }}
            >
              {agents.map((a) => {
                const on = draft.agentIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={'btn btn-sm ' + (on ? '' : 'btn-ghost')}
                    onClick={() => toggleAgent(a.id)}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
            <div className="row gap-2">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => void save()}>
                Save
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => { setDraft({ id: '', name: '', description: '', agentIds: [] }); setEditing(false); }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
          + New persona
        </button>
      )}
    </section>
  );
}

function SchedulesCard(): JSX.Element {
  const [items, setItems] = useState<
    Array<{
      id: string;
      agentId: string;
      prompt: string;
      intervalMinutes: number;
      enabled: boolean;
      nextRunAt: number;
      lastRunAt: number | null;
    }>
  >([]);
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [agentId, setAgentId] = useState<string>('');
  const [prompt, setPrompt] = useState<string>('');
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);

  async function refresh(): Promise<void> {
    const [s, a] = await Promise.all([ipc.schedules.list(), ipc.chat.listAgents()]);
    setItems(s.items);
    setAgents(a.agents);
    if (!agentId && a.agents.length > 0) setAgentId(a.agents[0]!.id);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add(): Promise<void> {
    if (!agentId || prompt.trim().length === 0) return;
    await ipc.schedules.create({ agentId, prompt: prompt.trim(), intervalMinutes });
    setPrompt('');
    void refresh();
  }

  async function remove(id: string): Promise<void> {
    await ipc.schedules.delete(id);
    void refresh();
  }

  async function toggle(id: string, enabled: boolean): Promise<void> {
    await ipc.schedules.toggle(id, enabled);
    void refresh();
  }

  return (
    <section className="settings-section">
      <div className="head">
        <h3>Scheduled tasks</h3>
        <span className="muted text-xs">
          Recurring runs — pick an agent + prompt + how often. Each run starts a fresh chat.
        </span>
      </div>
      <div className="settings-row" style={{ alignItems: 'start' }}>
        <div className="lab">
          New schedule
          <span className="hint">Runs in the background while the app is open.</span>
        </div>
        <div className="col gap-2">
          <div className="row gap-2">
            <select
              className="field"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              style={{ flex: 1 }}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              className="field"
              value={intervalMinutes}
              min={1}
              max={60 * 24 * 30}
              onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
              style={{ width: 90 }}
              title="Interval in minutes"
            />
            <span className="muted text-xs" style={{ alignSelf: 'center' }}>
              min
            </span>
          </div>
          <input
            className="field"
            placeholder="Prompt — what should the agent do each run?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void add()}
              disabled={prompt.trim().length === 0 || !agentId}
            >
              Schedule
            </button>
          </div>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="col gap-2 mt-3">
          {items.map((it) => {
            const ag = agents.find((a) => a.id === it.agentId);
            const next = new Date(it.nextRunAt).toLocaleString();
            const last = it.lastRunAt ? new Date(it.lastRunAt).toLocaleString() : 'never';
            return (
              <div
                key={it.id}
                className="card"
                style={{
                  padding: 10,
                  display: 'grid',
                  gridTemplateColumns: '1fr 110px 80px 80px',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--ink-strong)', fontSize: 13 }}>
                    {ag?.name ?? 'unknown agent'}
                  </div>
                  <div className="muted text-xs" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.prompt}
                  </div>
                  <div className="muted text-xs mt-1 mono" style={{ fontSize: 10 }}>
                    every {it.intervalMinutes}m · next {next} · last {last}
                  </div>
                </div>
                <span className={it.enabled ? 'pill good' : 'pill'}>
                  <span className="dot" />
                  <span>{it.enabled ? 'active' : 'paused'}</span>
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => void toggle(it.id, !it.enabled)}
                >
                  {it.enabled ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  style={{ color: 'var(--bad)' }}
                  onClick={() => void remove(it.id)}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
