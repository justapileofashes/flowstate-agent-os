import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type {
  AgentDto,
  ChatDto,
  MessageDto,
} from '@shared/chat-types';
import type { ConversationMessage } from '@main/agent/types';

export type AgentRow = AgentDto;
export type ChatRow = ChatDto;
export type MessageRow = MessageDto;

export interface CreateAgentInput {
  id: string;
  name: string;
  description: string;
  specialtyTags: string[];
  avatarColor: string;
  systemPrompt: string;
  model: string;
  workspacePath: string;
  toolPerms: { shell_enabled: boolean; delete_enabled: boolean };
  approvalPolicy: 'cautious' | 'trusting' | 'yolo';
}

export type UpdateAgentInput = Omit<CreateAgentInput, 'id' | 'workspacePath'>;

interface AgentDbRow {
  id: string;
  name: string;
  description: string;
  specialty_tags: string;
  avatar_color: string;
  system_prompt: string;
  model: string;
  workspace_path: string;
  tool_perms: string;
  approval_policy: string;
  created_at: number;
  updated_at: number;
}

interface ChatDbRow {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

interface MessageDbRow {
  id: string;
  chat_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls_json: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  created_at: number;
}

function toAgent(r: AgentDbRow): AgentRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    specialtyTags: JSON.parse(r.specialty_tags) as string[],
    avatarColor: r.avatar_color,
    systemPrompt: r.system_prompt,
    model: r.model,
    workspacePath: r.workspace_path,
    toolPerms: JSON.parse(r.tool_perms) as { shell_enabled: boolean; delete_enabled: boolean },
    approvalPolicy: r.approval_policy as 'cautious' | 'trusting' | 'yolo',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toChat(r: ChatDbRow): ChatRow {
  return {
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toMessage(r: MessageDbRow): MessageRow {
  const out: MessageRow = {
    id: r.id,
    chatId: r.chat_id,
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  };
  if (r.tool_calls_json) {
    out.toolCalls = JSON.parse(r.tool_calls_json) as MessageRow['toolCalls'];
  }
  if (r.tool_call_id) out.toolCallId = r.tool_call_id;
  if (r.tool_name) out.toolName = r.tool_name;
  return out;
}

export class ChatRepository {
  private listAgentsStmt;
  private getAgentStmt;
  private listChatsStmt;
  private insertChatStmt;
  private updateChatTitleStmt;
  private bumpChatStmt;
  private getChatStmt;
  private getMessagesStmt;
  private insertMessageStmt;

  constructor(private readonly db: Database) {
    this.listAgentsStmt = db.prepare<[], AgentDbRow>(
      'SELECT * FROM agents ORDER BY name',
    );
    this.getAgentStmt = db.prepare<[string], AgentDbRow>(
      'SELECT * FROM agents WHERE id = ?',
    );
    this.listChatsStmt = db.prepare<[string], ChatDbRow>(
      'SELECT * FROM chats WHERE agent_id = ? ORDER BY updated_at DESC',
    );
    this.insertChatStmt = db.prepare(
      'INSERT INTO chats (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    this.updateChatTitleStmt = db.prepare(
      'UPDATE chats SET title = ?, updated_at = ? WHERE id = ?',
    );
    this.bumpChatStmt = db.prepare(
      'UPDATE chats SET updated_at = ? WHERE id = ?',
    );
    this.getChatStmt = db.prepare<[string], ChatDbRow>(
      'SELECT * FROM chats WHERE id = ?',
    );
    this.getMessagesStmt = db.prepare<[string], MessageDbRow>(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at',
    );
    this.insertMessageStmt = db.prepare(
      `INSERT INTO messages
        (id, chat_id, role, content, tool_calls_json, tool_call_id, tool_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  listAgents(): AgentRow[] {
    return this.listAgentsStmt.all().map(toAgent);
  }

  getAgent(id: string): AgentRow | null {
    const row = this.getAgentStmt.get(id);
    return row ? toAgent(row) : null;
  }

  listChats(agentId: string): ChatRow[] {
    return this.listChatsStmt.all(agentId).map(toChat);
  }

  /**
   * List recent chats across all agents, newest first. Joins agent name +
   * color for sidebar display.
   */
  listRecentChats(
    limit: number = 50,
  ): Array<ChatRow & { agentName: string; agentColor: string }> {
    const rows = this.db
      .prepare<
        [number],
        ChatDbRow & { agent_name: string; avatar_color: string }
      >(
        `SELECT chats.*, agents.name AS agent_name, agents.avatar_color AS avatar_color
         FROM chats
         INNER JOIN agents ON agents.id = chats.agent_id
         ORDER BY chats.updated_at DESC
         LIMIT ?`,
      )
      .all(limit);
    return rows.map((r) => ({
      ...toChat(r),
      agentName: r.agent_name,
      agentColor: r.avatar_color,
    }));
  }

  getChat(chatId: string): ChatRow | null {
    const row = this.getChatStmt.get(chatId);
    return row ? toChat(row) : null;
  }

  createChat(agentId: string, title?: string): ChatRow {
    const id = randomUUID();
    const now = Date.now();
    this.insertChatStmt.run(id, agentId, title ?? '', now, now);
    return { id, agentId, title: title ?? '', createdAt: now, updatedAt: now };
  }

  updateChatTitle(chatId: string, title: string): void {
    this.updateChatTitleStmt.run(title, Date.now(), chatId);
  }

  /**
   * Delete a chat and all of its messages. Uses an explicit transaction
   * because the schema does not declare `ON DELETE CASCADE` on messages.
   */
  deleteChat(chatId: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
      this.db.prepare('DELETE FROM chats WHERE id = ?').run(chatId);
    });
    tx();
  }

  getMessages(chatId: string): MessageRow[] {
    return this.getMessagesStmt.all(chatId).map(toMessage);
  }

  /** Full-text search across all message bodies + chat titles. Uses LIKE
   *  with wildcard wraps — fast enough at chat sizes < 100k rows; can be
   *  upgraded to FTS5 later without API churn. Returns ranked hits with
   *  a snippet around the first match. */
  searchMessages(
    query: string,
    limit = 30,
  ): Array<{
    chatId: string;
    chatTitle: string;
    agentId: string;
    agentName: string;
    role: string;
    snippet: string;
    createdAt: number;
  }> {
    const q = query.trim();
    if (q.length === 0) return [];
    const like = `%${q.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT m.chat_id as chatId, c.title as chatTitle, c.agent_id as agentId,
                a.name as agentName, m.role as role, m.content as content,
                m.created_at as createdAt
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
         JOIN agents a ON a.id = c.agent_id
         WHERE m.role IN ('user','assistant') AND LOWER(m.content) LIKE ?
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(like, limit) as Array<{
        chatId: string;
        chatTitle: string | null;
        agentId: string;
        agentName: string;
        role: string;
        content: string;
        createdAt: number;
      }>;
    return rows.map((r) => {
      const text = r.content ?? '';
      const idx = text.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(text.length, idx + q.length + 80);
      const snippet =
        (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
      return {
        chatId: r.chatId,
        chatTitle: r.chatTitle || 'Untitled chat',
        agentId: r.agentId,
        agentName: r.agentName,
        role: r.role,
        snippet,
        createdAt: r.createdAt,
      };
    });
  }

  appendMessage(
    chatId: string,
    msg: Omit<MessageRow, 'id' | 'chatId' | 'createdAt'>,
  ): MessageRow {
    const id = randomUUID();
    const now = Date.now();

    const tx = this.db.transaction(() => {
      this.insertMessageStmt.run(
        id,
        chatId,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolCallId ?? null,
        msg.toolName ?? null,
        now,
      );

      if (msg.role === 'user') {
        const chat = this.getChatStmt.get(chatId);
        if (chat && chat.title === '') {
          const title = msg.content.slice(0, 60).trim();
          if (title.length > 0) {
            this.updateChatTitleStmt.run(title, now, chatId);
            return;
          }
        }
      }

      this.bumpChatStmt.run(now, chatId);
    });
    tx();

    const out: MessageRow = {
      id,
      chatId,
      role: msg.role,
      content: msg.content,
      createdAt: now,
    };
    if (msg.toolCalls) out.toolCalls = msg.toolCalls;
    if (msg.toolCallId) out.toolCallId = msg.toolCallId;
    if (msg.toolName) out.toolName = msg.toolName;
    return out;
  }

  createAgent(input: CreateAgentInput): AgentRow {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO agents
          (id, name, description, specialty_tags, avatar_color, system_prompt, model, workspace_path, tool_perms, approval_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.description,
        JSON.stringify(input.specialtyTags),
        input.avatarColor,
        input.systemPrompt,
        input.model,
        input.workspacePath,
        JSON.stringify(input.toolPerms),
        input.approvalPolicy,
        now,
        now,
      );
    const row = this.getAgent(input.id);
    if (!row) throw new Error(`createAgent: failed to read back ${input.id}`);
    return row;
  }

  updateAgent(id: string, input: UpdateAgentInput): AgentRow {
    const existing = this.getAgent(id);
    if (!existing) throw new Error(`updateAgent: unknown agent ${id}`);
    const now = Date.now();
    this.db
      .prepare(
        `UPDATE agents
           SET name = ?,
               description = ?,
               specialty_tags = ?,
               avatar_color = ?,
               system_prompt = ?,
               model = ?,
               tool_perms = ?,
               approval_policy = ?,
               updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.description,
        JSON.stringify(input.specialtyTags),
        input.avatarColor,
        input.systemPrompt,
        input.model,
        JSON.stringify(input.toolPerms),
        input.approvalPolicy,
        now,
        id,
      );
    const row = this.getAgent(id);
    if (!row) throw new Error(`updateAgent: agent ${id} disappeared`);
    return row;
  }

  deleteAgent(id: string): void {
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  }

  toConversation(rows: MessageRow[]): ConversationMessage[] {
    return rows.map((r) => {
      const m: ConversationMessage = { role: r.role, content: r.content };
      if (r.toolCalls) {
        m.toolCalls = r.toolCalls.map((c) => ({
          id: c.id,
          name: c.name,
          args: c.args,
        }));
      }
      if (r.toolCallId) m.toolCallId = r.toolCallId;
      if (r.toolName) m.toolName = r.toolName;
      return m;
    });
  }
}
