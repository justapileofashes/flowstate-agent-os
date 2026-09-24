import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  session,
  shell,
} from 'electron';
import { CHANNELS } from '@shared/ipc-channels';
import type { Database as DB } from 'better-sqlite3';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, setHelperWorkspace } from './db/database';
import { databasePath, defaultWorkspacesDir } from './paths';
import { SettingsService } from './services/settings-service';
import { initTradingService } from './services/trading-service';
import { SecretStore, electronSafeStorageBackend } from './services/secret-store';
import { initAutoUpdate } from './services/auto-update';
import { OllamaClient } from './services/ollama-client';
import { OllamaProvider } from './agent/ollama-provider';
import { AnthropicProvider } from './agent/anthropic-provider';
import { OpenAIProvider } from './agent/openai-provider';
import { GeminiProvider } from './agent/gemini-provider';
import { ProviderRouter } from './agent/provider-router';
import { ChatRepository } from './repos/chat-repository';
import { AuditRepository } from './repos/audit-repository';
import { AuditLogger } from './services/audit-logger';
import { AgentSessionManager } from './agent/agent-session-manager';
import { ApprovalGate } from './agent/approval-gate';
import { Orchestrator } from './agent/orchestrator';
import { Coordinator } from './agent/coordinator';
import { AgentGenerator } from './agent/agent-generator';
import { McpManager } from './services/mcp-manager';
import { PluginManager } from './services/plugin-manager';
import { SkillRegistry } from './services/skill-registry';
import { HookRunner } from './agent/hook-runner';
import { SecondBrain } from './services/second-brain';
import { SnapshotService } from './services/snapshot-service';
import { detectHardware } from './services/hardware-info';
import {
  pickModelsForAgents,
  fetchInstalledModelNames,
} from './services/agent-model-matcher';
import { SEED_AGENTS } from './seed-agents';
import { registerIpcHandlers } from './ipc/register';
import { getConnectedClis } from './ipc/handlers/clis';
import { decideNotification } from './services/notify';

const here = fileURLToPath(new URL('.', import.meta.url));

let db: DB | null = null;

function resolveIcon(): Electron.NativeImage | undefined {
  // Try common locations for the app icon (dev tree + packaged resources).
  const candidates = [
    join(here, '../../build/icon.png'),
    join(here, '../../../build/icon.png'),
    join(process.resourcesPath || '', 'build/icon.png'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  }
  return undefined;
}

function createWindow(opts: { popoutChatId?: string; popoutAgentId?: string } = {}): BrowserWindow {
  const icon = resolveIcon();
  const isPopout = !!opts.popoutChatId;
  const win = new BrowserWindow({
    width: isPopout ? 900 : 1280,
    height: isPopout ? 700 : 800,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0e0d0c',
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.on('ready-to-show', () => win.show());
  win.on('maximize', () => win.webContents.send('window:maximized-changed', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false));

  // Never let the renderer (or LLM/agent-rendered markdown links) open a
  // sub-window or hand an arbitrary URL to the OS. Only http(s)/mailto reach the
  // browser; everything else (file:, javascript:, custom protocols) is denied.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Block in-app navigation away from our own renderer (a clicked markdown link
  // must not replace the app with a remote page). Allow only the dev server URL
  // and the packaged file:// origin.
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    const allowed =
      (devUrl && url.startsWith(devUrl)) || url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
    }
  });

  const query = opts.popoutChatId
    ? `?popout=1&chatId=${encodeURIComponent(opts.popoutChatId)}${opts.popoutAgentId ? `&agentId=${encodeURIComponent(opts.popoutAgentId)}` : ''}`
    : '';

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'] + query);
  } else {
    void win.loadFile(join(here, '../renderer/index.html'), { search: query.slice(1) });
  }
  return win;
}

/** Only http(s) and mailto are safe to hand to the OS shell. */
function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/**
 * Content-Security-Policy for the renderer. Defense-in-depth on top of
 * contextIsolation + sandbox: blocks remote script injection and limits where
 * the page may load resources or connect. Relaxed in dev so Vite HMR (inline
 * scripts, eval, websocket) works; strict in the packaged build.
 */
function installContentSecurityPolicy(): void {
  const dev = !!process.env['ELECTRON_RENDERER_URL'];
  const scriptSrc = dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'";
  const connectSrc = dev ? "'self' ws: http: https:" : "'self' https:";
  const policy = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function showFatalDialog(title: string, message: string): void {
  dialog.showErrorBox(title, message);
}

app.whenReady().then(async () => {
  installContentSecurityPolicy();
  initAutoUpdate();
  try {
    db = openDatabase(databasePath());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showFatalDialog(
      'Flowstate failed to open its database',
      `${msg}\n\nDatabase path: ${databasePath()}\n\n` +
        'You can try deleting the file to reset Flowstate, or check folder permissions.',
    );
    app.quit();
    return;
  }

  // System-audio loopback: makes renderer getDisplayMedia({audio:true}) yield
  // desktop audio on Windows (Electron 33+). Used by the webinar Capture card.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        const first = sources[0];
        if (first) callback({ video: first, audio: 'loopback' });
        else callback({});
      });
    },
    { useSystemPicker: false },
  );

  // Encrypt secret settings (API keys, license tokens) at rest via the OS
  // keychain so the SQLite file never holds them in plaintext.
  const secretStore = new SecretStore(electronSafeStorageBackend());
  const settings = new SettingsService(db, secretStore);

  // Autonomous trading facade (Alpaca + journal + guardrails). Singleton so
  // the agent tool dispatcher and the IPC handlers share one guarded pipeline.
  const trading = initTradingService(db, settings);

  if (settings.get('workspaces_dir') === null) {
    settings.set('workspaces_dir', defaultWorkspacesDir());
  }

  const workspacesDir = settings.get('workspaces_dir')!;
  const helperPath = join(workspacesDir, 'code-helper');
  try {
    await mkdir(helperPath, { recursive: true });
  } catch {
    // best-effort; agent will fail later with a clear error if dir is unusable
  }
  setHelperWorkspace(db, helperPath);

  const ollamaHost = settings.get('ollama_host') ?? 'http://localhost:11434';
  const ollamaClient = new OllamaClient(ollamaHost);
  const ollamaProviderInstance = new OllamaProvider(ollamaHost);
  const anthropicProvider = new AnthropicProvider(() => settings.get('anthropic_api_key') ?? '');
  const openaiProvider = new OpenAIProvider(() => settings.get('openai_api_key') ?? '');
  const geminiProvider = new GeminiProvider(() => settings.get('gemini_api_key') ?? '');
  // Perplexity, Groq, Mistral, xAI all expose OpenAI-compatible APIs.
  // Reuse OpenAIProvider with a custom host + null filter so all returned
  // models are visible to the test-connection helper.
  const perplexityProvider = new OpenAIProvider(
    () => settings.get('perplexity_api_key') ?? '',
    'https://api.perplexity.ai',
    null,
  );
  const groqProvider = new OpenAIProvider(
    () => settings.get('groq_api_key') ?? '',
    'https://api.groq.com/openai',
    null,
  );
  const mistralProvider = new OpenAIProvider(
    () => settings.get('mistral_api_key') ?? '',
    'https://api.mistral.ai',
    null,
  );
  const xaiProvider = new OpenAIProvider(
    () => settings.get('xai_api_key') ?? '',
    'https://api.x.ai',
    null,
  );
  const provider = new ProviderRouter({
    ollama: ollamaProviderInstance,
    anthropic: anthropicProvider,
    openai: openaiProvider,
    gemini: geminiProvider,
    perplexity: perplexityProvider,
    groq: groqProvider,
    mistral: mistralProvider,
    xai: xaiProvider,
  });

  const repo = new ChatRepository(db);

  // Seed extra agents on first run (matched by id; never overwrites).
  for (const seed of SEED_AGENTS) {
    if (repo.getAgent(seed.id)) continue;
    const wsPath = join(workspacesDir, seed.workspaceSlug);
    try {
      await mkdir(wsPath, { recursive: true });
    } catch {
      // best-effort
    }
    try {
      repo.createAgent({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        specialtyTags: seed.specialtyTags,
        systemPrompt: seed.systemPrompt,
        model: seed.model,
        avatarColor: seed.avatarColor,
        workspacePath: wsPath,
        toolPerms: seed.toolPerms,
        approvalPolicy: seed.approvalPolicy,
      });
      console.log(`[flowstate] seeded agent ${seed.id}`);
    } catch (err) {
      console.warn(`[flowstate] failed to seed ${seed.id}:`, err);
    }
  }

  // Hardware-aware model auto-assignment. For each agent, infer the right
  // category (code / reasoning / vision / general) from id + name + tags +
  // description, then pick the best installed model that fits this box's
  // VRAM/RAM. Preserves an agent's existing model when it's installed and
  // already category-correct (avoid churn). Falls back to general / any
  // runnable installed model when category-specific lookups are empty.
  try {
    const hardware = await detectHardware();
    const installedNames = await fetchInstalledModelNames(provider);
    const cloudAvailable = {
      anthropic: Boolean(settings.get('anthropic_api_key')),
      openai: Boolean(settings.get('openai_api_key')),
      gemini: Boolean(settings.get('gemini_api_key')),
      perplexity: Boolean(settings.get('perplexity_api_key')),
      groq: Boolean(settings.get('groq_api_key')),
      mistral: Boolean(settings.get('mistral_api_key')),
      xai: Boolean(settings.get('xai_api_key')),
    };
    const anyCloud = Object.values(cloudAvailable).some(Boolean);
    if (installedNames.length > 0 || anyCloud) {
      const matches = pickModelsForAgents(repo.listAgents(), hardware, installedNames, cloudAvailable);
      const now = Date.now();
      for (const m of matches) {
        if (m.pickedModel && m.pickedModel !== m.previousModel) {
          db.prepare('UPDATE agents SET model = ?, updated_at = ? WHERE id = ?').run(
            m.pickedModel,
            now,
            m.agentId,
          );
          console.log(
            `[flowstate] auto-assigned ${m.agentId}: ${m.previousModel} -> ${m.pickedModel} (${m.reason})`,
          );
        } else if (!m.pickedModel) {
          console.warn(`[flowstate] no fit for ${m.agentId}: ${m.reason}`);
        }
      }
    }
  } catch (err) {
    console.warn('[flowstate] auto-assign failed:', err);
  }

  const send = (channel: string, payload: unknown) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send(channel, payload);
    maybeNotify(win, payload);
  };

  // Desktop notification when the user is away from the window (roadmap 2c).
  // Opt-out via the settings KV: notifications_enabled = 'false'.
  const maybeNotify = (win: BrowserWindow | undefined, payload: unknown) => {
    if (settings.get('notifications_enabled') === 'false') return;
    if (win && win.isFocused() && !win.isMinimized()) return;
    const content = decideNotification(payload);
    if (!content || !Notification.isSupported()) return;
    const notif = new Notification({ title: content.title, body: content.body });
    notif.on('click', () => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      if (w.isMinimized()) w.restore();
      w.focus();
    });
    notif.show();
  };

  const auditRepo = new AuditRepository(db);
  const audit = new AuditLogger(auditRepo);
  const approvalGate = new ApprovalGate(send, undefined, audit);
  const mcpManager = new McpManager();

  // Claude Code-format plugins + skills. Installed under userData; also
  // discovers (read-only) the user's ~/.claude plugins + standalone skills.
  const claudeHome = join(app.getPath('home'), '.claude');
  const pluginManager = new PluginManager({
    root: join(app.getPath('userData'), 'plugins'),
    pluginsHome: join(claudeHome, 'plugins'),
    skillsHome: join(claudeHome, 'skills'),
  });
  try {
    await pluginManager.load();
  } catch (err) {
    console.warn('[flowstate] plugin manager load failed:', err);
  }
  const skillRegistry = new SkillRegistry({
    skills: () => pluginManager.skills(),
    allowlist: (agentId) => pluginManager.getAgentSkills(agentId),
  });
  const hookRunner = new HookRunner(() => pluginManager.hooks(), audit);

  // Second brain — default vault inside workspaces dir, overridable via setting.
  const brainVaultDefault = join(workspacesDir, 'second-brain');
  const brainVault = settings.get('brain_vault_path') ?? brainVaultDefault;
  if (!settings.get('brain_vault_path')) settings.set('brain_vault_path', brainVaultDefault);
  const brain = new SecondBrain(brainVault);
  const snapshots = new SnapshotService();
  try {
    await brain.initialize();
  } catch (err) {
    console.warn('[flowstate] brain init failed:', err);
  }

  const manager = new AgentSessionManager({
    provider,
    repo,
    approvalGate,
    send,
    mcpManager,
    brain,
    audit,
    snapshots,
    skillRegistry,
    hooks: hookRunner,
    // Per-chat model override: stored in the settings KV under
    // `chat_model_override:{chatId}`. Renderer writes via ipc.settings.set.
    getModelOverride: (chatId) => settings.get(`chat_model_override:${chatId}`),
    getWorkspaceOverride: (chatId) => settings.get(`chat_workspace_override:${chatId}`),
    getFallbackModels: () =>
      (settings.get('model_fallback_chain') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    getConnectedClis: () => getConnectedClis(),
  });

  // Orchestrator routing — pick a small/fast model for classification.
  // Reuse fallback list, but prefer non-coder instruct variants.
  const ORCHESTRATOR_PREFIXES = [
    'qwen2.5:7b',
    'qwen2.5:',
    'qwen3:',
    'llama3.1:8b',
    'llama3.1:',
    'mistral-nemo:',
  ];
  let orchestratorModel = settings.get('orchestrator_model');
  if (!orchestratorModel) {
    try {
      const installed = await provider.listModels();
      for (const prefix of ORCHESTRATOR_PREFIXES) {
        const m = installed.find((x) => x.name.startsWith(prefix));
        if (m) {
          orchestratorModel = m.name;
          break;
        }
      }
      if (!orchestratorModel && installed.length > 0) {
        orchestratorModel = installed[0]!.name;
      }
    } catch {
      // ignored — orchestrator will surface error via fallback path
    }
  }
  const orchestrator = new Orchestrator(provider, orchestratorModel ?? 'qwen2.5:7b');

  const coordinator = new Coordinator({
    provider,
    plannerModel: orchestratorModel ?? 'qwen2.5:7b',
    repo,
    approvalGate,
    mcpManager,
    brain,
    audit,
    snapshots,
  });

  const agentGenerator = new AgentGenerator(
    provider,
    orchestratorModel ?? 'qwen2.5:7b',
  );

  registerIpcHandlers({
    settings,
    trading,
    ollama: ollamaClient,
    repo,
    manager,
    approvalGate,
    provider,
    orchestrator,
    coordinator,
    agentGenerator,
    mcpManager,
    pluginManager,
    brain,
    snapshots,
    auditRepo,
    audit,
    anthropic: anthropicProvider,
    openai: openaiProvider,
    gemini: geminiProvider,
    perplexity: perplexityProvider,
    groq: groqProvider,
    mistral: mistralProvider,
    xai: xaiProvider,
    db,
    workspacesDir,
  });

  // Frameless window — strip the native menu bar entirely. All commands
  // live in the in-app command palette + Settings.
  Menu.setApplicationMenu(null);

  // Custom title-bar window controls
  ipcMain.handle('window:minimize', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.minimize();
  });
  ipcMain.handle('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return false;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
    return w.isMaximized();
  });
  ipcMain.handle('window:close', (e) => {
    BrowserWindow.fromWebContents(e.sender)?.close();
  });
  ipcMain.handle('window:is-maximized', (e) => {
    return BrowserWindow.fromWebContents(e.sender)?.isMaximized() ?? false;
  });

  ipcMain.handle(CHANNELS.WINDOW_POP_CHAT, (_e, raw) => {
    const args = raw as { chatId?: string; agentId?: string };
    if (!args?.chatId) return { ok: false };
    createWindow({
      popoutChatId: args.chatId,
      ...(args.agentId ? { popoutAgentId: args.agentId } : {}),
    });
    return { ok: true };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  ipcMain.removeAllListeners();
  if (db) {
    try {
      db.close();
    } catch {
      // best-effort
    }
    db = null;
  }
});
