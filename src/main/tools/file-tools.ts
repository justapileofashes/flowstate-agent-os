import { readFile, readdir, stat, writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { resolveSafe, resolveSafeReal } from './path-sandbox';

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir' | 'other';
}

export interface WriteResult {
  created: boolean;
}

export type SearchKind = 'name' | 'content';

export interface SearchOptions {
  pattern: string;
  kind: SearchKind;
}

export interface SearchHit {
  path: string;
  line?: number;
  preview?: string;
}

const MAX_WALK_FILES = 5000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_HITS = 200;
const TEXT_PROBE_BYTES = 512;

function globToRegex(glob: string): RegExp {
  // User-friendly glob: '*' matches across path components (so '*.ts'
  // finds .ts files anywhere). '**' is equivalent. '?' matches a single
  // character. This is more permissive than POSIX glob semantics and
  // chosen so agents writing simple patterns get expected results.
  const special = /[.+^${}()|[\]\\]/g;
  let pattern = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i += 2;
      if (glob[i] === '/') i += 1;
    } else if (ch === '*') {
      pattern += '.*';
      i += 1;
    } else if (ch === '?') {
      pattern += '.';
      i += 1;
    } else {
      pattern += (ch ?? '').replace(special, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function looksBinary(buf: Buffer): boolean {
  for (let i = 0; i < Math.min(buf.length, TEXT_PROBE_BYTES); i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

export class FileTools {
  constructor(private readonly workspaceRoot: string) {}

  async readFile(relPath: string): Promise<string> {
    const full = await resolveSafeReal(this.workspaceRoot, relPath);
    const s = await stat(full);
    if (s.isDirectory()) {
      throw new Error(`refusing to read directory: ${relPath}`);
    }
    return readFile(full, 'utf8');
  }

  async listDir(relPath: string): Promise<DirEntry[]> {
    const full = await resolveSafeReal(this.workspaceRoot, relPath);
    const s = await stat(full);
    if (!s.isDirectory()) {
      throw new Error(`not a directory: ${relPath}`);
    }
    const dirents = await readdir(full, { withFileTypes: true });
    return dirents
      .map((d) => {
        let kind: DirEntry['kind'];
        if (d.isFile()) kind = 'file';
        else if (d.isDirectory()) kind = 'dir';
        else kind = 'other';
        return { name: d.name, kind };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async writeFile(relPath: string, content: string): Promise<WriteResult> {
    const full = resolveSafe(this.workspaceRoot, relPath);

    let existed = false;
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        throw new Error(`refusing to overwrite directory: ${relPath}`);
      }
      existed = true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }

    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
    return { created: !existed };
  }

  async deleteFile(relPath: string): Promise<void> {
    const full = await resolveSafeReal(this.workspaceRoot, relPath);
    const s = await stat(full);
    if (s.isDirectory()) {
      throw new Error(`refusing to delete directory: ${relPath}`);
    }
    await unlink(full);
  }

  async searchFiles(opts: SearchOptions): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    const files: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      if (files.length >= MAX_WALK_FILES) return;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const d of dirents) {
        if (files.length >= MAX_WALK_FILES) return;
        const full = join(dir, d.name);
        if (d.isDirectory()) {
          if (d.name === 'node_modules' || d.name === '.git') continue;
          await walk(full);
        } else if (d.isFile()) {
          files.push(full);
        }
      }
    };

    await walk(this.workspaceRoot);

    if (opts.kind === 'name') {
      const re = globToRegex(opts.pattern);
      for (const f of files) {
        const rel = relative(this.workspaceRoot, f).split(sep).join('/');
        if (re.test(rel)) {
          hits.push({ path: rel });
          if (hits.length >= MAX_HITS) break;
        }
      }
      return hits;
    }

    const re = new RegExp(opts.pattern);
    for (const f of files) {
      if (hits.length >= MAX_HITS) break;
      let buf: Buffer;
      try {
        buf = await readFile(f);
      } catch {
        continue;
      }
      if (buf.length > MAX_FILE_BYTES) continue;
      if (looksBinary(buf)) continue;
      const text = buf.toString('utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (typeof line === 'string' && re.test(line)) {
          const rel = relative(this.workspaceRoot, f).split(sep).join('/');
          hits.push({ path: rel, line: i + 1, preview: line.slice(0, 200) });
          if (hits.length >= MAX_HITS) break;
        }
      }
    }
    return hits;
  }
}
