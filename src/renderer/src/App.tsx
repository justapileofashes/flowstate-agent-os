import { useCallback, useEffect, useState } from 'react';
import { ipc } from './lib/ipc';
import type { AgentDto } from '@shared/chat-types';
import type { ChatListRecentChatsResponse } from '@shared/ipc-channels';
import { Settings } from './screens/Settings';
import { Chat } from './screens/Chat';
import { Dashboard } from './screens/Dashboard';
import { Models } from './screens/Models';
import { Brain } from './screens/Brain';
import { Connectors } from './screens/Connectors';
import { CodingClis } from './screens/CodingClis';
import { Plugins } from './screens/Plugins';
import { Routines } from './screens/Routines';
import { Flowclaw } from './screens/Flowclaw';
import { Business } from './screens/Business';
import { Stocks } from './screens/Stocks';
import brainIcon from './assets/brain-icon.png';
import flowclawIconV3 from './assets/flowclaw-icon-v3.png';
import { MascotLayer } from './chat/Mascot';
import { useAgentLiveStatus } from './chat/useAgentLiveStatus';
import { useCustomizePrefs } from './lib/CustomizeContext';
import { CustomizeDrawer } from './chat/CustomizeDrawer';
import { OnboardingTour } from './chat/OnboardingTour';
import { ClisOnboardingModal } from './chat/ClisOnboardingModal';
import { AnimatePresence, motion } from 'framer-motion';
import { RoutingToast, type RoutingToastInfo } from './chat/RoutingToast';
import { ModelPullerModal } from './chat/ModelPullerModal';
import { CommandPalette } from './chat/CommandPalette';
import { AgentPackRow } from './chat/AgentPackRow';
import { TeamRunModal } from './chat/TeamRunModal';
import { ShortcutsModal } from './chat/ShortcutsModal';
import { TitleBar } from './chat/TitleBar';
import { ChatHistory } from './chat/Sidebar';
import { BrandMark } from './lib/brand-mark';
import { TRANSITION_DEFAULT } from './lib/motion';

type RecentChat = ChatListRecentChatsResponse['chats'][number];

type View =
  | { kind: 'settings' }
  | { kind: 'dashboard' }
  | { kind: 'models' }
  | { kind: 'brain' }
  | { kind: 'connectors' }
  | { kind: 'coding-clis' }
  | { kind: 'plugins' }
  | { kind: 'routines' }
  | { kind: 'flowclaw' }
  | { kind: 'business' }
  | { kind: 'stocks' }
  | { kind: 'chat'; agent: AgentDto; openChatId?: string };

export function App(): JSX.Element {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [view, setView] = useState<View>({ kind: 'settings' });
  const [showPalette, setShowPalette] = useState(false);
  const [toast, setToast] = useState<RoutingToastInfo | null>(null);
  const [pendingChat, setPendingChat] = useState<{ chatId: string; firstMessage: string } | null>(null);
  const [missingModels, setMissingModels] = useState<string[] | null>(null);
  const [ollamaReachable, setOllamaReachable] = useState<boolean | null>(null);
  const [ollamaStarting, setOllamaStarting] = useState(false);
  const [ollamaStartError, setOllamaStartError] = useState<string | null>(null);
  const [teamPrompt, setTeamPrompt] = useState<string | null>(null);
  const [streamingChatIds, setStreamingChatIds] = useState<Set<string>>(new Set());
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0);
  const liveStatus = useAgentLiveStatus();
  // Pop-out mode: if URL contains ?popout=1&chatId=…, render only the
  // chat surface and hide the sidebar.
  const popoutParams = (() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('popout') !== '1') return null;
      const chatId = u.searchParams.get('chatId');
      const agentId = u.searchParams.get('agentId');
      if (!chatId) return null;
      return { chatId, agentId };
    } catch {
      return null;
    }
  })();
  const [swarmAgentIds, setSwarmAgentIds] = useState<string[]>([]);
  // Union streaming agents w/ recent swarm. Streaming agents always
  // appear; swarm members linger for visual presence.
  const liveAgentIds = Array.from(new Set<string>([...liveStatus.keys(), ...swarmAgentIds]));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const prefs = useCustomizePrefs();

  const refreshRecentChats = useCallback(async () => {
    try {
      const { chats } = await ipc.chat.listRecentChats(50);
      setRecentChats(chats);
    } catch {
      // best-effort
    }
  }, []);

  const handleRouted = useCallback(
    (
      agentId: string,
      chatId: string,
      text: string,
      reasoning: string,
      fallback: boolean,
      swarm: string[] = [],
      team = false,
    ) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        return;
      }
      // RoutingToast intentionally suppressed — routing now happens
      // instantly and the user lands directly in the chat session.
      setView({ kind: 'chat', agent, openChatId: chatId });
      // In team mode the backend already persisted the user prompt + is
      // running the coordinator in the background. Skip pendingChat so
      // the renderer doesn't double-send via the single-agent stream.
      if (!team) setPendingChat({ chatId, firstMessage: text });
      // Deploy the swarm: mascots of every chosen agent appear on the
      // chatbar for ~30s, even if only the primary is actually streaming.
      // Gives the visual impression of "the orchestrator engaged a team".
      if (swarm.length > 0) setSwarmAgentIds(swarm);
      setTimeout(() => setSwarmAgentIds([]), 30_000);
      void refreshRecentChats();
    },
    [agents, refreshRecentChats],
  );

  const refreshAgents = useCallback(async () => {
    const { agents } = await ipc.chat.listAgents();
    setAgents(agents);
    return agents;
  }, []);

  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const health = await ipc.ollama.health();
      setOllamaReachable(health.reachable);
      return health.reachable;
    } catch {
      setOllamaReachable(false);
      return false;
    }
  }, []);

  const startOllama = useCallback(async () => {
    if (ollamaStarting) return;
    setOllamaStarting(true);
    setOllamaStartError(null);
    try {
      const res = await ipc.ollama.start();
      if (!res.ok) {
        setOllamaStartError(res.error ?? 'Failed to start Ollama.');
        setOllamaStarting(false);
        return;
      }
      // Poll health for up to ~12s
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await checkHealth()) {
          setOllamaStarting(false);
          return;
        }
      }
      setOllamaStartError('Ollama did not respond after 12s. Check if it is installed.');
    } finally {
      setOllamaStarting(false);
    }
  }, [ollamaStarting, checkHealth]);

  useEffect(() => {
    void (async () => {
      const list = await refreshAgents();
      await refreshRecentChats();
      // Pop-out window: jump straight into the chat we were launched with.
      if (popoutParams) {
        const a =
          list.find((x) => x.id === popoutParams.agentId) ??
          list.find((x) => true);
        if (a) {
          setView({ kind: 'chat', agent: a, openChatId: popoutParams.chatId });
          return;
        }
      }
      if (list.length >= 2) {
        setView({ kind: 'dashboard' });
      } else if (list.length === 1) {
        setView({ kind: 'chat', agent: list[0]! });
      } else {
        setView({ kind: 'settings' });
      }

      // First-launch shortcuts intro — show unless user opted out.
      try {
        const seen = await ipc.settings.get('seen_shortcuts_intro');
        if (seen.value !== 'true') setShowShortcuts(true);
      } catch {
        // best-effort
      }

      const reachable = await checkHealth();
      if (!reachable) return;
      try {
        const { models } = await ipc.chat.listModels();
        const installed = new Set(models.map((m) => m.name));
        const required = new Set<string>();
        for (const a of list) required.add(a.model);
        const orchestrator = await ipc.settings.get('orchestrator_model');
        if (orchestrator.value) required.add(orchestrator.value);
        const missing = [...required].filter((m) => !installed.has(m));
        if (missing.length > 0) setMissingModels(missing);
      } catch {
        // ignore
      }
    })();
  }, [refreshAgents, refreshRecentChats, checkHealth]);

  // Subscribe to backend active-streams broadcast. Maintain a set of
  // chat ids currently streaming, and refresh the recent-chats list when a
  // stream completes so titles + ordering stay fresh in real time.
  useEffect(() => {
    const unsubscribe = ipc.chat.subscribeToActiveStreams((payload) => {
      setStreamingChatIds((prev) => {
        const next = new Set(payload.active.map((s) => s.chatId));
        // If something dropped (a stream ended), refresh recent chats.
        for (const id of prev) {
          if (!next.has(id)) {
            void refreshRecentChats();
            break;
          }
        }
        return next;
      });
    });
    return unsubscribe;
  }, [refreshRecentChats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowPalette((v) => !v);
      } else if (e.key === 'Escape' && showPalette) {
        setShowPalette(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPalette]);

  useEffect(() => {
    document.title =
      view.kind === 'chat'
        ? `Flowstate — ${view.agent.name}`
        : view.kind === 'settings'
          ? 'Flowstate — Settings'
          : 'Flowstate';
  }, [view]);

  const openChat = (agent: AgentDto, chatId?: string): void => {
    setView({ kind: 'chat', agent, ...(chatId ? { openChatId: chatId } : {}) });
  };

  const onChatActivity = useCallback(() => {
    void refreshRecentChats();
  }, [refreshRecentChats]);

  const subtitle =
    view.kind === 'chat'
      ? view.agent.name
      : view.kind === 'dashboard'
        ? 'Dashboard'
        : view.kind === 'models'
          ? 'Models'
          : view.kind === 'brain'
            ? 'Brain'
            : view.kind === 'connectors'
              ? 'Connectors'
              : view.kind === 'coding-clis'
                ? 'Coding CLIs'
              : view.kind === 'plugins'
                ? 'Plugins'
                : view.kind === 'routines'
                ? 'Routines'
                : view.kind === 'flowclaw'
                  ? 'Flowclaw'
                  : view.kind === 'business'
                    ? 'Business'
                    : view.kind === 'stocks'
                      ? 'Trading'
                      : 'Settings';

  return (
    <div className="app-window flex flex-col h-full">
      <div className="app-bg" />
      <TitleBar subtitle={subtitle} />
      <div
        className={'app-shell flex-1 min-h-0 ' + (popoutParams ? 'popout-shell' : '')}
        style={popoutParams ? { gridTemplateColumns: '1fr' } : undefined}
      >
      {popoutParams ? null : (
      <aside className="sidebar glass">
        <div className="brand-row" style={{ paddingTop: 14 }}>
          <span style={{ color: 'var(--ink-strong)' }}>
            <BrandMark size={18} state={liveAgentIds.length > 0 ? 'streaming' : 'idle'} />
          </span>
          <span className="brand-name">Flowstate</span>
        </div>

        <div className="sidebar-section">
          <NavRow
            label="Dashboard"
            active={view.kind === 'dashboard'}
            onClick={() => setView({ kind: 'dashboard' })}
            icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><rect x="2" y="2" width="5" height="6" rx="1" stroke="currentColor"/><rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor"/><rect x="9" y="7" width="5" height="7" rx="1" stroke="currentColor"/><rect x="2" y="10" width="5" height="4" rx="1" stroke="currentColor"/></svg>}
          />
          {prefs.hiddenNav.includes('business') ? null : (
            <NavRow
              label="Business"
              active={view.kind === 'business'}
              onClick={() => setView({ kind: 'business' })}
              icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><path d="M2 6h12v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6Z" stroke="currentColor" strokeLinejoin="round"/><path d="M5.5 6V4a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0110.5 4v2 M2 9.5h12" stroke="currentColor"/></svg>}
            />
          )}
          {prefs.hiddenNav.includes('stocks') ? null : (
            <NavRow
              label="Trading"
              active={view.kind === 'stocks'}
              onClick={() => setView({ kind: 'stocks' })}
              icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><path d="M2 11l3.5-4 2.5 2.5L13 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 4h3v3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            />
          )}
          {prefs.hiddenNav.includes('models') ? null : (
            <NavRow
              label="Models"
              active={view.kind === 'models'}
              onClick={() => setView({ kind: 'models' })}
              icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><circle cx="8" cy="8" r="2.5" stroke="currentColor"/><circle cx="8" cy="8" r="6" stroke="currentColor" opacity="0.5"/></svg>}
            />
          )}
          {prefs.hiddenNav.includes('brain') ? null : (
            <NavRow
              label="Brain"
              active={view.kind === 'brain'}
              onClick={() => setView({ kind: 'brain' })}
              icon={<img src={brainIcon} className="icon" alt="" style={{ width: 16, height: 16, objectFit: 'contain', opacity: 0.85 }} />}
            />
          )}
          {prefs.hiddenNav.includes('connectors') ? null : (
            <NavRow
              label="Connectors"
              active={view.kind === 'connectors'}
              onClick={() => setView({ kind: 'connectors' })}
              icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><rect x="2" y="6" width="4" height="4" rx="1" stroke="currentColor"/><rect x="10" y="6" width="4" height="4" rx="1" stroke="currentColor"/><line x1="6" y1="8" x2="10" y2="8" stroke="currentColor"/></svg>}
            />
          )}
          <NavRow
            label="Coding CLIs"
            active={view.kind === 'coding-clis'}
            onClick={() => setView({ kind: 'coding-clis' })}
            icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor"/><path d="M4.5 6.5l2 1.5-2 1.5M8 9.5h3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          />
          {prefs.hiddenNav.includes('plugins') ? null : (
            <NavRow
              label="Plugins"
              active={view.kind === 'plugins'}
              onClick={() => setView({ kind: 'plugins' })}
              icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><path d="M5 2v3 M11 2v3 M3.5 5h9v3a4.5 4.5 0 01-9 0V5Z M8 12.5V14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            />
          )}
          {prefs.hiddenNav.includes('flowclaw') ? null : (
            <NavRow
              label="Flowclaw"
              active={view.kind === 'flowclaw'}
              onClick={() => setView({ kind: 'flowclaw' })}
              icon={<img src={flowclawIconV3} className="icon" alt="" style={{ width: 16, height: 16, objectFit: 'contain', opacity: 0.85 }} />}
            />
          )}
          <NavRow
            label="Routines"
            active={view.kind === 'routines'}
            onClick={() => setView({ kind: 'routines' })}
            icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><circle cx="8" cy="8" r="6" stroke="currentColor"/><path d="M8 4.5V8l2.5 1.5" stroke="currentColor"/></svg>}
          />
          <NavRow
            label="Settings"
            active={view.kind === 'settings'}
            onClick={() => setView({ kind: 'settings' })}
            icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><path d="M8 2 9.65 4.03 12.24 3.76 11.97 6.35 14 8 11.97 9.65 12.24 12.24 9.65 11.97 8 14 6.35 11.97 3.76 12.24 4.03 9.65 2 8 4.03 6.35 3.76 3.76 6.35 4.03Z" stroke="currentColor" strokeLinejoin="round"/><circle cx="8" cy="8" r="2.1" stroke="currentColor"/></svg>}
          />
          <NavRow
            label="Customize"
            active={false}
            onClick={() => setCustomizeOpen(true)}
            icon={<svg viewBox="0 0 16 16" fill="none" className="icon"><path d="M2 4h6 M10 4h4 M2 8h2 M6 8h8 M2 12h10 M14 12h0" stroke="currentColor"/><circle cx="9" cy="4" r="1.6" stroke="currentColor" fill="var(--bg)"/><circle cx="5" cy="8" r="1.6" stroke="currentColor" fill="var(--bg)"/><circle cx="13" cy="12" r="1.6" stroke="currentColor" fill="var(--bg)"/></svg>}
          />
        </div>

        {prefs.sidebar.sessions ? (
        <ChatHistory
          chats={recentChats}
          agents={agents}
          activeChatId={view.kind === 'chat' ? view.openChatId ?? null : null}
          streamingChatIds={streamingChatIds}
          onOpenChat={openChat}
          onNewSession={async () => {
            // Always land in the session UI. Pick agent: current chat agent
            // first, else first available agent.
            const targetAgent: AgentDto | undefined =
              view.kind === 'chat' ? view.agent : agents[0];
            if (targetAgent) {
              try {
                const { chat } = await ipc.chat.createChat(targetAgent.id);
                openChat(targetAgent, chat.id);
                await refreshRecentChats();
                return;
              } catch {
                // fall through
              }
            }
            // No agents yet — send to dashboard so user can route via composer.
            setDashboardKey((k) => k + 1);
            setView({ kind: 'dashboard' });
          }}
          onChatsChanged={async () => {
            // Refresh first, then check whether the active session still
            // exists. If the user deleted the chat we're viewing, bounce
            // back to the dashboard so they don't sit on a stale session.
            const deletedActive =
              view.kind === 'chat' && view.openChatId
                ? !recentChats.some((c) => c.id === view.openChatId)
                : false;
            try {
              const { chats } = await ipc.chat.listRecentChats(50);
              setRecentChats(chats);
              if (deletedActive || (view.kind === 'chat' && view.openChatId && !chats.some((c) => c.id === view.openChatId))) {
                setDashboardKey((k) => k + 1);
                setView({ kind: 'dashboard' });
              }
            } catch {
              // best-effort
            }
          }}
        />
        ) : null}

        <AgentPackRow agents={agents} onImported={() => void refreshAgents()} />

        <div className="sidebar-footer">
          {ollamaReachable === false ? (
            <button
              type="button"
              disabled={ollamaStarting}
              onClick={() => void startOllama()}
              className="btn btn-sm btn-primary"
            >
              {ollamaStarting ? 'Starting…' : 'Start Ollama'}
            </button>
          ) : (
            <span className={'pill ' + (ollamaReachable ? 'good' : ollamaReachable === null ? 'streaming' : 'bad')}>
              <span className="dot" />
              <span>
                {ollamaReachable === null ? 'Connecting…' : ollamaReachable ? 'Ollama · ready' : 'Ollama · off'}
              </span>
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--ink-faint)' }}>
            {agents.length} agent{agents.length === 1 ? '' : 's'}
          </span>
        </div>
        {ollamaStartError ? (
          <div className="px-3 pb-2 text-[10px] text-[var(--bad)] leading-snug">{ollamaStartError}</div>
        ) : null}
      </aside>
      )}

      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={view.kind === 'chat' ? `chat:${view.agent.id}:${view.openChatId ?? 'default'}` : view.kind}
            className="h-full"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={TRANSITION_DEFAULT}
          >
            {view.kind === 'settings' ? (
              <Settings />
            ) : view.kind === 'models' ? (
              <Models />
            ) : view.kind === 'brain' ? (
              <Brain />
            ) : view.kind === 'connectors' ? (
              <Connectors />
            ) : view.kind === 'coding-clis' ? (
              <CodingClis />
            ) : view.kind === 'plugins' ? (
              <Plugins />
            ) : view.kind === 'routines' ? (
              <Routines agents={agents} onOpenChat={openChat} />
            ) : view.kind === 'flowclaw' ? (
              <Flowclaw
                agents={agents}
                onOpenChat={openChat}
                onGoRoutines={() => setView({ kind: 'routines' })}
              />
            ) : view.kind === 'business' ? (
              <Business />
            ) : view.kind === 'stocks' ? (
              <Stocks />
            ) : view.kind === 'dashboard' ? (
              <Dashboard
                key={`dash-${dashboardKey}`}
                agents={agents}
                onOpenChat={(agent) => openChat(agent)}
                onAgentsChanged={() => void refreshAgents()}
                onRouted={handleRouted}
                onTeamRun={() => {
                  // Legacy hook — team mode now routes through the regular
                  // solo flow + chat session. The modal is no longer used.
                  setTeamPrompt(null);
                }}
              />
            ) : (
              <Chat
                agent={view.agent}
                openChatId={view.openChatId ?? null}
                onChatActivity={onChatActivity}
                onNav={(target) => setView({ kind: target })}
                pendingChat={
                  pendingChat
                    ? {
                        chatId: pendingChat.chatId,
                        firstMessage: pendingChat.firstMessage,
                        onConsumed: () => setPendingChat(null),
                      }
                    : null
                }
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
      </div>

      <AnimatePresence>
        {showPalette ? (
          <CommandPalette
            key="palette"
            agents={agents}
            onClose={() => setShowPalette(false)}
            onOpenSettings={() => setView({ kind: 'settings' })}
            onOpenDashboard={() => setView({ kind: 'dashboard' })}
            onOpenAgent={(a) => openChat(a)}
          />
        ) : null}
        {toast ? (
          <RoutingToast key="toast" info={toast} onDismiss={() => setToast(null)} />
        ) : null}
        {teamPrompt ? (
          <TeamRunModal
            key="team-run"
            prompt={teamPrompt}
            agents={agents}
            onClose={() => setTeamPrompt(null)}
            onSessionCreated={async (agentId, chatId) => {
              setTeamPrompt(null);
              const fresh = await refreshAgents();
              await refreshRecentChats();
              const agent = fresh.find((a) => a.id === agentId) ?? agents.find((a) => a.id === agentId);
              if (agent) {
                openChat(agent, chatId);
              } else {
                // fallback: still route to chat shell so user sees session even if
                // agent metadata not yet fetched
                openChat(
                  {
                    id: agentId,
                    name: 'Team session',
                    description: '',
                    specialtyTags: [],
                    avatarColor: '#a09a8e',
                    systemPrompt: '',
                    model: '',
                    workspacePath: '',
                    toolPerms: { shell_enabled: false, delete_enabled: false },
                    approvalPolicy: 'cautious',
                    createdAt: 0,
                    updatedAt: 0,
                  },
                  chatId,
                );
              }
            }}
          />
        ) : null}
        {showShortcuts ? (
          <ShortcutsModal
            key="shortcuts"
            onClose={() => setShowShortcuts(false)}
            onDismissPreference={(dontShow) => {
              if (dontShow) {
                void ipc.settings.set('seen_shortcuts_intro', 'true');
              }
            }}
          />
        ) : null}
        {missingModels && missingModels.length > 0 ? (
          <ModelPullerModal
            key="model-puller"
            models={missingModels}
            onClose={() => setMissingModels(null)}
          />
        ) : null}
      </AnimatePresence>

      <MascotLayer
        agents={agents}
        screen={view.kind}
        liveAgentIds={liveAgentIds}
        disabled={!prefs.mascots}
      />

      <StatusBar
        agents={agents}
        liveCount={liveAgentIds.length}
        ollamaReachable={ollamaReachable}
      />
      <OnboardingTour />
      <ClisOnboardingModal />

      <CustomizeDrawer open={customizeOpen} onClose={() => setCustomizeOpen(false)} />
    </div>
  );
}

function StatusBar({
  agents,
  liveCount,
  ollamaReachable,
}: {
  agents: AgentDto[];
  liveCount: number;
  ollamaReachable: boolean | null;
}): JSX.Element | null {
  // Floating, click-through. Hidden by default unless live activity. Stays
  // out of the way; reveals on hover via opacity (CSS).
  if (liveCount === 0 && ollamaReachable !== false) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 4,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 36,
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          padding: '4px 12px',
          borderRadius: 999,
          background: 'rgba(20,17,14,0.85)',
          border: '1px solid var(--border)',
          color: 'var(--ink-muted)',
          fontFamily: 'JetBrains Mono, ui-monospace, monospace',
          fontSize: 10.5,
          letterSpacing: '0.04em',
          backdropFilter: 'blur(8px)',
        }}
      >
        {liveCount > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="dot dot-good dot-pulse" />
            <span>
              {liveCount} agent{liveCount === 1 ? '' : 's'} streaming
            </span>
          </span>
        ) : null}
        {ollamaReachable === false ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--bad)' }}>
            <span className="dot dot-bad" />
            <span>Ollama offline</span>
          </span>
        ) : null}
        <span style={{ color: 'var(--ink-faint)' }}>
          {agents.length} agent{agents.length === 1 ? '' : 's'} loaded
        </span>
      </div>
    </div>
  );
}

function NavRow({
  label,
  active,
  onClick,
  icon,
  lock,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
  lock?: JSX.Element | null;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={'nav-row w-full text-left ' + (active ? 'active' : '') + (lock ? ' nav-row-locked' : '')}
    >
      {icon}
      <span>{label}</span>
      {lock ? <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{lock}</span> : null}
    </button>
  );
}
