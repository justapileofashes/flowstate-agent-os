import { describe, it, expect } from 'vitest';
import { SLASH_COMMANDS, applySlashCommand } from '../../src/renderer/src/chat/slash-commands';

describe('SLASH_COMMANDS catalog', () => {
  it('has unique command triggers', () => {
    const cmds = SLASH_COMMANDS.map((c) => c.cmd);
    expect(new Set(cmds).size).toBe(cmds.length);
  });

  it('every command trigger is a lowercase /word', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.cmd).toMatch(/^\/[a-z0-9]+$/);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.hint.length).toBeGreaterThan(0);
    }
  });

  it('nav commands produce empty framing; framing commands produce text', () => {
    for (const c of SLASH_COMMANDS) {
      if (c.nav) expect(c.framing('anything')).toBe('');
      else expect(c.framing('do the thing').length).toBeGreaterThan(0);
    }
  });
});

describe('applySlashCommand', () => {
  it('frames a known command and injects the rest', () => {
    const { text, command } = applySlashCommand('/fix the login 500');
    expect(command?.cmd).toBe('/fix');
    expect(text).toContain('the login 500');
    expect(text).toContain('[Fix mode]');
  });

  it('matches longest command first (/ultrareview not /review)', () => {
    const { command } = applySlashCommand('/ultrareview the auth module');
    expect(command?.cmd).toBe('/ultrareview');
  });

  it('returns the nav command without sending framing', () => {
    const { command, text } = applySlashCommand('/settings');
    expect(command?.nav).toBe('settings');
    expect(text).toBe('');
  });

  it('uses the recent-changes default when no target given', () => {
    const { text } = applySlashCommand('/review');
    expect(text).toMatch(/recent changes/i);
  });

  it('leaves a non-command untouched', () => {
    const { text, command } = applySlashCommand('just a normal prompt');
    expect(command).toBeNull();
    expect(text).toBe('just a normal prompt');
  });

  it('does not match a command embedded mid-text', () => {
    const { command } = applySlashCommand('please /fix this');
    expect(command).toBeNull();
  });
});
