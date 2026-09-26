import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { HookRunner } from '@main/agent/hook-runner';
import type { HookEntry } from '@main/services/plugin-types';

const hook = (command: string): HookEntry => ({ event: 'PreToolUse', command, pluginId: 'p1' });
const ctx = { toolName: 'run_shell', toolInput: { command: 'rm -rf x' }, cwd: tmpdir() };

describe('HookRunner (Claude Code hook contract)', () => {
  it('exit 2 blocks, with stderr as the reason', async () => {
    const r = new HookRunner(() => [hook(`node -e "process.stderr.write('not allowed'); process.exit(2)"`)]);
    await expect(r.fire('PreToolUse', ctx)).resolves.toEqual({ blocked: true, reason: 'not allowed' });
  }, 20_000);

  it('any other non-zero exit is a hook error, not a veto', async () => {
    const r = new HookRunner(() => [hook(`node -e "process.exit(1)"`)]);
    await expect(r.fire('PreToolUse', ctx)).resolves.toEqual({ blocked: false });
  }, 20_000);

  it('passes the event as JSON on stdin (tool_name, tool_input)', async () => {
    const script =
      "let s=''; process.stdin.on('data', d => s += d).on('end', () => { const j = JSON.parse(s); " +
      "process.stderr.write(j.hook_event_name + ':' + j.tool_name + ':' + j.tool_input.command); process.exit(2); })";
    const r = new HookRunner(() => [hook(`node -e "${script}"`)]);
    const out = await r.fire('PreToolUse', ctx);
    expect(out).toEqual({ blocked: true, reason: 'PreToolUse:run_shell:rm -rf x' });
  }, 20_000);

  it('honours a JSON "deny" verdict on stdout', async () => {
    const reply = "{hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'policy'}}";
    const r = new HookRunner(() => [hook(`node -e "process.stdout.write(JSON.stringify(${reply}))"`)]);
    await expect(r.fire('PreToolUse', ctx)).resolves.toEqual({ blocked: true, reason: 'policy' });
  }, 20_000);
});
