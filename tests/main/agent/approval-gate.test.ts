import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '@main/agent/approval-gate';

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
