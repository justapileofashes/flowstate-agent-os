import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SLASH_COMMANDS, applySlashCommand, type NavTarget } from './slash-commands';
import { ipc } from '../lib/ipc';
import { ipcErrorMessage } from '../lib/ipc-error';
import { expandSnippet, snippetVars } from '../lib/snippets-client';
import { FillInModal, MentionChip, ConvChip } from './ComposerSurfaces';
import type { AgentDto } from '@shared/chat-types';
import type {
  PromptPreflightResponse,
  SnippetDto,
  UserCommandDto,
  BudgetEvaluateResponse,
} from '@shared/ipc-channels';

const kTok = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Props {
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onNav?: (target: NavTarget) => void;
  agent?: AgentDto;
  chatId?: string;
  /** The folder this chat works in (per-chat override or the agent's). */
  workspacePath?: string;
}

export function Composer({
  disabled,
  streaming,
  onSend,
  onStop,
  onNav,
  agent,
  chatId,
  workspacePath,
}: Props): JSX.Element {
  const [value, setValue] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const recognitionRef = useRef<unknown>(null);

  // Surface 6 — token preflight: a cheap estimate shown in the bar, debounced.
  const [pf, setPf] = useState<PromptPreflightResponse | null>(null);
  // Surface 9 — composer prompt history (shell-style ArrowUp/ArrowDown recall).
  const [history, setHistory] = useState<string[]>([]);
  const histIdx = useRef(-1);
  const stash = useRef('');

  // Surfaces 1/2/4/5/3 — snippets, custom commands, files, conventions, budget.
  const [snippets, setSnippets] = useState<SnippetDto[]>([]);
  const [commands, setCommands] = useState<UserCommandDto[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [mentions, setMentions] = useState<{ paths: string[]; contextBlock: string }>({ paths: [], contextBlock: '' });
  const [conv, setConv] = useState<{ files: string[]; preamble: string }>({ files: [], preamble: '' });
  const [budget, setBudget] = useState<BudgetEvaluateResponse>({ level: 'ok' });
  const [fill, setFill] = useState<{ snippet: SnippetDto; start: number; end: number } | null>(null);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    void ipc.devtools.getHistory().then((r) => setHistory(r.history));
    void ipc.devtools.listSnippets().then((r) => setSnippets(r.snippets));
    void ipc.devtools.listCommands().then((r) => setCommands(r.commands));
  }, []);

  const workspace = workspacePath || agent?.workspacePath;
  useEffect(() => {
    if (!agent || !workspace) return;
    void ipc.files.list(workspace).then((r) => setFiles(r.entries.filter((e) => e.kind === 'file').map((e) => e.name))).catch(() => {});
    void ipc.devtools.loadProjectContext(agent.id, chatId).then(setConv).catch(() => {});
  }, [agent, workspace, chatId]);

  useEffect(() => {
    void ipc.devtools.evaluateBudget(chatId).then(setBudget).catch(() => {});
  }, [chatId]);

  // Apply a programmatic caret position after a draft replacement.
  useEffect(() => {
    if (pendingCaret.current != null && textareaRef.current) {
      const p = pendingCaret.current;
      pendingCaret.current = null;
      textareaRef.current.focus();
      try { textareaRef.current.setSelectionRange(p, p); } catch { /* noop */ }
      setCaret(p);
    }
  }, [value]);

  // Debounced @mention resolution.
  useEffect(() => {
    if (!agent) return;
    const id = setTimeout(() => {
      if (!/(^|\s)@\S/.test(value)) { setMentions({ paths: [], contextBlock: '' }); return; }
      void ipc.devtools.resolveMentions(agent.id, value, chatId).then(setMentions).catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [value, agent, chatId]);

  useEffect(() => {
    if (value.trim().length === 0) {
      setPf(null);
      return;
    }
    const id = setTimeout(() => {
      const ctxChars = mentions.contextBlock.length + conv.preamble.length;
      void ipc.devtools.preflight(value, ctxChars, agent?.model).then(setPf).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [value, agent, mentions, conv]);

  // ----- trigger detection (text before caret) -----
  const upto = value.slice(0, caret);
  let trig: { kind: 'slash' | 'snip' | 'at'; q: string; start: number } | null = null;
  if (!dismissed && !value.includes('\n')) {
    let m: RegExpExecArray | null;
    if ((m = /(^|\s)\/(\w*)$/.exec(upto))) trig = { kind: 'slash', q: m[2]!, start: caret - m[2]!.length - 1 };
    else if ((m = /(^|\s):([\w-]*)$/.exec(upto))) trig = { kind: 'snip', q: m[2]!, start: caret - m[2]!.length - 1 };
    else if ((m = /(^|\s)@([^\s]*)$/.exec(upto))) trig = { kind: 'at', q: m[2]!, start: caret - m[2]!.length - 1 };
  }

  interface PopItem { key: string; token: string; hint: string; snippet?: SnippetDto; template?: string; custom?: boolean }
  const items: PopItem[] = (() => {
    if (!trig) return [];
    const q = trig.q.toLowerCase();
    if (trig.kind === 'slash') {
      const custom = commands.map((c) => ({ key: c.cmd, token: c.cmd, hint: c.label || c.hint, template: c.template, custom: true }));
      const built = SLASH_COMMANDS.map((c) => ({ key: c.cmd, token: c.cmd, hint: c.hint }));
      return [...custom, ...built].filter((x) => x.token.toLowerCase().startsWith('/' + q)).slice(0, 8);
    }
    if (trig.kind === 'snip') {
      return snippets
        .filter((s) => s.name.includes(q) || s.label.toLowerCase().includes(q))
        .map((s) => ({ key: s.id, token: ':' + s.name, hint: s.label, snippet: s }))
        .slice(0, 8);
    }
    return files
      .filter((f) => f.toLowerCase().includes(q))
      .map((f) => ({ key: f, token: f, hint: 'workspace' }))
      .slice(0, 9);
  })();

  useEffect(() => { setSel(0); }, [trig?.kind, trig?.q]);

  function insertAt(start: number, end: number, text: string): void {
    const next = value.slice(0, start) + text + value.slice(end);
    pendingCaret.current = start + text.length;
    setValue(next);
  }

  function pickItem(it: PopItem): void {
    if (!trig) return;
    if (trig.kind === 'slash') {
      if (it.custom && it.template) {
        const idx = it.template.indexOf('{{input}}');
        insertAt(trig.start, caret, it.template.replace('{{input}}', ''));
        if (idx >= 0) pendingCaret.current = trig.start + idx;
      } else {
        insertAt(trig.start, caret, it.token + ' ');
      }
    } else if (trig.kind === 'snip' && it.snippet) {
      if (snippetVars(it.snippet.body).length > 0) {
        setFill({ snippet: it.snippet, start: trig.start, end: caret });
        return;
      }
      insertAt(trig.start, caret, expandSnippet(it.snippet.body, {}) + ' ');
    } else {
      insertAt(trig.start, caret, '@' + it.token + ' ');
    }
  }

  function removeMention(p: string): void {
    const base = p.split('/').pop() ?? p;
    const next = value
      .replace(new RegExp('(^|\\s)@(' + escRe(p) + '|' + escRe(base) + ')(?=\\s|$)', 'g'), '$1')
      .replace(/[ \t]{2,}/g, ' ');
    setValue(next);
  }

  /** Voice dictation, push-to-talk: click the mic to record, click again to
   *  stop; the clip is transcribed by the speech-to-text backend set up for
   *  Capture (Flowclaw → Appliances), and the text appends to the composer.
   *  (Chromium's Web Speech API has no speech service inside Electron.) */
  async function toggleVoice(): Promise<void> {
    if (listening) {
      (recognitionRef.current as MediaRecorder | null)?.stop();
      return;
    }
    setVoiceNote(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceNote('Microphone unavailable or blocked.');
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      recognitionRef.current = null;
      void (async () => {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        setVoiceNote('Transcribing…');
        try {
          const r = await ipc.voice.transcribe(await blob.arrayBuffer(), blob.type);
          if (r.notConfigured) {
            setVoiceNote('Voice input needs a speech-to-text backend — set one up in Flowclaw → Appliances → Capture.');
          } else if (r.error) {
            setVoiceNote(`Transcription failed: ${r.error}`);
          } else {
            setVoiceNote(null);
            if (r.text) setValue((v) => (v && !v.endsWith(' ') ? v + ' ' : v) + r.text);
            textareaRef.current?.focus();
          }
        } catch (err) {
          setVoiceNote(`Transcription failed: ${ipcErrorMessage(err)}`);
        }
      })();
    };
    rec.start();
    recognitionRef.current = rec;
    setListening(true);
  }

  /** Image paste: when the user pastes a clipboard image, capture it as
   *  a base64 data URL + append a markdown reference to the message. The
   *  agent's vision-capable models pick up data URLs directly. */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((it) => it.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    for (const it of imageItems) {
      const file = it.getAsFile();
      if (!file) continue;
      const reader = new FileReader();
      reader.onload = () => {
        // Shown as a thumbnail above the composer; attached on send.
        setPastedImages((prev) => [...prev, String(reader.result)]);
      };
      reader.readAsDataURL(file);
    }
  }

  /** Drag-drop: when the user drops one or more files on the composer,
   *  append their absolute paths as a fenced reference block. The agent
   *  picks them up via its read_file tool. Electron's File object exposes
   *  `.path` (full absolute path) without renderer file-system access. */
  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const paths = files
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => typeof p === 'string' && p.length > 0);
    if (paths.length === 0) return;
    const block =
      (value.length > 0 ? value + '\n\n' : '') +
      'Attached files:\n' +
      paths.map((p) => `- ${p}`).join('\n');
    setValue(block);
    textareaRef.current?.focus();
  }

  useEffect(() => {
    if (!streaming) textareaRef.current?.focus();
  }, [streaming]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // Trigger popover navigation takes precedence.
    if (trig && items.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickItem(items[sel]!); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(true); return; }
    }
    // History recall — only when not in the middle of multi-line editing.
    if (e.key === 'ArrowUp' && (value === '' || histIdx.current >= 0) && history.length > 0) {
      if (histIdx.current === -1) stash.current = value;
      const ni = Math.min(histIdx.current + 1, history.length - 1);
      histIdx.current = ni;
      setValue(history[ni] ?? '');
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' && histIdx.current >= 0) {
      const ni = histIdx.current - 1;
      histIdx.current = ni;
      setValue(ni < 0 ? stash.current : (history[ni] ?? ''));
      e.preventDefault();
      return;
    }
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    submit();
  }

  function submit(): void {
    const trimmed = value.trim();
    if ((trimmed.length === 0 && pastedImages.length === 0) || streaming || disabled) return;
    if (budget.level === 'block') return; // hard cap — send disabled
    const { text, command } = applySlashCommand(trimmed);
    if (command?.nav && onNav) {
      onNav(command.nav);
      setValue('');
      setPastedImages([]);
      return;
    }
    // Pasted images ride along as markdown data URLs: the chat history shows
    // them, and the main process turns them into real image inputs for
    // Ollama vision models (other providers get a note instead of base64).
    // Prepend resolved @file context so the agent sees the file contents.
    const withCtx = mentions.contextBlock ? mentions.contextBlock + text : text;
    const payload =
      pastedImages.length > 0
        ? [withCtx, ...pastedImages.map((d, i) => `![image ${i + 1}](${d})`)].filter(Boolean).join('\n\n')
        : withCtx;
    onSend(payload);
    void ipc.devtools.pushHistory(trimmed).then((r) => setHistory(r.history)).catch(() => {});
    histIdx.current = -1;
    stash.current = '';
    setValue('');
    setPastedImages([]);
    setPf(null);
    setMentions({ paths: [], contextBlock: '' });
    void ipc.devtools.evaluateBudget(chatId).then(setBudget).catch(() => {});
  }

  const hasCtx = conv.files.length > 0 || mentions.paths.length > 0;
  const placeholder = streaming
    ? 'Streaming…'
    : `Message ${agent?.name ?? 'agent'}…  ( / commands · : snippets · @ files )`;

  return (
    <div
      className="composer-chat"
      style={dragOver ? { borderColor: 'var(--accent)' } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}>
      {hasCtx ? (
        <div className="dev-ctx-row">
          <ConvChip conv={conv} />
          {mentions.paths.map((p) => (
            <MentionChip key={p} path={p} onRemove={() => removeMention(p)} />
          ))}
        </div>
      ) : null}
      {budget.level === 'warn' ? (
        <div className="budget-note" role="note">
          <span className="pill"><span className="dot" /><span>budget</span></span>
          <span>{budget.message}</span>
        </div>
      ) : null}
      {budget.level === 'block' ? (
        <div className="budget-note block" role="alert">
          <span className="pill bad"><span className="dot" /><span>capped</span></span>
          <span>{budget.message}</span>
        </div>
      ) : null}
      {trig && items.length > 0 ? (
        <div
          className="dropdown glass dev-pop"
          style={{ top: 'auto', bottom: '100%', right: 'auto', left: 0, marginBottom: 8, minWidth: 320 }}
        >
          <div className="dev-pop-head">
            {trig.kind === 'slash' ? 'Commands' : trig.kind === 'snip' ? 'Snippets' : 'Workspace files'}
          </div>
          {items.map((it, i) => (
            <div
              key={it.key}
              className={'dropdown-item' + (i === sel ? ' sel' : '')}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => { e.preventDefault(); pickItem(it); }}
            >
              <span className="mono" style={{ color: 'var(--ink)' }}>{it.token}</span>
              <span style={{ color: 'var(--ink-faint)', marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>{it.hint}</span>
            </div>
          ))}
        </div>
      ) : null}
      {pastedImages.length > 0 ? (
        <div className="row gap-2 mb-2" style={{ flexWrap: 'wrap' }}>
          {pastedImages.map((src, i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                width: 56,
                height: 56,
                borderRadius: 6,
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}
            >
              <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ position: 'absolute', top: 1, right: 1, height: 16, padding: '0 4px', fontSize: 10 }}
                onClick={() => setPastedImages((prev) => prev.filter((_, j) => j !== i))}
                title="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => { setValue(e.target.value); setCaret(e.target.selectionStart); setDismissed(false); histIdx.current = -1; }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
        onClick={(e) => setCaret(e.currentTarget.selectionStart)}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onPaste={onPaste}
        placeholder={placeholder}
        disabled={disabled || streaming}
        rows={2}
      />
      <div className="composer-chat-bar">
        <button
          type="button"
          title="Slash commands"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            setValue('/');
            textareaRef.current?.focus();
          }}
        >
          /
        </button>
        <button
          type="button"
          title={listening ? 'Stop and transcribe' : 'Voice input (click to record, click again to stop)'}
          className={'btn btn-sm ' + (listening ? '' : 'btn-ghost')}
          onClick={() => void toggleVoice()}
          aria-pressed={listening}
        >
          {listening ? (
            <span className="dot dot-good dot-pulse" style={{ marginRight: 4 }} />
          ) : null}
          <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
            <rect x="4" y="2" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2 7v1a4 4 0 0 0 8 0V7 M6 12v1" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        {agent ? (
          <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            {agent.model}
          </span>
        ) : null}
        {pf ? (
          <span className="dev-counter mono" title={pf.message ?? 'Estimated tokens for this send'}>
            ~{kTok(pf.estTokens)}
            {pf.level === 'warn' || pf.level === 'over' ? (
              <span className={'dev-counter-flag ' + pf.level}>{pf.level === 'over' ? 'over limit' : 'near limit'}</span>
            ) : null}
          </span>
        ) : null}
        {history.length > 0 && value === '' ? (
          <span className="dev-hist-hint mono">↑ history</span>
        ) : null}
        {voiceNote ? (
          <span className="muted text-xs" role="status" style={{ maxWidth: 360 }}>
            {voiceNote}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        {streaming ? (
          <button type="button" onClick={onStop} className="btn btn-sm" aria-label="Stop">
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            className="btn btn-sm btn-primary"
            disabled={disabled || (value.trim().length === 0 && pastedImages.length === 0) || budget.level === 'block'}
          >
            Send
          </button>
        )}
      </div>
      {fill ? (
        <FillInModal
          snippet={fill.snippet}
          onCancel={() => setFill(null)}
          onInsert={(text) => { insertAt(fill.start, fill.end, text + ' '); setFill(null); }}
        />
      ) : null}
    </div>
  );
}
