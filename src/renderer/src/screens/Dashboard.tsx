import { useMemo, useState } from 'react';
import type { AgentDto } from '@shared/chat-types';
import { useAgentLiveStatus } from '../chat/useAgentLiveStatus';
import { GlobalAskBox } from '../chat/GlobalAskBox';
import { ResourceMeters } from '../chat/ResourceMeters';
import { CompareModal } from '../chat/CompareModal';
import { useCustomizePrefs } from '../lib/CustomizeContext';
import type { DashboardSectionId } from '../lib/customize';
import { ipc } from '../lib/ipc';

interface Props {
  agents: AgentDto[];
  onOpenChat: (agent: AgentDto) => void;
  onAgentsChanged: () => void;
  onRouted: (
    agentId: string,
    chatId: string,
    text: string,
    reasoning: string,
    fallback: boolean,
    swarm?: string[],
    team?: boolean,
  ) => void;
  onTeamRun: (text: string) => void;
}

function dateLabel(): string {
  const d = new Date();
  const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${wk} · ${mo} ${d.getDate()}`;
}

function greetingForNow(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Late night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

export function Dashboard({
  agents,
  onOpenChat,
  onRouted,
  onTeamRun,
}: Props): JSX.Element {
  const liveStatus = useAgentLiveStatus();
  const activeCount = Array.from(liveStatus.values()).filter((s) => s === 'streaming').length;
  const greeting = useMemo(greetingForNow, []);
  const eyebrow = useMemo(
    () => `${dateLabel()} · ${agents.length} ${agents.length === 1 ? 'specialist' : 'specialists'}${activeCount > 0 ? ` · ${activeCount} streaming` : ''}`,
    [agents.length, activeCount],
  );
  const prefs = useCustomizePrefs();
  const liveAgents = agents.filter((a) => liveStatus.has(a.id));
  const [compareOpen, setCompareOpen] = useState(false);

  const renderSection = (id: DashboardSectionId): JSX.Element | null => {
    switch (id) {
      case 'hero':
        return (
          <div className="hero" key="hero">
            <div className="eyebrow" style={{ marginBottom: 14 }}>{eyebrow}</div>
            <h1>
              {greeting}. <span className="muted">What are we making?</span>
            </h1>
          </div>
        );
      case 'composer':
        return (
          <div key="composer">
            <div style={{ margin: '24px 48px 0' }}>
              <GlobalAskBox onRouted={onRouted} onTeamRun={onTeamRun} />
              <SmartChips onRouted={onRouted} />
            </div>
            {/* Surface 3 — always-on system meters: what local models cost the machine. */}
            <ResourceMeters />
            <div style={{ margin: '14px 48px 0' }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCompareOpen(true)}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                  <rect x="1.5" y="2" width="4.5" height="10" rx="1" stroke="currentColor" />
                  <rect x="8" y="2" width="4.5" height="10" rx="1" stroke="currentColor" />
                </svg>
                <span>Compare agents</span>
              </button>
            </div>
            {compareOpen ? (
              <CompareModal agents={agents} onClose={() => setCompareOpen(false)} onOpenChat={(agentId) => {
                const a = agents.find((x) => x.id === agentId);
                if (a) { setCompareOpen(false); onOpenChat(a); }
              }} />
            ) : null}
          </div>
        );
      case 'streaming':
        if (liveAgents.length === 0) return null;
        return (
          <div style={{ margin: '24px 48px 0' }} key="streaming">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Streaming now</div>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              {liveAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="pill streaming"
                  onClick={() => onOpenChat(a)}
                  style={{ cursor: 'pointer', height: 28, padding: '0 12px' }}
                  title={`Open ${a.name}`}
                >
                  <span className="dot" />
                  <span>{a.name}</span>
                </button>
              ))}
            </div>
          </div>
        );
      case 'recent':
        return (
          <div style={{ margin: '24px 48px 0' }} key="recent">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Specialists</div>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              {agents.slice(0, 12).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => onOpenChat(a)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="screen-enter h-full overflow-y-auto"
      style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingTop: 24, paddingBottom: 24 }}
    >
      {prefs.dashboardSections
        .filter((s) => s.visible)
        .map((s) => renderSection(s.id))}
    </div>
  );
}

/** Suggestion chips below the composer — quick prompts that route through
 *  the orchestrator on click so the user gets to a session in one tap. */
function SmartChips({
  onRouted,
}: {
  onRouted: (
    agentId: string,
    chatId: string,
    text: string,
    reasoning: string,
    fallback: boolean,
    swarm?: string[],
    team?: boolean,
  ) => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const SUGGESTIONS = [
    { label: 'Explain a codebase', prompt: 'Walk me through the architecture of this repo.' },
    { label: 'Research a topic', prompt: 'Research the latest developments in ' },
    { label: 'Draft a blog post', prompt: 'Draft a short blog post about ' },
    { label: 'Debug an error', prompt: 'I am hitting this error — help me fix it: ' },
    { label: 'Plan a sprint', prompt: 'Plan a one-week sprint to ship ' },
    { label: 'Review my code', prompt: 'Review this code for bugs + style: ' },
  ];

  async function pick(prompt: string): Promise<void> {
    if (busy) return;
    setBusy(prompt);
    try {
      const res = await ipc.chat.route(prompt);
      onRouted(res.agentId, res.chatId, prompt, res.reasoning, res.fallback, res.swarm, res.team);
    } catch {
      // best-effort
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="row gap-2 mt-3" style={{ flexWrap: 'wrap' }}>
      {SUGGESTIONS.map((s) => (
        <button
          key={s.label}
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => void pick(s.prompt)}
          disabled={busy !== null}
        >
          {busy === s.prompt ? 'Routing…' : s.label}
        </button>
      ))}
    </div>
  );
}
