import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { getToolSpecsForAgent, buildSkillToolSpec } from '@main/agent/tool-specs';
import { HookRunner } from '@main/agent/hook-runner';
import type { HookEntry } from '@main/services/plugin-types';

const perms = { shell_enabled: false, delete_enabled: false };

describe('getToolSpecsForAgent skill tool', () => {
  it('omits the skill tool when no skills are available', () => {
    const specs = getToolSpecsForAgent(perms, [], []);
    expect(specs.find((s) => s.name === 'skill')).toBeUndefined();
  });

  it('includes the skill tool with available names as an enum', () => {
    const specs = getToolSpecsForAgent(perms, [], [{ name: 'greeter' }, { name: 'coder' }]);
    const skill = specs.find((s) => s.name === 'skill');
    expect(skill).toBeTruthy();
    const enumVals = (skill!.parameters as { properties: { name: { enum: string[] } } }).properties
      .name.enum;
    expect(enumVals).toEqual(['greeter', 'coder']);
  });
});

describe('buildSkillToolSpec', () => {
  it('requires a name parameter', () => {
    const spec = buildSkillToolSpec([{ name: 'x' }]);
    expect((spec.parameters as { required: string[] }).required).toContain('name');
  });
});

describe('HookRunner', () => {
  const ctx = { cwd: tmpdir(), toolName: 'run_shell', agentId: 'a1' };

  it('blocks a PreToolUse tool call when the hook exits non-zero', async () => {
    const hooks: HookEntry[] = [{ event: 'PreToolUse', command: 'exit 3', pluginId: 'p' }];
    const runner = new HookRunner(() => hooks);
    const out = await runner.fire('PreToolUse', ctx);
    expect(out.blocked).toBe(true);
  });

  it('does not block when the hook exits zero', async () => {
    const hooks: HookEntry[] = [{ event: 'PreToolUse', command: 'exit 0', pluginId: 'p' }];
    const runner = new HookRunner(() => hooks);
    const out = await runner.fire('PreToolUse', ctx);
    expect(out.blocked).toBe(false);
  });

  it('respects the matcher (non-matching tool is skipped)', async () => {
    const hooks: HookEntry[] = [
      { event: 'PreToolUse', matcher: 'write_file', command: 'exit 1', pluginId: 'p' },
    ];
    const runner = new HookRunner(() => hooks);
    const out = await runner.fire('PreToolUse', { ...ctx, toolName: 'read_file' });
    expect(out.blocked).toBe(false);
  });

  it('PostToolUse never blocks regardless of exit code', async () => {
    const hooks: HookEntry[] = [{ event: 'PostToolUse', command: 'exit 9', pluginId: 'p' }];
    const runner = new HookRunner(() => hooks);
    const out = await runner.fire('PostToolUse', ctx);
    expect(out.blocked).toBe(false);
  });
});
