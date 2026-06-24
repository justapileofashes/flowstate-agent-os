import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { ipc } from '../lib/ipc';
import { modalBackdrop, modalPanel, fadeUp, staggerContainer } from '../lib/motion';
import { AgentAvatar } from '../lib/agent-icons';
import { BrandMark } from '../lib/brand-mark';
import type { TeamEventDto, TeamPlanDto, TeamPlanTaskDto } from '@shared/ipc-channels';
import type { AgentDto } from '@shared/chat-types';

interface Props {
  prompt: string;
  agents: AgentDto[];
  onClose: () => void;
  /** Called when the team run completes successfully + a chat session has
   *  been persisted under the synthesizer. Use to navigate the main view. */
  onSessionCreated?: (agentId: string, chatId: string) => void;
}

function fakeAgent(
  id: string,
  name: string,
  color: string,
  full: AgentDto | undefined,
): AgentDto {
  if (full) return full;
  return {
    id,
    name,
    description: '',
    specialtyTags: [],
    avatarColor: color,
    systemPrompt: '',
    model: '',
    workspacePath: '',
    toolPerms: { shell_enabled: false, delete_enabled: false },
    approvalPolicy: 'cautious',
    createdAt: 0,
    updatedAt: 0,
  };
}

interface NudgeRecord {
  id: number;
  text: string;
  interrupted: boolean;
}

interface TaskState {
  status: 'pending' | 'running' | 'done' | 'failed';
  text: string;
  tools: string[];
  iteration: number;
  nudges: NudgeRecord[];
  error?: string;
}

type Phase =
  | { kind: 'planning' }
  | { kind: 'running' }
  | { kind: 'synthesizing' }
  | { kind: 'done' }
  | { kind: 'aborted' }
  | { kind: 'error'; message: string };

interface RunHandle {
  runId: string;
  abort: () => void;
  nudge: (taskId: string, text: string, interrupt: boolean) => Promise<boolean>;
}

export function TeamRunModal({ prompt, agents, onClose, onSessionCreated }: Props): JSX.Element {
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const resolveAgent = (t: TeamPlanTaskDto | { agentId: string; agentName: string; agentColor: string }): AgentDto =>
    fakeAgent(t.agentId, t.agentName, t.agentColor, agentMap.get(t.agentId));
  const [phase, setPhase] = useState<Phase>({ kind: 'planning' });
  const [plan, setPlan] = useState<TeamPlanDto | null>(null);
  const [tasks, setTasks] = useState<Record<string, TaskState>>({});
  const [synthesis, setSynthesis] = useState('');
  const handleRef = useRef<RunHandle | null>(null);
  const nudgeIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const handle = await ipc.chat.teamRun(
        prompt,
        (e: TeamEventDto) => {
          if (cancelled) return;
          handleEvent(e);
        },
        () => {},
      );
      // If unmount happened before teamRun resolved, abort post-hoc so the
      // backend run does not orphan.
      if (cancelled) {
        handle.abort();
        return;
      }
      handleRef.current = handle;
    })();
    return () => {
      cancelled = true;
      handleRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  // Esc closes (also aborts via cleanup).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Auto-scroll synthesis card as text streams in.
  const synthRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.scrollTop = synthRef.current.scrollHeight;
    }
  }, [synthesis]);

  function handleEvent(e: TeamEventDto): void {
    switch (e.type) {
      case 'plan': {
        setPlan(e.plan);
        setTasks(
          Object.fromEntries(
            e.plan.tasks.map((t) => [
              t.id,
              {
                status: 'pending' as const,
                text: '',
                tools: [],
                iteration: 0,
                nudges: [],
              },
            ]),
          ),
        );
        setPhase({ kind: 'running' });
        break;
      }
      case 'task-start':
        setTasks((m) => ({
          ...m,
          [e.taskId]: {
            ...(m[e.taskId] ?? { status: 'pending', text: '', tools: [], iteration: 0, nudges: [] }),
            status: 'running',
          },
        }));
        break;
      case 'task-iteration':
        setTasks((m) => {
          const cur = m[e.taskId];
          if (!cur) return m;
          return { ...m, [e.taskId]: { ...cur, iteration: e.iteration + 1 } };
        });
        break;
      case 'task-text':
        setTasks((m) => {
          const cur = m[e.taskId] ?? {
            status: 'running' as const,
            text: '',
            tools: [],
            iteration: 1,
            nudges: [],
          };
          return { ...m, [e.taskId]: { ...cur, text: cur.text + e.delta } };
        });
        break;
      case 'task-tool':
        setTasks((m) => {
          const cur = m[e.taskId] ?? {
            status: 'running' as const,
            text: '',
            tools: [],
            iteration: 1,
            nudges: [],
          };
          return { ...m, [e.taskId]: { ...cur, tools: [...cur.tools, e.toolName] } };
        });
        break;
      case 'task-nudge-applied':
        setTasks((m) => {
          const cur = m[e.taskId];
          if (!cur) return m;
          nudgeIdRef.current += 1;
          return {
            ...m,
            [e.taskId]: {
              ...cur,
              nudges: [
                ...cur.nudges,
                { id: nudgeIdRef.current, text: e.nudge, interrupted: e.interrupted },
              ],
            },
          };
        });
        break;
      case 'task-done':
        setTasks((m) => {
          const cur = m[e.taskId] ?? {
            status: 'done' as const,
            text: '',
            tools: [],
            iteration: 1,
            nudges: [],
          };
          return {
            ...m,
            [e.taskId]: {
              ...cur,
              status: e.ok ? 'done' : 'failed',
              text: e.output || cur.text,
              ...(e.error ? { error: e.error } : {}),
            },
          };
        });
        break;
      case 'synthesis-start':
        setPhase({ kind: 'synthesizing' });
        break;
      case 'synthesis-text':
        setSynthesis((s) => s + e.delta);
        break;
      case 'run-end':
        if (e.reason === 'ok') {
          setPhase({ kind: 'done' });
          if (e.chatId && e.agentId && onSessionCreated) {
            // Navigate to the new session — closes the modal automatically
            // because App clears teamPrompt when openChat is called.
            onSessionCreated(e.agentId, e.chatId);
          }
        } else if (e.reason === 'aborted') setPhase({ kind: 'aborted' });
        else setPhase({ kind: 'error', message: e.error ?? 'unknown error' });
        break;
    }
  }

  const isRunning =
    phase.kind === 'planning' || phase.kind === 'running' || phase.kind === 'synthesizing';

  return (
    <motion.div
      className="modal-backdrop"
      variants={modalBackdrop}
      initial="hidden"
      animate="visible"
      exit="exit"
      onClick={onClose}
      style={{ position: 'fixed', overflowY: 'auto', alignItems: 'flex-start', padding: 24 }}
    >
      <motion.div
        className="modal card"
        variants={modalPanel}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 880, width: '100%' }}
      >
        <header className="modal-head">
          <span className="w-7 h-7 flex items-center justify-center text-[var(--accent)]">
            <BrandMark
              size={24}
              state={
                phase.kind === 'planning' || phase.kind === 'synthesizing'
                  ? 'tool'
                  : phase.kind === 'running'
                    ? 'streaming'
                    : phase.kind === 'done'
                      ? 'idle'
                      : 'static'
              }
            />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold tracking-tight">Team run</h2>
            <p className="text-xs text-[var(--ink-muted)] truncate">{prompt}</p>
          </div>
          <PhaseBadge phase={phase} />
          <button
            type="button"
            className="btn"
            onClick={isRunning ? () => handleRef.current?.abort() : onClose}
          >
            {isRunning ? 'Stop' : 'Close'}
          </button>
        </header>

        <div className="modal-body" style={{ maxHeight: '75vh' }}>
          {phase.kind === 'planning' && (
            <div className="flex items-center gap-3 text-sm text-[var(--ink-muted)]">
              <span className="dot dot-good dot-pulse" /> Planner is decomposing the task…
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="rounded-md border border-[var(--bad)]/40 bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad)]">
              {phase.message}
            </div>
          )}

          {plan && (
            <>
              <div className="mb-4">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold mb-1">
                  Plan
                </div>
                <p className="text-sm text-[var(--ink-muted)]">{plan.summary}</p>
              </div>

              <motion.div
                className="task-grid"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {plan.tasks.map((t) => {
                  const s = tasks[t.id];
                  const status = s?.status ?? 'pending';
                  const canNudge = status === 'pending' || status === 'running';
                  return (
                    <motion.div key={t.id} variants={fadeUp} className="task-card">
                      <div className="flex items-center gap-2 mb-2">
                        <AgentAvatar agent={resolveAgent(t)} size={26} rounded="md" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{t.agentName}</div>
                        </div>
                        {s && s.iteration > 0 && (
                          <span className="kbd text-[10px]" title="Autonomous iteration">
                            iter {s.iteration}
                          </span>
                        )}
                        <StatusBadge status={status} />
                      </div>
                      <p className="text-xs text-[var(--ink-muted)] line-clamp-3 mb-2">
                        {t.instruction}
                      </p>
                      {s && s.tools.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {s.tools.slice(-4).map((tn, i) => (
                            <span key={i} className="kbd text-[10px]">
                              {tn}
                            </span>
                          ))}
                        </div>
                      )}
                      {s && s.nudges.length > 0 && (
                        <div className="mb-2 space-y-1">
                          <AnimatePresence initial={false}>
                            {s.nudges.map((n) => (
                              <motion.div
                                key={n.id}
                                initial={{ opacity: 0, x: -6 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0 }}
                                className="text-[11px] flex items-start gap-1.5 rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2 py-1"
                              >
                                <span className="text-[var(--accent)] mt-0.5">↳</span>
                                <span className="text-[var(--ink)] flex-1">{n.text}</span>
                                {n.interrupted && (
                                  <span className="kbd text-[9px]">interrupt</span>
                                )}
                              </motion.div>
                            ))}
                          </AnimatePresence>
                        </div>
                      )}
                      {s && s.text.length > 0 && (
                        <div className="markdown text-xs max-h-32 overflow-y-auto border-t border-[var(--border)] pt-2 text-[var(--ink-muted)]">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                            {s.text}
                          </ReactMarkdown>
                        </div>
                      )}
                      {s?.error && (
                        <div className="mt-2 text-xs text-[var(--bad)]">{s.error}</div>
                      )}
                      {canNudge && (
                        <NudgeBar
                          onSend={async (text, interrupt) => {
                            await handleRef.current?.nudge(t.id, text, interrupt);
                          }}
                        />
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>

              {(phase.kind === 'synthesizing' || synthesis.length > 0 || phase.kind === 'done') && (
                <motion.div
                  className="card mt-5"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <AgentAvatar
                      agent={resolveAgent({
                        agentId: plan.synthesizerAgentId,
                        agentName: plan.synthesizerAgentName,
                        agentColor: plan.synthesizerAgentColor,
                      })}
                      size={26}
                      rounded="md"
                    />
                    <div className="text-sm font-semibold">{plan.synthesizerAgentName}</div>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--ink-faint)] font-semibold">
                      Synthesizer
                    </span>
                    {phase.kind === 'synthesizing' && (
                      <span className="dot dot-good dot-pulse ml-auto" />
                    )}
                  </div>
                  <div ref={synthRef} className="markdown text-sm max-h-[40vh] overflow-y-auto">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                      {synthesis || '_Waiting for synthesis…_'}
                    </ReactMarkdown>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function NudgeBar({
  onSend,
}: {
  onSend: (text: string, interrupt: boolean) => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  async function send(interrupt: boolean): Promise<void> {
    const t = text.trim();
    if (t.length === 0 || sending) return;
    setSending(true);
    try {
      await onSend(t, interrupt);
      setText('');
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void send(e.shiftKey);
    }
  }

  return (
    <div className="mt-2 pt-2 border-t border-[var(--border)] flex items-center gap-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Send update…"
        disabled={sending}
        className="field text-xs py-1.5"
      />
      <button
        type="button"
        className="btn px-2 py-1 text-xs"
        onClick={() => void send(false)}
        disabled={sending || text.trim().length === 0}
        title="Queue update — applied at next iteration"
      >
        Send
      </button>
      <button
        type="button"
        className="btn btn-primary px-2 py-1 text-xs"
        onClick={() => void send(true)}
        disabled={sending || text.trim().length === 0}
        title="Interrupt current turn and apply update immediately"
      >
        ⚡
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: TaskState['status'] }): JSX.Element {
  if (status === 'pending') {
    return <span className="text-[10px] text-[var(--ink-faint)]">queued</span>;
  }
  if (status === 'running') {
    return (
      <span className="pill pill-good text-[10px]">
        <span className="dot dot-good dot-pulse" /> running
      </span>
    );
  }
  if (status === 'failed') {
    return <span className="pill pill-bad text-[10px]">failed</span>;
  }
  return <span className="pill pill-good text-[10px]">done</span>;
}

function PhaseBadge({ phase }: { phase: Phase }): JSX.Element {
  const label =
    phase.kind === 'planning'
      ? 'planning…'
      : phase.kind === 'running'
        ? 'team working'
        : phase.kind === 'synthesizing'
          ? 'synthesizing…'
          : phase.kind === 'done'
            ? 'done'
            : phase.kind === 'aborted'
              ? 'aborted'
              : 'error';
  return <span className="kbd">{label}</span>;
}
