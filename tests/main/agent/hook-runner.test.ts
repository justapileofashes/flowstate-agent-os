import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { HookRunner, claudeCodeTool, matcherMatches } from '@main/agent/hook-runner';
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
    // Hooks come from Claude Code plugins, so they see CC's tool name.
    expect(out).toEqual({ blocked: true, reason: 'PreToolUse:Bash:rm -rf x' });
  }, 20_000);

  it('a CC "Edit|Write" hook fires on write_file and reads tool_input.file_path', async () => {
    const script =
      "let s=''; process.stdin.on('data', d => s += d).on('end', () => { const j = JSON.parse(s); " +
      "process.stderr.write(j.tool_name + ':' + j.tool_input.file_path); process.exit(2); })";
    const r = new HookRunner(() => [{ ...hook(`node -e "${script}"`), matcher: 'Edit|Write' }]);
    const out = await r.fire('PreToolUse', {
      toolName: 'write_file',
      toolInput: { path: 'src/a.ts', content: 'x' },
      cwd: tmpdir(),
    });
    expect(out).toEqual({ blocked: true, reason: 'Write:src/a.ts' });
  }, 20_000);

  it('honours a JSON "deny" verdict on stdout', async () => {
    const reply = "{hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'policy'}}";
    const r = new HookRunner(() => [hook(`node -e "process.stdout.write(JSON.stringify(${reply}))"`)]);
    await expect(r.fire('PreToolUse', ctx)).resolves.toEqual({ blocked: true, reason: 'policy' });
  }, 20_000);
});

describe('Claude Code tool aliases', () => {
  it('maps our tools to CC names', () => {
    expect(claudeCodeTool('run_shell', { command: 'ls' })).toEqual({ name: 'Bash', input: { command: 'ls' } });
    expect(claudeCodeTool('read_file', { path: 'a' }).name).toBe('Read');
    expect(claudeCodeTool('edit_file', { path: 'a' }).name).toBe('Edit');
    expect(claudeCodeTool('search_files', { pattern: 'x', kind: 'content' }).name).toBe('Grep');
    expect(claudeCodeTool('search_files', { pattern: '*.ts', kind: 'name' }).name).toBe('Glob');
    expect(claudeCodeTool('web_search', { query: 'q' }).name).toBe('WebSearch');
    expect(claudeCodeTool('fetch_url', { url: 'u' }).name).toBe('WebFetch');
  });

  it('adds file_path next to path, and parses JSON-string args', () => {
    expect(claudeCodeTool('write_file', '{"path":"a.ts","content":"x"}').input).toEqual({
      path: 'a.ts',
      content: 'x',
      file_path: 'a.ts',
    });
  });

  it('passes unknown and MCP tools through unchanged', () => {
    expect(claudeCodeTool('mcp__github__create_issue', { a: 1 })).toEqual({
      name: 'mcp__github__create_issue',
      input: { a: 1 },
    });
    expect(claudeCodeTool('run_code', 'raw')).toEqual({ name: 'run_code', input: 'raw' });
  });
});

describe('matcherMatches (CC semantics)', () => {
  const shell = ['run_shell', 'Bash'];
  it('plain names and a|b lists match exactly', () => {
    expect(matcherMatches('Bash', shell)).toBe(true);
    expect(matcherMatches('run_shell', shell)).toBe(true);
    expect(matcherMatches('Edit|Write', ['write_file', 'Write'])).toBe(true);
    expect(matcherMatches('Edit', ['notebook', 'NotebookEdit'])).toBe(false);
    expect(matcherMatches('Write', shell)).toBe(false);
  });

  it('empty or * matches everything; anything else is a regex', () => {
    expect(matcherMatches(undefined, shell)).toBe(true);
    expect(matcherMatches('*', shell)).toBe(true);
    expect(matcherMatches('mcp__github__.*', ['mcp__github__create_issue'])).toBe(true);
    expect(matcherMatches('Notebook.*', shell)).toBe(false);
  });

  it('an invalid regex only matches its literal name', () => {
    expect(matcherMatches('Bash(', shell)).toBe(false);
    expect(matcherMatches('Bash(', ['Bash('])).toBe(true);
  });
});
