import { describe, it, expect } from 'vitest';
import {
  parseUserCommands,
  serializeUserCommands,
  applyUserCommand,
  isCommandTaken,
  type UserCommand,
} from '@main/services/user-commands';

const ship: UserCommand = {
  cmd: '/ship',
  label: 'Ship it',
  hint: 'commit + PR',
  template: 'Prepare to ship: {{input}}. Run tests first.',
};

describe('parse/serialize user commands', () => {
  it('round-trips', () => {
    expect(parseUserCommands(serializeUserCommands([ship]))).toEqual([ship]);
  });

  it('defaults missing hint to empty string', () => {
    const json = JSON.stringify([{ cmd: '/x', label: 'X', template: 'do {{input}}' }]);
    expect(parseUserCommands(json)[0]!.hint).toBe('');
  });

  it('returns [] for garbage or bad trigger', () => {
    expect(parseUserCommands(null)).toEqual([]);
    expect(parseUserCommands('[{"cmd":"noSlash","label":"x","template":"y"}]')).toEqual([]);
  });
});

describe('applyUserCommand', () => {
  it('frames a matching command, injecting the rest as input', () => {
    expect(applyUserCommand('/ship the auth refactor', [ship])).toBe(
      'Prepare to ship: the auth refactor. Run tests first.',
    );
  });

  it('is case-insensitive on the trigger', () => {
    expect(applyUserCommand('/SHIP x', [ship])).toContain('Prepare to ship: x');
  });

  it('handles a command with no args', () => {
    expect(applyUserCommand('/ship', [ship])).toBe('Prepare to ship: . Run tests first.');
  });

  it('appends rest when template lacks {{input}}', () => {
    const c: UserCommand = { cmd: '/n', label: 'n', hint: '', template: 'Note this' };
    expect(applyUserCommand('/n hello', [c])).toBe('Note this\n\nhello');
  });

  it('returns null for non-commands and unknown commands', () => {
    expect(applyUserCommand('just a message', [ship])).toBeNull();
    expect(applyUserCommand('/unknown', [ship])).toBeNull();
  });
});

describe('isCommandTaken', () => {
  it('flags collisions with reserved and existing (case-insensitive)', () => {
    expect(isCommandTaken('/plan', ['/plan'], [])).toBe(true);
    expect(isCommandTaken('/SHIP', [], [ship])).toBe(true);
    expect(isCommandTaken('/fresh', ['/plan'], [ship])).toBe(false);
  });
});
