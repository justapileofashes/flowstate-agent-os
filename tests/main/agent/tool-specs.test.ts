import { describe, it, expect } from 'vitest';
import { FILE_TOOL_SPECS } from '@main/agent/tool-specs';

describe('FILE_TOOL_SPECS', () => {
  it('exports an array of 5 tools', () => {
    expect(FILE_TOOL_SPECS).toHaveLength(5);
  });

  it('includes all expected tool names', () => {
    const names = FILE_TOOL_SPECS.map((t) => t.name).sort();
    expect(names).toEqual(['delete_file', 'list_dir', 'read_file', 'search_files', 'write_file']);
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
