import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileTools } from '@main/tools/file-tools';

let workspace: string;
let tools: FileTools;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'flowstate-ft-search-'));
  mkdirSync(join(workspace, 'src'), { recursive: true });
  mkdirSync(join(workspace, 'src', 'nested'), { recursive: true });
  writeFileSync(join(workspace, 'src', 'a.ts'), "console.log('hello world');\n");
  writeFileSync(join(workspace, 'src', 'b.ts'), 'export const x = 1;\n');
  writeFileSync(join(workspace, 'src', 'nested', 'c.ts'), "// hello\nimport x from 'y';\n");
  writeFileSync(join(workspace, 'README.md'), '# Project\nhello\n');
  tools = new FileTools(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('FileTools.searchFiles — name mode', () => {
  it('matches *.ts via glob', async () => {
    const hits = await tools.searchFiles({ pattern: '*.ts', kind: 'name' });
    const names = hits.map((h) => h.path).sort();
    expect(names).toEqual(['src/a.ts', 'src/b.ts', 'src/nested/c.ts']);
  });

  it('matches **/c.ts', async () => {
    const hits = await tools.searchFiles({ pattern: '**/c.ts', kind: 'name' });
    expect(hits.map((h) => h.path)).toEqual(['src/nested/c.ts']);
  });

  it('returns empty for no matches', async () => {
    const hits = await tools.searchFiles({ pattern: '*.py', kind: 'name' });
    expect(hits).toEqual([]);
  });
});

describe('FileTools.searchFiles — content mode', () => {
  it('finds regex matches with line numbers', async () => {
    const hits = await tools.searchFiles({ pattern: 'hello', kind: 'content' });
    const summary = hits.map((h) => `${h.path}:${h.line}`).sort();
    expect(summary).toContain('src/a.ts:1');
    expect(summary).toContain('src/nested/c.ts:1');
    expect(summary).toContain('README.md:2');
  });

  it('respects regex syntax', async () => {
    const hits = await tools.searchFiles({ pattern: '^export ', kind: 'content' });
    expect(hits.map((h) => h.path)).toEqual(['src/b.ts']);
  });

  it('returns empty for no matches', async () => {
    const hits = await tools.searchFiles({ pattern: 'xyzNotPresent', kind: 'content' });
    expect(hits).toEqual([]);
  });

  it('skips files larger than 1MB', async () => {
    const big = 'a'.repeat(1_100_000);
    writeFileSync(join(workspace, 'huge.txt'), big);
    const hits = await tools.searchFiles({ pattern: 'a', kind: 'content' });
    expect(hits.find((h) => h.path === 'huge.txt')).toBeUndefined();
  });
});
