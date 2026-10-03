import { describe, it, expect } from 'vitest';
import { FILE_TOOL_SPECS, getToolSpecsForAgent } from '@main/agent/tool-specs';

describe('getToolSpecsForAgent toolsets', () => {
  const mcp = [{ name: 'mcp__gh__issue', description: 'x', parameters: { type: 'object' } }];
  const names = (groups?: string[]): string[] =>
    getToolSpecsForAgent({ shell_enabled: true, delete_enabled: true, ...(groups ? { groups } : {}) }, mcp).map(
      (s) => s.name,
    );

  it('an agent without groups keeps every tool (pre-toolset agents)', () => {
    const all = names();
    expect(all).toEqual(expect.arrayContaining(['propose_trade', 'generate_3d_model', 'brain_search', 'mcp__gh__issue']));
  });

  it('only the chosen groups, plus always-on file/shell tools', () => {
    const n = names(['web']);
    expect(n).toEqual(expect.arrayContaining(['read_file', 'edit_file', 'run_shell', 'run_code', 'web_search', 'fetch_url']));
    expect(n).not.toContain('propose_trade');
    expect(n).not.toContain('generate_3d_model');
    expect(n).not.toContain('brain_search');
    expect(n).not.toContain('mcp__gh__issue');
  });

  it('markets and connectors groups', () => {
    expect(names(['markets'])).toContain('stock_data');
    expect(names(['mcp'])).toContain('mcp__gh__issue');
  });
});

describe('FILE_TOOL_SPECS', () => {
  it('exports an array of 6 tools', () => {
    expect(FILE_TOOL_SPECS).toHaveLength(6);
  });

  it('includes all expected tool names', () => {
    const names = FILE_TOOL_SPECS.map((t) => t.name).sort();
    expect(names).toEqual(['delete_file', 'edit_file', 'list_dir', 'read_file', 'search_files', 'write_file']);
  });

  it('every tool has a non-empty description', () => {
    for (const spec of FILE_TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it('every tool has a JSON Schema object parameters field', () => {
    for (const spec of FILE_TOOL_SPECS) {
      expect(spec.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('write_file requires path and content', () => {
    const spec = FILE_TOOL_SPECS.find((t) => t.name === 'write_file');
    expect(spec).toBeDefined();
    const params = spec!.parameters as { required?: string[] };
    expect(params.required).toEqual(expect.arrayContaining(['path', 'content']));
  });

  it('search_files restricts kind to enum', () => {
    const spec = FILE_TOOL_SPECS.find((t) => t.name === 'search_files');
    const params = spec!.parameters as { properties: Record<string, { enum?: string[] }> };
    expect(params.properties.kind?.enum).toEqual(['name', 'content']);
  });
});
