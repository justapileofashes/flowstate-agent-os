import { describe, it, expect } from 'vitest';
import { decideNotification } from '@main/services/notify';

describe('decideNotification', () => {
  it('notifies on tool-approval-required with the tool name', () => {
    const n = decideNotification({
      type: 'tool-approval-required',
      toolCallId: 't1',
      toolName: 'run_shell',
      args: { command: 'npm test' },
      cwd: 'C:/ws',
    });
    expect(n).not.toBeNull();
    expect(n!.title).toMatch(/approval/i);
    expect(n!.body).toContain('run_shell');
  });

  it('redacts secrets leaking through approval args', () => {
    const n = decideNotification({
      type: 'tool-approval-required',
      toolCallId: 't1',
      toolName: 'run_shell',
      args: { command: 'curl -H "authorization: Bearer abc123DEF456ghi"' },
      cwd: 'C:/ws',
    });
    expect(n!.body).not.toContain('abc123DEF456ghi');
  });

  it('notifies when a run finishes', () => {
    const n = decideNotification({ type: 'turn-done', reason: 'end' });
    expect(n).not.toBeNull();
    expect(n!.title).toMatch(/finished/i);
  });

  it('notifies on run errors with the message', () => {
    const n = decideNotification({ type: 'turn-done', reason: 'error', error: 'model exploded' });
    expect(n).not.toBeNull();
    expect(n!.body).toContain('model exploded');
  });

  it('stays silent on user-initiated aborts', () => {
    expect(decideNotification({ type: 'turn-done', reason: 'aborted' })).toBeNull();
  });

  it('ignores stream noise and junk payloads', () => {
    expect(decideNotification({ type: 'text-delta', text: 'hi' })).toBeNull();
    expect(decideNotification({ type: 'token-usage', promptTokens: 1, completionTokens: 2 })).toBeNull();
    expect(decideNotification(null)).toBeNull();
    expect(decideNotification('nope')).toBeNull();
    expect(decideNotification({})).toBeNull();
  });

  it('caps body length', () => {
    const n = decideNotification({
      type: 'tool-approval-required',
      toolCallId: 't1',
      toolName: 'write_file',
      args: { content: 'x'.repeat(5000) },
      cwd: 'C:/ws',
    });
    expect(n!.body.length).toBeLessThanOrEqual(200);
  });
});
