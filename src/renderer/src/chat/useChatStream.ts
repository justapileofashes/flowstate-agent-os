import { useCallback, useEffect, useRef, useState } from 'react';
import { ipc } from '../lib/ipc';
import {
  emptyStreaming,
  mergeEvents,
  type AgentEventLike,
  type StreamingAssistant,
} from '../lib/chat-stream-helpers';
import type { MessageDto } from '@shared/chat-types';

export type StreamStatus = 'idle' | 'streaming' | 'aborted' | 'error' | 'max-tools';

export interface PendingApproval {
  toolCallId: string;
  toolName: string;
  args: unknown;
  cwd: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  total: number;
}

export interface UseChatStreamResult {
  messages: MessageDto[];
  streamingAssistant: StreamingAssistant | null;
  status: StreamStatus;
  pendingApproval: PendingApproval | null;
  tokens: TokenUsage;
  send: (text: string) => Promise<void>;
  abort: () => void;
  refresh: () => Promise<void>;
  respondApproval: (
    decision: 'allow-once' | 'allow-rest' | 'deny',
    reason?: string,
  ) => Promise<void>;
}

const FLUSH_INTERVAL_MS = 50;

export function useChatStream(chatId: string | null): UseChatStreamResult {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [streamingAssistant, setStreamingAssistant] = useState<StreamingAssistant | null>(null);
  const [status, setStatus] = useState<StreamStatus>('idle');
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [tokens, setTokens] = useState<TokenUsage>({ promptTokens: 0, completionTokens: 0, total: 0 });
  const streamIdRef = useRef<string | null>(null);
  const pendingRef = useRef<AgentEventLike[]>([]);
  const timerRef = useRef<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  const flush = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setStreamingAssistant((prev) => mergeEvents(prev ?? emptyStreaming(), batch));
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setInterval(flush, FLUSH_INTERVAL_MS);
  }, [flush]);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    const { messages: rows } = await ipc.chat.getMessages(chatId);
    setMessages(rows);
  }, [chatId]);

  useEffect(() => {
    void refresh();
    // Whenever we switch chats, reset stream state so terminal status
    // from a prior chat doesn't bleed into the new one.
    setStreamingAssistant(null);
    setStatus('idle');
    setPendingApproval(null);
    setTokens({ promptTokens: 0, completionTokens: 0, total: 0 });
    streamIdRef.current = null;
  }, [refresh, chatId]);

  // Background poll: while there's no active local stream, periodically
  // re-fetch messages so server-side writes (e.g. coordinator team-run
  // appending task outputs + synthesis) appear without manual refresh.
  // 1.8s cadence is cheap (~1 RTT per chat) and stops as soon as a local
  // stream starts.
  useEffect(() => {
    if (!chatId) return;
    const id = window.setInterval(() => {
      if (streamIdRef.current !== null) return;
      void refresh();
    }, 1800);
    return () => window.clearInterval(id);
  }, [chatId, refresh]);

  useEffect(() => {
    return () => {
      stopTimer();
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [stopTimer]);

  const send = useCallback(
    async (text: string) => {
      if (!chatId) return;
      // Only block when an active stream is genuinely in flight (we still
      // hold a streamId). Stale 'aborted' / 'error' / 'max-tools' state
      // must not freeze the composer for the user's next message.
      if (status === 'streaming' && streamIdRef.current !== null) return;
      const tempUser: MessageDto = {
        id: `temp-${Date.now()}`,
        chatId,
        role: 'user',
        content: text,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, tempUser]);
      setStreamingAssistant(emptyStreaming());
      setStatus('streaming');
      setPendingApproval(null);
      startTimer();

      const { streamId } = await ipc.chat.sendMessage(chatId, text);
      streamIdRef.current = streamId;

      const unsub = ipc.chat.subscribeToStream(
        streamId,
        (event) => {
          const e = event as { type?: string };
          if (e.type === 'tool-approval-required') {
            const t = event as PendingApproval;
            setPendingApproval({
              toolCallId: t.toolCallId,
              toolName: t.toolName,
              args: t.args,
              cwd: t.cwd,
            });
            return;
          }
          if (e.type === 'tool-approval-resolved') {
            setPendingApproval(null);
            return;
          }
          if (e.type === 'token-usage') {
            const t = event as { promptTokens?: number; completionTokens?: number };
            const p = t.promptTokens ?? 0;
            const c = t.completionTokens ?? 0;
            setTokens((prev) => ({
              promptTokens: prev.promptTokens + p,
              completionTokens: prev.completionTokens + c,
              total: prev.total + p + c,
            }));
            return;
          }
          pendingRef.current.push(event as AgentEventLike);
        },
        async (endPayload) => {
          stopTimer();
          flush();
          unsubRef.current = null;
          streamIdRef.current = null;
          setPendingApproval(null);

          const reason = endPayload.reason;
          await refresh();
          setStreamingAssistant(null);
          if (reason === 'end') setStatus('idle');
          else if (reason === 'max-tools') setStatus('max-tools');
          else if (reason === 'aborted') setStatus('aborted');
          else setStatus('error');
        },
      );
      unsubRef.current = unsub;
    },
    [chatId, status, startTimer, stopTimer, flush, refresh],
  );

  const abort = useCallback(() => {
    const streamId = streamIdRef.current;
    if (!streamId) return;
    void ipc.chat.abort(streamId);
  }, []);

  const respondApproval = useCallback(
    async (decision: 'allow-once' | 'allow-rest' | 'deny', reason?: string) => {
      const streamId = streamIdRef.current;
      const current = pendingApproval;
      if (!streamId || !current) return;
      await ipc.chat.respondToApproval({
        streamId,
        toolCallId: current.toolCallId,
        decision,
        reason,
      });
    },
    [pendingApproval],
  );

  return {
    messages,
    streamingAssistant,
    status,
    pendingApproval,
    tokens,
    send,
    abort,
    refresh,
    respondApproval,
  };
}
