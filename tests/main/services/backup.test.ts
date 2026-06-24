import { describe, it, expect } from 'vitest';
import { buildBackup, parseBackup, BACKUP_KIND, type BackupAgent } from '@main/services/backup';

const agent: BackupAgent = {
  name: 'Helper',
  description: 'x',
  specialtyTags: ['a'],
  systemPrompt: 'do things',
  model: 'llama3',
  avatarColor: '#fff',
  toolPerms: { shell_enabled: false, delete_enabled: false },
  approvalPolicy: 'cautious',
};

describe('buildBackup', () => {
  it('round-trips agents + non-secret settings', () => {
    const b = buildBackup([agent], [{ key: 'theme', value: 'dark' }], 123);
    expect(b.kind).toBe(BACKUP_KIND);
    expect(b.agents).toHaveLength(1);
    expect(b.settings.theme).toBe('dark');
    expect(parseBackup(JSON.stringify(b))).toEqual(b);
  });

  it('excludes secret + machine-local settings', () => {
    const b = buildBackup(
      [],
      [
        { key: 'anthropic_api_key', value: 'sk-secret' },
        { key: 'license.jwt', value: 'tok' },
        { key: 'chat_model_override:abc', value: 'gpt' },
        { key: 'personas_v1', value: '[]' },
      ],
    );
    expect(b.settings.anthropic_api_key).toBeUndefined();
    expect(b.settings['license.jwt']).toBeUndefined();
    expect(b.settings['chat_model_override:abc']).toBeUndefined();
    expect(b.settings.personas_v1).toBe('[]');
  });
});

describe('parseBackup', () => {
  it('rejects non-JSON and wrong shape', () => {
    expect(() => parseBackup('not json')).toThrow(/parse JSON/);
    expect(() => parseBackup('{"kind":"other"}')).toThrow(/valid FlowState backup/);
  });

  it('rejects a newer version', () => {
    const b = { ...buildBackup([agent], []), version: 999 };
    expect(() => parseBackup(JSON.stringify(b))).toThrow(/newer version/);
  });

  it('strips secrets even if a hand-edited file added them', () => {
    const tampered = { ...buildBackup([], []), settings: { anthropic_api_key: 'sk-x', theme: 'dark' } };
    const out = parseBackup(JSON.stringify(tampered));
    expect(out.settings.anthropic_api_key).toBeUndefined();
    expect(out.settings.theme).toBe('dark');
  });
});
