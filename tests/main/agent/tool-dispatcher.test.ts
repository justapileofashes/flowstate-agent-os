import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools';
import { ToolDispatcher, MAX_TOOL_OUTPUT_BYTES } from '@main/agent/tool-dispatcher';

let workspace: string;
let tools: FileTools;
let dispatcher: ToolDispatcher;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-disp-'));
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  writeFileSync(join(workspace, 'a.txt'), 'hello');
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'world');
  tools = new FileTools(workspace);
  dispatcher = new ToolDispatcher({ fileTools: tools, workspaceRoot: workspace });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('ToolDispatcher.call — happy paths', () => {
  it('read_file returns content', async () => {
    const r = await dispatcher.call('id1', 'read_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('hello');
    expect(r.toolCallId).toBe('id1');
    expect(r.toolName).toBe('read_file');
  });

  it('list_dir returns JSON array of entries', async () => {
    const r = await dispatcher.call('id2', 'list_dir', { path: '.' });
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(r.content) as Array<{ name: string; kind: string }>;
    const names = parsed.map((e) => e.name).sort();
    expect(names).toEqual(['a.txt', 'sub']);
  });

  it('write_file creates a file', async () => {
    const r = await dispatcher.call('id3', 'write_file', {
      path: 'new.txt',
      content: 'hi',
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.content)).toEqual({ created: true });
  });

  it('delete_file removes a file', async () => {
    const r = await dispatcher.call('id4', 'delete_file', { path: 'a.txt' });
    expect(r.ok).toBe(true);
    expect(r.content).toBe('ok');
  });

  it('search_files name mode returns hits as JSON', async () => {
    const r = await dispatcher.call('id5', 'search_files', {
      pattern: '*.txt',
      kind: 'name',
    });
    expect(r.ok).toBe(true);
    const hits = JSON.parse(r.content) as Array<{ path: string }>;
    expect(hits.map((h) => h.path).sort()).toEqual(['a.txt', 'sub/b.txt']);
  });
});

describe('ToolDispatcher.call — failures (returned, not thrown)', () => {
  it('unknown tool returns ok=false', async () => {
    const r = await dispatcher.call('x', 'nope_tool', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/unknown tool/);
  });

  it('missing required arg returns ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', {});
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('wrong arg type returns ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: 42 });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('invalid enum value for search_files.kind returns ok=false', async () => {
    const r = await dispatcher.call('x', 'search_files', {
      pattern: '*',
      kind: 'bogus',
    });
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/invalid args/);
  });

  it('FileTools error (e.g. ENOENT) returned as ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: 'missing.txt' });
    expect(r.ok).toBe(false);
    expect(r.content.length).toBeGreaterThan(0);
  });

  it('sandbox violation returned as ok=false', async () => {
    const r = await dispatcher.call('x', 'read_file', { path: '../escape' });
    expect(r.ok).toBe(false);
  });
});

describe('ToolDispatcher.call — output cap', () => {
  it('truncates read_file output above MAX_TOOL_OUTPUT_BYTES', async () => {
    const big = 'a'.repeat(MAX_TOOL_OUTPUT_BYTES + 50_000);
    writeFileSync(join(workspace, 'big.txt'), big);
    const r = await dispatcher.call('x', 'read_file', { path: 'big.txt' });
    expect(r.ok).toBe(true);
    expect(r.content.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES + 200);
    expect(r.content).toMatch(/truncated/);
  });
});
