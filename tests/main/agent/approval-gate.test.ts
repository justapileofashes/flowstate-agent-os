import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '@main/agent/approval-gate';
import { CHANNELS } from '@shared/ipc-channels';

describe('ApprovalGate — background runs', () => {
  it('also broadcasts requests + resolutions on the global approval channels', async () => {
    const events: Array<{ channel: string; payload: unknown }> = [];
    const gate = new ApprovalGate((channel, payload) => events.push({ channel, payload }), 1000);
    const p = gate.require({
      streamId: 'team:t1',
      chatId: 'team:t1',
      agent: { id: 'a1', approvalPolicy: 'cautious', toolPerms: { shell_enabled: true, delete_enabled: true } },
      toolCallId: 'c1',
      toolName: 'run_shell',
      args: { command: 'ls' },
      cwd: '/w',
      isOverwrite: false,
    });
    const req = events.find((e) => e.channel === CHANNELS.APPROVAL_REQUEST);
    expect(req?.payload).toMatchObject({ streamId: 'team:t1', toolCallId: 'c1', agentId: 'a1', toolName: 'run_shell' });
    expect(gate.resolve('team:t1', 'c1', 'allow-once')).toBe(true);
    await expect(p).resolves.toBe('allow');
    expect(events.some((e) => e.channel === CHANNELS.APPROVAL_RESOLVED)).toBe(true);
  });
});

const fakeAgent = {
  id: 'a1',
  approvalPolicy: 'cautious' as const,
  toolPerms: { shell_enabled: true, delete_enabled: true },
};

function newGate(): {
  gate: ApprovalGate;
  events: Array<{ channel: string; payload: unknown }>;
} {
  const events: Array<{ channel: string; payload: unknown }> = [];
  const gate = new ApprovalGate(
    (channel, payload) => events.push({ channel, payload }),
    50,
  );
  return { gate, events };
}

describe('ApprovalGate.shouldPrompt — cautious', () => {
  it('prompts shell + delete + write_file overwrite, not reads', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('cautious', 'run_shell', { command: 'ls' }, false)).toBe(true);
    expect(gate.shouldPrompt('cautious', 'delete_file', { path: 'a' }, false)).toBe(true);
    expect(gate.shouldPrompt('cautious', 'write_file', { path: 'new' }, false)).toBe(false);
    expect(gate.shouldPrompt('cautious', 'write_file', { path: 'old' }, true)).toBe(true);
    expect(gate.shouldPrompt('cautious', 'read_file', { path: 'a' }, false)).toBe(false);
  });
});

describe('ApprovalGate.shouldPrompt — trusting', () => {
  it('prompts shell + delete only', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('trusting', 'run_shell', {}, false)).toBe(true);
    expect(gate.shouldPrompt('trusting', 'delete_file', {}, false)).toBe(true);
    expect(gate.shouldPrompt('trusting', 'write_file', {}, true)).toBe(false);
  });
});

describe('ApprovalGate.shouldPrompt — yolo', () => {
  it('never prompts', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('yolo', 'run_shell', {}, false)).toBe(false);
    expect(gate.shouldPrompt('yolo', 'delete_file', {}, false)).toBe(false);
  });
});

describe('ApprovalGate.shouldPrompt — run_code', () => {
  it('always prompts for run_code (host JS exec, not a sandbox)', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('cautious', 'run_code', { source: '1' }, false)).toBe(true);
    expect(gate.shouldPrompt('trusting', 'run_code', { source: '1' }, false)).toBe(true);
    expect(gate.shouldPrompt('yolo', 'run_code', { source: '1' }, false)).toBe(false);
  });
});

describe('ApprovalGate.shouldPrompt — MCP tools', () => {
  it('prompts for MCP tools (external actions) unless the agent is yolo', () => {
    const gate = new ApprovalGate(() => {}, 1000);
    expect(gate.shouldPrompt('cautious', 'mcp__srv__do', {}, false)).toBe(true);
    expect(gate.shouldPrompt('trusting', 'mcp__srv__do', {}, false)).toBe(true);
    expect(gate.shouldPrompt('yolo', 'mcp__srv__do', {}, false)).toBe(false);
  });
});

describe('ApprovalGate.require — abort signal', () => {
  const req = (signal: AbortSignal) => ({
    streamId: 's1',
    chatId: 'c1',
    agent: fakeAgent,
    toolCallId: 't1',
    toolName: 'run_shell',
    args: { command: 'ls' },
    cwd: '/tmp/ws',
    isOverwrite: false,
    signal,
  });

  // Long auto-deny so only the abort (not the timeout) can settle these quickly.
  const slowGate = () => {
    const events: Array<{ channel: string; payload: unknown }> = [];
    const gate = new ApprovalGate((channel, payload) => events.push({ channel, payload }), 60_000);
    return { gate, events };
  };
  const within200ms = <T,>(p: Promise<T>) =>
    Promise.race([p, new Promise<'still-pending'>((r) => setTimeout(() => r('still-pending'), 200))]);

  it('denies at once, without prompting, when the run is already stopped', async () => {
    const { gate, events } = slowGate();
    const ac = new AbortController();
    ac.abort();
    expect(await within200ms(gate.require(req(ac.signal)))).toBe('deny');
    expect(events.some((e) => e.channel === CHANNELS.APPROVAL_REQUEST)).toBe(false);
  });

  it('Stop while waiting denies the pending approval and a late Allow is a no-op', async () => {
    const { gate, events } = slowGate();
    const ac = new AbortController();
    const p = gate.require(req(ac.signal));
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    expect(await within200ms(p)).toBe('deny');
    expect(events.some((e) => e.channel === CHANNELS.APPROVAL_RESOLVED)).toBe(true);
    expect(gate.resolve('s1', 't1', 'allow-once')).toBe(false);
  });
});

describe('ApprovalGate.require — interactive', () => {
  it('emits tool-approval-required and resolves on allow-once', async () => {
    const { gate, events } = newGate();
    const p = gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: { command: 'ls' },
      cwd: '/tmp/ws',
      isOverwrite: false,
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(
      events.some(
        (e) => (e.payload as { type?: string }).type === 'tool-approval-required',
      ),
    ).toBe(true);
    gate.resolve('s1', 't1', 'allow-once');
    expect(await p).toBe('allow');
  });

  it('resolves to deny', async () => {
    const { gate } = newGate();
    const p = gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: {},
      cwd: '/tmp',
      isOverwrite: false,
    });
    gate.resolve('s1', 't1', 'deny', 'no');
    expect(await p).toBe('deny');
  });

  it('allow-rest is sticky for same chat+tool', async () => {
    const { gate, events } = newGate();
    const p1 = gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: {},
      cwd: '/tmp',
      isOverwrite: false,
    });
    gate.resolve('s1', 't1', 'allow-rest');
    expect(await p1).toBe('allow');
    const beforeCount = events.filter(
      (e) => (e.payload as { type?: string }).type === 'tool-approval-required',
    ).length;
    const p2 = gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't2',
      toolName: 'run_shell',
      args: {},
      cwd: '/tmp',
      isOverwrite: false,
    });
    expect(await p2).toBe('allow');
    const afterCount = events.filter(
      (e) => (e.payload as { type?: string }).type === 'tool-approval-required',
    ).length;
    expect(afterCount).toBe(beforeCount);
  });

  it('auto-denies after timeout', async () => {
    const { gate } = newGate();
    const result = await gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: fakeAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: {},
      cwd: '/tmp',
      isOverwrite: false,
    });
    expect(result).toBe('deny');
  });
});

describe('ApprovalGate.require — short-circuit by policy', () => {
  it('yolo never emits a prompt event', async () => {
    const { gate, events } = newGate();
    const yoloAgent = { ...fakeAgent, approvalPolicy: 'yolo' as const };
    const r = await gate.require({
      streamId: 's1',
      chatId: 'c1',
      agent: yoloAgent,
      toolCallId: 't1',
      toolName: 'run_shell',
      args: {},
      cwd: '/tmp',
      isOverwrite: false,
    });
    expect(r).toBe('allow');
    expect(
      events.some(
        (e) => (e.payload as { type?: string }).type === 'tool-approval-required',
      ),
    ).toBe(false);
  });
});
