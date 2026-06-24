import { ipcMain, BrowserWindow } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CHANNELS, schemas, teamEventChannel, teamEventEndChannel } from '@shared/ipc-channels';
import type { ChatRepository } from '@main/repos/chat-repository';
import type { AgentSessionManager } from '@main/agent/agent-session-manager';
import type { LLMProvider } from '@main/agent/llm-provider';
import type { Orchestrator } from '@main/agent/orchestrator';
import type { Coordinator, CoordinatorRunHandle } from '@main/agent/coordinator';
import type { AgentGenerator } from '@main/agent/agent-generator';
import { generateAgentId } from '@main/util/agent-id';

export interface ChatHandlerDeps {
  repo: ChatRepository;
  manager: AgentSessionManager;
  provider: LLMProvider;
  orchestrator: Orchestrator;
  coordinator: Coordinator;
  agentGenerator: AgentGenerator;
  workspacesDir: string;
}

export function registerChatHandlers(deps: ChatHandlerDeps): void {
  ipcMain.handle(CHANNELS.CHAT_LIST_AGENTS, () => ({
    agents: deps.repo.listAgents(),
  }));

  ipcMain.handle(CHANNELS.CHAT_LIST_CHATS, (_e, raw) => {
    const { agentId } = schemas.chatListChatsRequest.parse(raw);
    return { chats: deps.repo.listChats(agentId) };
  });

  ipcMain.handle(CHANNELS.CHAT_LIST_RECENT_CHATS, (_e, raw) => {
    const { limit } = schemas.chatListRecentChatsRequest.parse(raw ?? {});
    return { chats: deps.repo.listRecentChats(limit ?? 50) };
  });

  ipcMain.handle(CHANNELS.CHAT_DELETE_CHAT, (_e, raw) => {
    const { chatId } = schemas.chatDeleteChatRequest.parse(raw);
    deps.repo.deleteChat(chatId);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.CHAT_RENAME_CHAT, (_e, raw) => {
    const { chatId, title } = schemas.chatRenameChatRequest.parse(raw);
    deps.repo.updateChatTitle(chatId, title);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.CHAT_SEARCH, (_e, raw) => {
    const { q, limit } = schemas.chatSearchRequest.parse(raw);
    return { hits: deps.repo.searchMessages(q, limit) };
  });

  ipcMain.handle(CHANNELS.CHAT_FORK, (_e, raw) => {
    const { chatId, untilMessageId, title } = schemas.chatForkRequest.parse(raw);
    const original = deps.repo.getChat(chatId);
    if (!original) throw new Error(`unknown chat: ${chatId}`);
    const messages = deps.repo.getMessages(chatId);
    const cutIdx = untilMessageId
      ? messages.findIndex((m) => m.id === untilMessageId)
      : messages.length - 1;
    const slice = cutIdx === -1 ? messages : messages.slice(0, cutIdx + 1);
    const newChat = deps.repo.createChat(
      original.agentId,
      title ?? `${original.title || 'Untitled'} (fork)`,
    );
    for (const m of slice) {
      const payload: { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; toolCalls?: typeof m.toolCalls; toolCallId?: string; toolName?: string } = {
        role: m.role,
        content: m.content,
      };
      if (m.toolCalls) payload.toolCalls = m.toolCalls;
      if (m.toolCallId) payload.toolCallId = m.toolCallId;
      if (m.toolName) payload.toolName = m.toolName;
      deps.repo.appendMessage(newChat.id, payload);
    }
    return { chatId: newChat.id, agentId: original.agentId };
  });

  ipcMain.handle(CHANNELS.CHAT_GENERATE_AGENT, async (_e, raw) => {
    const input = schemas.chatGenerateAgentRequest.parse(raw);
    const spec = await deps.agentGenerator.generate({
      ...(input.name ? { name: input.name } : {}),
      use: input.use,
    });
    const id = generateAgentId(spec.name);
    const workspacePath = join(deps.workspacesDir, id);
    await mkdir(workspacePath, { recursive: true });
    const agent = deps.repo.createAgent({
      id,
      name: spec.name,
      description: spec.description,
      specialtyTags: spec.specialtyTags,
      systemPrompt: spec.systemPrompt,
      model: spec.model,
      avatarColor: spec.avatarColor,
      workspacePath,
      toolPerms: spec.toolPerms,
      approvalPolicy: spec.approvalPolicy,
    });
    return { agent };
  });

  ipcMain.handle(CHANNELS.CHAT_CREATE_CHAT, (_e, raw) => {
    const { agentId, title } = schemas.chatCreateChatRequest.parse(raw);
    return { chat: deps.repo.createChat(agentId, title) };
  });

  ipcMain.handle(CHANNELS.CHAT_GET_MESSAGES, (_e, raw) => {
    const { chatId } = schemas.chatGetMessagesRequest.parse(raw);
    return { messages: deps.repo.getMessages(chatId) };
  });

  ipcMain.handle(CHANNELS.CHAT_SEND_MESSAGE, async (_e, raw) => {
    const { chatId, text } = schemas.chatSendMessageRequest.parse(raw);
    const { streamId, session } = await deps.manager.start(chatId);
    void session.run(text);
    return { streamId };
  });

  ipcMain.handle(CHANNELS.CHAT_ABORT, (_e, raw) => {
    const { streamId } = schemas.chatAbortRequest.parse(raw);
    return { ok: deps.manager.abort(streamId) };
  });

  ipcMain.handle(CHANNELS.CHAT_LIST_MODELS, async () => {
    try {
      const models = await deps.provider.listModels();
      return { models: models.map((m) => ({ name: m.name, size: m.size })) };
    } catch {
      return { models: [] };
    }
  });

  ipcMain.handle(CHANNELS.CHAT_CREATE_AGENT, async (_e, raw) => {
    const input = schemas.chatCreateAgentRequest.parse(raw);
    const id = generateAgentId(input.name);
    const workspacePath = join(deps.workspacesDir, id);
    await mkdir(workspacePath, { recursive: true });
    const agent = deps.repo.createAgent({
      id,
      name: input.name.trim(),
      description: input.description,
      specialtyTags: input.specialtyTags,
      systemPrompt: input.systemPrompt,
      model: input.model,
      avatarColor: input.avatarColor,
      workspacePath,
      toolPerms: input.toolPerms,
      approvalPolicy: input.approvalPolicy,
    });
    return { agent };
  });

  ipcMain.handle(CHANNELS.CHAT_UPDATE_AGENT, (_e, raw) => {
    const input = schemas.chatUpdateAgentRequest.parse(raw);
    const agent = deps.repo.updateAgent(input.id, {
      name: input.name.trim(),
      description: input.description,
      specialtyTags: input.specialtyTags,
      systemPrompt: input.systemPrompt,
      model: input.model,
      avatarColor: input.avatarColor,
      toolPerms: input.toolPerms,
      approvalPolicy: input.approvalPolicy,
    });
    return { agent };
  });

  ipcMain.handle(CHANNELS.CHAT_DELETE_AGENT, (_e, raw) => {
    const { id } = schemas.chatDeleteAgentRequest.parse(raw);
    deps.repo.deleteAgent(id);
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.CHAT_APPROVAL_RESPONSE, (_e, raw) => {
    const { streamId, toolCallId, decision, reason } = schemas.chatApprovalResponseRequest.parse(raw);
    return { ok: deps.manager.resolveApproval(streamId, toolCallId, decision, reason) };
  });

  const activeTeamRuns = new Map<string, CoordinatorRunHandle>();

  ipcMain.handle(CHANNELS.CHAT_TEAM_RUN, (_e, raw) => {
    const { text } = schemas.chatTeamRunRequest.parse(raw);
    const send = (channel: string, payload: unknown): void => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send(channel, payload);
    };
    const { handle, done } = deps.coordinator.start(text, (event) => {
      send(teamEventChannel(handle.runId), event);
    });
    activeTeamRuns.set(handle.runId, handle);
    void done.finally(() => {
      activeTeamRuns.delete(handle.runId);
      send(teamEventEndChannel(handle.runId), { ok: true });
    });
    return { runId: handle.runId };
  });

  ipcMain.handle(CHANNELS.CHAT_TEAM_ABORT, (_e, raw) => {
    const { runId } = schemas.chatTeamAbortRequest.parse(raw);
    const h = activeTeamRuns.get(runId);
    if (!h) return { ok: false };
    h.abort();
    return { ok: true };
  });

  ipcMain.handle(CHANNELS.CHAT_TEAM_NUDGE, (_e, raw) => {
    const { runId, taskId, text, interrupt } = schemas.chatTeamNudgeRequest.parse(raw);
    const h = activeTeamRuns.get(runId);
    if (!h) return { ok: false };
    return { ok: h.nudge(taskId, text, interrupt) };
  });

  ipcMain.handle(CHANNELS.CHAT_ROUTE, async (_e, raw) => {
    const { text } = schemas.chatRouteRequest.parse(raw);
    const agents = deps.repo.listAgents();
    if (agents.length === 0) {
      throw new Error('No agents available — create one first.');
    }
    let decision;
    if (agents.length === 1) {
      decision = {
        agentId: agents[0]!.id,
        reasoning: 'Only one agent available.',
        fallback: false,
        swarm: [agents[0]!.id],
      };
    } else {
      decision = await deps.orchestrator.pickAgent(
        text,
        agents.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          specialtyTags: a.specialtyTags,
        })),
      );
    }
    const chat = deps.repo.createChat(decision.agentId);
    const swarm = decision.swarm ?? [decision.agentId];

    // True parallel team run: when the orchestrator picked >1 agent we
    // persist the user prompt up front + kick the coordinator. Each
    // task's output + the final synthesis land in the chat as assistant
    // messages, so the renderer just polls/refreshes and sees them.
    const team = swarm.length > 1;
    if (team) {
      deps.repo.appendMessage(chat.id, { role: 'user', content: text });

      // Run in background — route returns immediately.
      void (async () => {
        // Map taskId → agent name from the plan event so task-done can
        // attribute correctly.
        const taskAgents = new Map<string, string>();
        let synthesisBuffer = '';
        const { done } = deps.coordinator.start(text, (event) => {
          const e = event as { type?: string };
          if (e.type === 'plan') {
            const p = event as { plan: { tasks: Array<{ id: string; agentName: string }> } };
            for (const t of p.plan.tasks) taskAgents.set(t.id, t.agentName);
          } else if (e.type === 'task-done') {
            const t = event as { taskId: string; output: string; ok: boolean };
            const name = taskAgents.get(t.taskId) ?? 'agent';
            const body = (t.output ?? '').trim();
            if (body.length > 0) {
              deps.repo.appendMessage(chat.id, {
                role: 'assistant',
                content: `**${name}** — ${body}`,
              });
            }
          } else if (e.type === 'synthesis-text') {
            const s = event as { delta?: string };
            synthesisBuffer += s.delta ?? '';
          } else if (e.type === 'run-end') {
            const r = event as { reason: 'ok' | 'aborted' | 'error'; error?: string };
            if (r.reason === 'ok' && synthesisBuffer.trim().length > 0) {
              deps.repo.appendMessage(chat.id, {
                role: 'assistant',
                content: synthesisBuffer.trim(),
              });
            } else if (r.reason !== 'ok') {
              deps.repo.appendMessage(chat.id, {
                role: 'assistant',
                content: `_Team run ended: ${r.reason}${r.error ? ` — ${r.error}` : ''}._`,
              });
            }
          }
        });
        try {
          await done;
        } catch {
          // best-effort
        }
      })();
    }

    return {
      agentId: decision.agentId,
      chatId: chat.id,
      reasoning: decision.reasoning,
      fallback: decision.fallback,
      swarm,
      team,
    };
  });
}
