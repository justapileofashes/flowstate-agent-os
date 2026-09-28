import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools';
import { ToolDispatcher, MAX_TOOL_OUTPUT_BYTES } from '@main/agent/tool-dispatcher';
import type { AgentRow, ChatRow } from '@main/repos/chat-repository';
import type { ApprovalGate } from '@main/agent/approval-gate';
import type { McpManager } from '@main/services/mcp-manager';

let workspace: string;
let tools: FileTools;
let dispatcher: ToolDispatcher;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-disp-'));
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'world');
  tools = new FileTools(workspace);
  dispatcher = new ToolDispatcher({ fileTools: tools, workspaceRoot: workspace });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('ToolDispatcher.call — happy paths', () => {
  it('read_file returns content', async () => {
    const r = await dispatcher.call('id1', 'read_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('hello');
    expect(r.toolCallId).toBe('id1');
    expect(r.toolName).toBe('read_file');
  });

  it('list_dir returns JSON array of entries', async () => {
    const r = await dispatcher.call('id2', 'list_dir', { path: '.' });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(r.content) as Array<{ name: string; kind: string }>;
    const names = parsed.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'sub']);
  });

  it('write_file creates a file', async () => {
    const r = await dispatcher.call('id3', 'write_file', {
      path: 'new.txt',
      content: 'hi',
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toEqual({ created: true });
  });

  it('delete_file removes a file', async () => {
    const r = await dispatcher.call('id4', 'delete_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('ok');
  });

  it('search_files name mode returns hits as JSON', async () => {
    const r = await dispatcher.call('id5', 'search_files', {
      pattern: '*.txt',
      kind: 'name',
    });
    expect(r.ok).toBe(true);
    const hits = JSON.parse(r.content) as Array<{ path: string }>;
    expect(hits.map((h) => h.path).sort()).toEqual(['a.txt', 'sub/b.txt']);
  });
});

describe('ToolDispatcher.call — failures (returned, not thrown)', () => {
  it('unknown tool returns ok=false', async () => {
    const r = await dispatcher.call('x', 'nope_tool', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/unknown tool/);
  });

  it('missing required arg returns ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('wrong arg type returns ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: 42 });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('invalid enum value for search_files.kind returns ok=false', async () => {
    const r = await dispatcher.call('x', 'search_files', {
      pattern: '*',
      kind: 'bogus',
    });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('FileTools error (e.g. ENOENT) returned as ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: 'missing.txt' });
    expect(r.ok).toBe(false);
    expect(r.content.length).toBeGreaterThan(0);
  });

  it('sandbox violation returned as ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: '../escape' });
    expect(r.ok).toBe(false);
  });
});

describe('ToolDispatcher.call — tool perms', () => {
  // A model can emit any tool name (hallucination / prompt injection), and team
  // runs dispatch as 'yolo' — so hiding a spec is not enough; the dispatcher
  // itself must refuse tools the agent's perms disable.
  function withPerms(shell: boolean, del: boolean): ToolDispatcher {
    const agent = {
      id: 'agent-x',
      name: 'X',
      approvalPolicy: 'yolo',
      toolPerms: { shell_enabled: shell, delete_enabled: del },
    } as unknown as AgentRow;
    return new ToolDispatcher({ fileTools: tools, workspaceRoot: workspace, agent });
  }

  it('refuses run_shell and run_code when shell is disabled', async () => {
    const d = withPerms(false, true);
    const sh = await d.call('x', 'run_shell', { command: 'echo hi' });
    expect(sh.ok).toBe(false);
    expect(sh.content).toMatch(/disabled for this agent/);
    const code = await d.call('y', 'run_code', { language: 'javascript', source: 'return 1 + 1' });
    expect(code.ok).toBe(false);
    expect(code.content).toMatch(/disabled for this agent/);
  });

  it('refuses delete_file when delete is disabled', async () => {
    const r = await withPerms(true, false).call('x', 'delete_file', { path: 'a.txt' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/disabled for this agent/);
    expect(existsSync(join(workspace, 'a.txt'))).toBe(true);
  });

  it('still runs run_code when shell is enabled', async () => {
    const r = await withPerms(true, true).call('x', 'run_code', { language: 'javascript', source: 'return 1 + 1' });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toMatchObject({ ok: true, result: 2 });
  });
});

describe('ToolDispatcher.call — Stop during approval', () => {
  it('does not run the tool when the run was stopped while approval was pending', async () => {
    const ac = new AbortController();
    // Stand-in gate: the user clicks Stop, then Allow on the still-open card.
    const approvalGate = {
      require: async () => {
        ac.abort();
        return 'allow' as const;
      },
    } as unknown as ApprovalGate;
    const agent = {
      id: 'agent-x',
      name: 'X',
      approvalPolicy: 'cautious',
      toolPerms: { shell_enabled: true, delete_enabled: true },
    } as unknown as AgentRow;
    const d = new ToolDispatcher({
      fileTools: tools,
      workspaceRoot: workspace,
      approvalGate,
      agent,
      chat: { id: 'chat-x' } as unknown as ChatRow,
      streamId: 'stream-x',
    });
    const r = await d.call('x', 'write_file', { path: 'stopped.txt', content: 'nope' }, ac.signal);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Stopped by the user/);
    expect(existsSync(join(workspace, 'stopped.txt'))).toBe(false);
  });
});

describe('ToolDispatcher.call — Stop during the safety snapshot', () => {
  it('does not run the tool when the run was stopped while the snapshot was being written', async () => {
    // The snapshot is awaited after approval returns. An abort landing in that
    // window must still stop the tool, not only one taken during the wait.
    const root = mkdtempSync(join(tmpdir(), 'fs-snap-'));
    writeFileSync(join(root, 'doomed.txt'), 'keep me');
    const ac = new AbortController();
    const dispatcher = new ToolDispatcher({
      fileTools: new FileTools(root),
      workspaceRoot: root,
      snapshots: { create: async () => { ac.abort(); } },
      agent: { id: 'a1', toolPerms: { shell_enabled: false, delete_enabled: true } } as AgentRow,
      chat: { id: 'chat-x' } as ChatRow,
      streamId: 'stream-x',
      approvalGate: { require: async () => 'allow' as const } as unknown as ApprovalGate,
    } as unknown as ConstructorParameters<typeof ToolDispatcher>[0]);
    const r = await dispatcher.call('x', 'delete_file', { path: 'doomed.txt' }, ac.signal);
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Stopped by the user/);
    expect(existsSync(join(root, 'doomed.txt'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('ToolDispatcher.call — MCP tools go through the approval gate', () => {
  it('does not call the MCP server when the gate denies', async () => {
    let calls = 0;
    const mcpManager = {
      callTool: async () => {
        calls += 1;
        return { isError: false, content: 'done' };
      },
    } as unknown as McpManager;
    const approvalGate = { require: async () => 'deny' as const } as unknown as ApprovalGate;
    const agent = {
      id: 'agent-x',
      name: 'X',
      approvalPolicy: 'cautious',
      toolPerms: { shell_enabled: false, delete_enabled: false },
    } as unknown as AgentRow;
    const d = new ToolDispatcher({
      fileTools: tools,
      workspaceRoot: workspace,
      approvalGate,
      agent,
      chat: { id: 'chat-x' } as unknown as ChatRow,
      streamId: 'stream-x',
      mcpManager,
    });
    const r = await d.call('x', 'mcp__srv__send_email', { to: 'a@b.c' });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Denied/);
    expect(calls).toBe(0);
  });
});

describe('ToolDispatcher.call — output cap', () => {
  it('truncates read_file output above MAX_TOOL_OUTPUT_BYTES', async () => {
    const big = 'a'.repeat(MAX_TOOL_OUTPUT_BYTES + 50_000);
    writeFileSync(join(workspace, 'big.txt'), big);
    const r = await dispatcher.call('x', 'read_file', { path: 'big.txt' });
    expect(r.ok).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES + 200);
    expect(r.content).toMatch(/truncated/);
  });
});
