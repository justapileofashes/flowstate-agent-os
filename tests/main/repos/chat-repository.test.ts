import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, setHelperWorkspace } from '@main/db/database';
import { ChatRepository } from '@main/repos/chat-repository';
import type { Database } from 'better-sqlite3';

let dir: string;
let db: Database;
let repo: ChatRepository;
const HELPER = 'agent-code-helper';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowstate-repo-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  setHelperWorkspace(db, '/tmp/ws/helper');
  repo = new ChatRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('ChatRepository — agents', () => {
  it('listAgents returns the seeded helper', () => {
    const agents = repo.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: HELPER, name: 'Code Helper' });
  });

  it('getAgent returns null for unknown id', () => {
    expect(repo.getAgent('nope')).toBeNull();
  });

  it('getAgent returns the helper', () => {
    const a = repo.getAgent(HELPER);
    expect(a?.workspacePath).toBe('/tmp/ws/helper');
  });
});

describe('ChatRepository — chats', () => {
  it('createChat assigns id, sets timestamps, defaults empty title', () => {
    const c = repo.createChat(HELPER);
    expect(c.id).toMatch(/.+/);
    expect(c.agentId).toBe(HELPER);
    expect(c.title).toBe('');
    expect(c.createdAt).toBeGreaterThan(0);
    expect(c.updatedAt).toBe(c.createdAt);
  });

  it('createChat respects provided title', () => {
    const c = repo.createChat(HELPER, 'Hello');
    expect(c.title).toBe('Hello');
  });

  it('listChats orders by updated_at DESC', async () => {
    const a = repo.createChat(HELPER, 'A');
    await new Promise((r) => setTimeout(r, 5));
    const b = repo.createChat(HELPER, 'B');
    await new Promise((r) => setTimeout(r, 5));
    repo.appendMessage(a.id, { role: 'user', content: 'hi' });
    const list = repo.listChats(HELPER);
    expect(list.map((c) => c.id)).toEqual([a.id, b.id]);
  });

  it('getChat returns null for unknown id', () => {
    expect(repo.getChat('nope')).toBeNull();
  });

  it('getChat returns the chat by id', () => {
    const c = repo.createChat(HELPER, 'X');
    expect(repo.getChat(c.id)?.title).toBe('X');
  });

  it('updateChatTitle updates title and bumps updated_at', async () => {
    const c = repo.createChat(HELPER);
    const before = c.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    repo.updateChatTitle(c.id, 'New');
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('New');
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });
});

describe('ChatRepository — messages', () => {
  it('appendMessage assigns id, sets created_at', () => {
    const c = repo.createChat(HELPER);
    const m = repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    expect(m.id).toMatch(/.+/);
    expect(m.chatId).toBe(c.id);
    expect(m.role).toBe('user');
    expect(m.createdAt).toBeGreaterThan(0);
  });

  it('appendMessage auto-sets chat title from first user message (60-char trim)', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'user', content: 'a'.repeat(80) });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('a'.repeat(60));
  });

  it('appendMessage does NOT change a non-empty title', () => {
    const c = repo.createChat(HELPER, 'preset');
    repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('preset');
  });

  it('appendMessage does NOT auto-title from non-user roles', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'assistant', content: 'hello' });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.title).toBe('');
  });

  it('getMessages returns rows in created_at order', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'user', content: 'a' });
    repo.appendMessage(c.id, { role: 'assistant', content: 'b' });
    const ms = repo.getMessages(c.id);
    expect(ms.map((m) => m.content)).toEqual(['a', 'b']);
  });

  it('round-trips toolCalls JSON for assistant role', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, {
      role: 'assistant',
      content: 'I will read',
      toolCalls: [{ id: 'tc1', name: 'read_file', args: { path: 'a.txt' } }],
    });
    const ms = repo.getMessages(c.id);
    expect(ms[0]?.toolCalls).toEqual([
      { id: 'tc1', name: 'read_file', args: { path: 'a.txt' } },
    ]);
  });

  it('round-trips toolCallId/toolName for tool role', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, {
      role: 'tool',
      content: 'hello',
      toolCallId: 'tc1',
      toolName: 'read_file',
    });
    const ms = repo.getMessages(c.id);
    expect(ms[0]?.toolCallId).toBe('tc1');
    expect(ms[0]?.toolName).toBe('read_file');
  });

  it('appendMessage bumps parent chat updated_at', async () => {
    const c = repo.createChat(HELPER);
    const before = c.updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    repo.appendMessage(c.id, { role: 'user', content: 'x' });
    const after = repo.listChats(HELPER)[0]!;
    expect(after.updatedAt).toBeGreaterThan(before);
  });
});

describe('ChatRepository.toConversation', () => {
  it('maps MessageRow[] → ConversationMessage[]', () => {
    const c = repo.createChat(HELPER);
    repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    repo.appendMessage(c.id, {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 't1', name: 'list_dir', args: { path: '.' } }],
    });
    repo.appendMessage(c.id, {
      role: 'tool',
      content: '[]',
      toolCallId: 't1',
      toolName: 'list_dir',
    });
    const conv = repo.toConversation(repo.getMessages(c.id));
    expect(conv).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'list_dir', args: { path: '.' } }],
      },
      {
        role: 'tool',
        content: '[]',
        toolCallId: 't1',
        toolName: 'list_dir',
      },
    ]);
  });
});

describe('ChatRepository — agent CRUD', () => {
  it('createAgent persists all fields and returns AgentRow', () => {
    const a = repo.createAgent({
      id: 'researcher-abc12345',
      name: 'Researcher',
      description: 'Synthesizes notes',
      specialtyTags: ['research', 'notes'],
      systemPrompt: 'You research and synthesize.',
      model: 'qwen2.5:7b',
      avatarColor: '#6dbf94',
      workspacePath: '/tmp/ws/researcher',
      toolPerms: { shell_enabled: false, delete_enabled: true },
      approvalPolicy: 'cautious',
    });
    expect(a.id).toBe('researcher-abc12345');
    expect(a.name).toBe('Researcher');
    expect(a.description).toBe('Synthesizes notes');
    expect(a.specialtyTags).toEqual(['research', 'notes']);
    expect(a.avatarColor).toBe('#6dbf94');
    expect(a.workspacePath).toBe('/tmp/ws/researcher');
    expect(repo.listAgents()).toHaveLength(2);
  });

  it('updateAgent mutates name/description/tags/system_prompt/model/color', () => {
    repo.createAgent({
      id: 'researcher-abc12345',
      name: 'Researcher',
      description: 'old',
      specialtyTags: ['research'],
      systemPrompt: 'old prompt',
      model: 'qwen2.5:7b',
      avatarColor: '#000000',
      workspacePath: '/tmp/ws/researcher',
      toolPerms: { shell_enabled: false, delete_enabled: true },
      approvalPolicy: 'cautious',
    });
    const updated = repo.updateAgent('researcher-abc12345', {
      name: 'Researcher 2',
      description: 'new',
      specialtyTags: ['research', 'synthesis'],
      systemPrompt: 'new prompt',
      model: 'llama3.1:8b',
      avatarColor: '#d97757',
      toolPerms: { shell_enabled: false, delete_enabled: true },
      approvalPolicy: 'cautious',
    });
    expect(updated.name).toBe('Researcher 2');
    expect(updated.description).toBe('new');
    expect(updated.specialtyTags).toEqual(['research', 'synthesis']);
    expect(updated.systemPrompt).toBe('new prompt');
    expect(updated.model).toBe('llama3.1:8b');
    expect(updated.avatarColor).toBe('#d97757');
    expect(updated.workspacePath).toBe('/tmp/ws/researcher');
  });

  it('updateAgent throws on unknown id', () => {
    expect(() =>
      repo.updateAgent('nope', {
        name: 'x',
        description: '',
        specialtyTags: [],
        systemPrompt: 'p',
        model: 'm',
        avatarColor: '#ffffff',
        toolPerms: { shell_enabled: false, delete_enabled: true },
        approvalPolicy: 'cautious',
      }),
    ).toThrow();
  });

  it('deleteAgent removes the row and cascades chats/messages', () => {
    const a = repo.createAgent({
      id: 'temp-12345678',
      name: 'Temp',
      description: '',
      specialtyTags: [],
      systemPrompt: 'p',
      model: 'm',
      avatarColor: '#000000',
      workspacePath: '/tmp/ws/temp',
      toolPerms: { shell_enabled: false, delete_enabled: true },
      approvalPolicy: 'cautious',
    });
    const c = repo.createChat(a.id);
    repo.appendMessage(c.id, { role: 'user', content: 'hi' });
    repo.deleteAgent(a.id);
    expect(repo.getAgent(a.id)).toBeNull();
    expect(repo.listChats(a.id)).toEqual([]);
    expect(repo.getMessages(c.id)).toEqual([]);
  });

  it('round-trips toolPerms and approvalPolicy through create + update', () => {
    const a = repo.createAgent({
      id: 'shell-agent-12345678',
      name: 'Shell Agent',
      description: '',
      specialtyTags: [],
      systemPrompt: 'p',
      model: 'm',
      avatarColor: '#000000',
      workspacePath: '/tmp/ws/shell',
      toolPerms: { shell_enabled: true, delete_enabled: false },
      approvalPolicy: 'trusting',
    });
    expect(a.toolPerms).toEqual({ shell_enabled: true, delete_enabled: false });
    expect(a.approvalPolicy).toBe('trusting');
    const u = repo.updateAgent(a.id, {
      name: 'Shell Agent',
      description: '',
      specialtyTags: [],
      systemPrompt: 'p',
      model: 'm',
      avatarColor: '#000000',
      toolPerms: { shell_enabled: true, delete_enabled: true },
      approvalPolicy: 'yolo',
    });
    expect(u.toolPerms).toEqual({ shell_enabled: true, delete_enabled: true });
    expect(u.approvalPolicy).toBe('yolo');
  });
});
