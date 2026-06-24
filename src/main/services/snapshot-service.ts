// Workspace snapshots — periodic file-state checkpoints so the user can
// rewind after an agent makes a destructive change. Each snapshot is a
// shallow copy of the workspace's tracked files (skipping common heavy
// dirs) under <userData>/snapshots/<agentId>/<snapshotId>.
//
// Not a full VCS — just enough to undo "the agent deleted the wrong file".
// Limited to MAX_SNAPSHOTS per agent; oldest get pruned automatically.

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';

export interface SnapshotMeta {
  id: string;
  agentId: string;
  workspacePath: string;
  label: string;
  createdAt: number;
  fileCount: number;
  bytes: number;
}

const MAX_SNAPSHOTS_PER_AGENT = 25;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.next',
  '__pycache__',
  'target',
  '.venv',
  'venv',
  '.cache',
  'win-unpacked',
]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

function snapshotsRoot(): string {
  return join(app.getPath('userData'), 'snapshots');
}

interface CopyStats {
  files: number;
  bytes: number;
  capped: boolean;
}

async function copyTree(
  srcRoot: string,
  srcRel: string,
  dstRoot: string,
  stats: CopyStats,
): Promise<void> {
  if (stats.bytes >= MAX_TOTAL_BYTES) {
    stats.capped = true;
    return;
  }
  const srcDir = join(srcRoot, srcRel);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(srcDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const childRel = srcRel ? `${srcRel}/${e.name}` : e.name;
    const srcPath = join(srcRoot, childRel);
    const dstPath = join(dstRoot, childRel);
    if (e.isDirectory()) {
      await copyTree(srcRoot, childRel, dstRoot, stats);
      if (stats.capped) return;
    } else if (e.isFile()) {
      try {
        const stat = await fs.stat(srcPath);
        if (stat.size > MAX_FILE_BYTES) continue;
        if (stats.bytes + stat.size > MAX_TOTAL_BYTES) {
          stats.capped = true;
          return;
        }
        await fs.mkdir(join(dstPath, '..'), { recursive: true });
        await fs.copyFile(srcPath, dstPath);
        stats.bytes += stat.size;
        stats.files += 1;
      } catch {
        // skip individual file errors
      }
    }
  }
}

export class SnapshotService {
  async create(opts: {
    agentId: string;
    workspacePath: string;
    label: string;
  }): Promise<SnapshotMeta> {
    const id = randomUUID();
    const dest = join(snapshotsRoot(), opts.agentId, id, 'files');
    await fs.mkdir(dest, { recursive: true });

    const stats: CopyStats = { files: 0, bytes: 0, capped: false };
    await copyTree(opts.workspacePath, '', dest, stats);

    const meta: SnapshotMeta = {
      id,
      agentId: opts.agentId,
      workspacePath: opts.workspacePath,
      label: opts.label.slice(0, 120) + (stats.capped ? ' (capped)' : ''),
      createdAt: Date.now(),
      fileCount: stats.files,
      bytes: stats.bytes,
    };
    await fs.writeFile(
      join(snapshotsRoot(), opts.agentId, id, 'meta.json'),
      JSON.stringify(meta),
      'utf8',
    );

    await this.pruneOld(opts.agentId);
    return meta;
  }

  async list(agentId: string): Promise<SnapshotMeta[]> {
    const dir = join(snapshotsRoot(), agentId);
    if (!existsSync(dir)) return [];
    const ids = await fs.readdir(dir).catch(() => []);
    const out: SnapshotMeta[] = [];
    for (const id of ids) {
      try {
        const raw = await fs.readFile(join(dir, id, 'meta.json'), 'utf8');
        const meta = JSON.parse(raw) as SnapshotMeta;
        out.push(meta);
      } catch {
        // skip corrupt
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  async restore(
    agentId: string,
    snapshotId: string,
  ): Promise<{ filesRestored: number }> {
    const snapshotDir = join(snapshotsRoot(), agentId, snapshotId, 'files');
    if (!existsSync(snapshotDir)) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    const metaRaw = await fs.readFile(
      join(snapshotsRoot(), agentId, snapshotId, 'meta.json'),
      'utf8',
    );
    const meta = JSON.parse(metaRaw) as SnapshotMeta;
    const target = meta.workspacePath;
    const stats: CopyStats = { files: 0, bytes: 0, capped: false };
    await copyTree(snapshotDir, '', target, stats);
    return { filesRestored: stats.files };
  }

  async delete(agentId: string, snapshotId: string): Promise<void> {
    const dir = join(snapshotsRoot(), agentId, snapshotId);
    await fs.rm(dir, { recursive: true, force: true });
  }

  private async pruneOld(agentId: string): Promise<void> {
    const all = await this.list(agentId);
    if (all.length <= MAX_SNAPSHOTS_PER_AGENT) return;
    const toDelete = all.slice(MAX_SNAPSHOTS_PER_AGENT);
    for (const m of toDelete) {
      await this.delete(agentId, m.id);
    }
  }
}
