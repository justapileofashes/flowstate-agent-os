import { describe, it, expect } from 'vitest';
import {
  shouldCheckpoint,
  dueForCheckpoint,
  checkpointLabel,
  DEFAULT_CHECKPOINT_GAP_MS,
} from '@main/agent/checkpoint-policy';

describe('shouldCheckpoint', () => {
  it('checkpoints before delete_file and run_shell', () => {
    expect(shouldCheckpoint('delete_file', { isOverwrite: false })).toBe(true);
    expect(shouldCheckpoint('run_shell', { isOverwrite: false })).toBe(true);
  });

  it('checkpoints write_file only when overwriting', () => {
    expect(shouldCheckpoint('write_file', { isOverwrite: true })).toBe(true);
    expect(shouldCheckpoint('write_file', { isOverwrite: false })).toBe(false);
  });

  it('does not checkpoint read-only tools', () => {
    for (const t of ['read_file', 'list_dir', 'search_files', 'web_search', 'brain_search']) {
      expect(shouldCheckpoint(t, { isOverwrite: false })).toBe(false);
    }
  });
});

describe('dueForCheckpoint', () => {
  it('is due on the first call (lastTs 0)', () => {
    expect(dueForCheckpoint(0, 1_000)).toBe(true);
  });

  it('is not due within the gap', () => {
    const now = 100_000;
    expect(dueForCheckpoint(now - 1_000, now)).toBe(false);
  });

  it('is due once the gap has passed', () => {
    const now = 100_000;
    expect(dueForCheckpoint(now - DEFAULT_CHECKPOINT_GAP_MS, now)).toBe(true);
    expect(dueForCheckpoint(now - DEFAULT_CHECKPOINT_GAP_MS - 1, now)).toBe(true);
  });

  it('honors a custom gap', () => {
    expect(dueForCheckpoint(1_000, 1_500, 1_000)).toBe(false);
    expect(dueForCheckpoint(1_000, 2_000, 1_000)).toBe(true);
  });
});

describe('checkpointLabel', () => {
  it('describes the tool that triggered it', () => {
    expect(checkpointLabel('delete_file')).toBe('auto: before delete_file');
  });
});
