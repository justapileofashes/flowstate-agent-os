// "Install from anywhere" for the Plugins screen: turn whatever the user typed
// or picked (GitHub shorthand, a git URL, a folder, a .zip/.plugin/.skill
// archive) into a directory on disk, then work out what it holds — a
// marketplace, a plugin, or loose SKILL.md skills. Also lists the skill folders
// other coding agents keep, so their skills can be reused read-only.

import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { unzipSync } from 'fflate';

export type InstallSource =
  | { kind: 'git'; url: string; ref?: string; subpath?: string; label: string }
  | { kind: 'path'; path: string; label: string };

const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const REF_RE = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/;

function cleanSubpath(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parts = raw.split(/[\\/]+/).filter(Boolean);
  if (parts.some((p) => p === '..' || p === '.')) throw new Error('The sub-folder can\'t contain "." or ".." segments.');
  return parts.length ? parts.join('/') : undefined;
}

function checkRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (!REF_RE.test(ref) || ref.includes('..')) throw new Error(`"${ref}" isn't a valid branch, tag or commit.`);
  return ref;
}

/**
 * Accepts:
 *   owner/repo · owner/repo#ref · owner/repo/sub/folder · owner/repo/sub/folder#ref
 *   https://github.com/owner/repo[/tree|blob/<ref>/<sub/folder>]
 *   any other git URL (https, ssh, git@…), optionally with #ref
 *   an absolute path to a folder or a .zip / .plugin / .skill file
 */
export function parseInstallSource(input: string): InstallSource {
  const s = input.trim().replace(/^["']|["']$/g, '');
  if (!s) throw new Error('Enter a GitHub repo, git URL, folder or zip path.');
  if (s.startsWith('-')) throw new Error('A source can\'t start with "-".');

  if (isAbsolute(s) || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\')) {
    return { kind: 'path', path: normalize(s), label: basename(s) };
  }
  if (s.startsWith('.') || s.startsWith('~')) throw new Error('Use the full (absolute) path to a folder or zip.');

  const gh = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/(tree|blob)\/([^/#?]+)(?:\/([^#?]*))?)?\/?(?:[?#].*)?$/.exec(s);
  if (gh) {
    const [, owner, repo, kind, ref, sub] = gh;
    if (!NAME_RE.test(owner!) || !NAME_RE.test(repo!)) throw new Error('That GitHub URL doesn\'t look right.');
    // A link to a file (…/blob/main/skills/x/SKILL.md) means its folder.
    let subpath = cleanSubpath(sub ? decodeURIComponent(sub) : undefined);
    if (subpath && kind === 'blob' && /\.[a-z0-9]+$/i.test(subpath)) {
      const dir = dirname(subpath).replace(/\\/g, '/');
      subpath = dir === '.' ? undefined : dir;
    }
    const out: InstallSource = { kind: 'git', url: `https://github.com/${owner}/${repo}.git`, label: `${owner}/${repo}` };
    const r = checkRef(ref);
    if (r) out.ref = r;
    if (subpath) {
      out.subpath = subpath;
      out.label += `/${subpath}`;
    }
    return out;
  }

  if (/^(https?:\/\/|ssh:\/\/|git@)/.test(s) || /\.git(#.*)?$/.test(s)) {
    const [url, ref] = s.split('#', 2) as [string, string | undefined];
    const out: InstallSource = { kind: 'git', url, label: url.replace(/^.*[/:]([^/:]+\/[^/]+?)(\.git)?$/, '$1') };
    const r = checkRef(ref);
    if (r) out.ref = r;
    return out;
  }

  const short = /^(?:github:)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)((?:\/[^#]+)?)(?:#(.+))?$/.exec(s);
  if (short) {
    const [, owner, repo, sub, ref] = short;
    const out: InstallSource = {
      kind: 'git',
      url: `https://github.com/${owner}/${repo!.replace(/\.git$/, '')}.git`,
      label: `${owner}/${repo!.replace(/\.git$/, '')}`,
    };
    const subpath = cleanSubpath(sub);
    if (subpath) {
      out.subpath = subpath;
      out.label += `/${subpath}`;
    }
    const r = checkRef(ref);
    if (r) out.ref = r;
    return out;
  }

  throw new Error('Use owner/repo, a git URL, or an absolute folder / zip path.');
}

// ── Archives ────────────────────────────────────────────────────────────────

export const ARCHIVE_EXTS = ['.zip', '.plugin', '.skill'];
const MAX_ENTRIES = 5_000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export function isArchive(path: string): boolean {
  const lower = path.toLowerCase();
  return ARCHIVE_EXTS.some((e) => lower.endsWith(e));
}

/** Where an archive entry may land, or null when it would escape `destDir`. */
export function safeEntryPath(destDir: string, entry: string): string | null {
  const name = entry.replace(/\\/g, '/');
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/').filter(Boolean);
  if (parts.some((p) => p === '..')) return null;
  const target = join(destDir, ...parts);
  const rel = relative(destDir, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return target;
}

/** Extract a zip into `destDir` (zip-slip guarded, size capped). */
export async function extractArchive(archivePath: string, destDir: string): Promise<void> {
  const data = new Uint8Array(await fs.readFile(archivePath));
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data);
  } catch (err) {
    throw new Error(`Not a readable zip archive: ${err instanceof Error ? err.message : String(err)}`);
  }
  const names = Object.keys(files);
  if (names.length > MAX_ENTRIES) throw new Error(`Archive has too many files (${names.length}).`);
  let total = 0;
  for (const n of names) total += files[n]!.length;
  if (total > MAX_TOTAL_BYTES) throw new Error('Archive is too large (over 200 MB unpacked).');
  await fs.mkdir(destDir, { recursive: true });
  for (const n of names) {
    if (n.endsWith('/')) continue; // directory entry
    if (n.startsWith('__MACOSX/')) continue;
    const target = safeEntryPath(destDir, n);
    if (!target) throw new Error(`Archive entry "${n}" points outside the install folder — refusing to extract.`);
    await fs.mkdir(dirname(target), { recursive: true });
    await fs.writeFile(target, files[n]!);
  }
}

/** Zips often wrap everything in one top folder; descend into it. */
export async function unwrapSingleDir(dir: string): Promise<string> {
  let current = dir;
  for (let i = 0; i < 3; i++) {
    const entries = (await fs.readdir(current, { withFileTypes: true })).filter(
      (e) => !e.name.startsWith('.') || e.name === '.claude-plugin',
    );
    if (entries.length !== 1 || !entries[0]!.isDirectory() || entries[0]!.name === '.claude-plugin') break;
    current = join(current, entries[0]!.name);
  }
  return current;
}

// ── Detection ───────────────────────────────────────────────────────────────

export type DetectedContent =
  | { type: 'marketplace'; manifest: string }
  | { type: 'plugin' }
  | { type: 'skills'; dirs: string[] }
  | { type: 'none' };

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '__pycache__', '.venv']);

/** Folders holding a SKILL.md, up to `maxDepth` below `root`; never descends into a skill. */
export async function findSkillDirs(root: string, maxDepth = 4): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (await exists(join(dir, 'SKILL.md'))) {
      out.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
      await walk(join(dir, e.name), depth + 1);
    }
  };
  await walk(root, 0);
  return out.sort();
}

export async function detectContent(dir: string): Promise<DetectedContent> {
  for (const m of [join(dir, '.claude-plugin', 'marketplace.json'), join(dir, 'marketplace.json')]) {
    if (await exists(m)) return { type: 'marketplace', manifest: m };
  }
  if (await exists(join(dir, '.claude-plugin', 'plugin.json'))) return { type: 'plugin' };
  // A plugin without a manifest still has the plugin layout.
  for (const marker of ['commands', 'agents', join('hooks', 'hooks.json'), '.mcp.json']) {
    if (await exists(join(dir, marker))) return { type: 'plugin' };
  }
  const dirs = await findSkillDirs(dir);
  if (dirs.length) return { type: 'skills', dirs };
  return { type: 'none' };
}

// ── Other agents' skill folders ─────────────────────────────────────────────

export interface SkillSourceDef {
  id: string;
  label: string;
  /** Folders to search for SKILL.md (missing ones are skipped). */
  roots: string[];
  /** On by default — only Claude Code's, which Flowstate always read. */
  defaultEnabled: boolean;
}

/** Skill folders of coding agents Flowstate knows about (paths under `home`). */
export function knownSkillSources(home: string): SkillSourceDef[] {
  const h = (...p: string[]): string => join(home, ...p);
  return [
    { id: 'claude', label: 'Claude Code', roots: [h('.claude', 'skills')], defaultEnabled: true },
    { id: 'agents', label: 'Shared agent skills (~/.agents)', roots: [h('.agents', 'skills')], defaultEnabled: false },
    { id: 'codex', label: 'Codex CLI', roots: [h('.codex', 'skills')], defaultEnabled: false },
    { id: 'gemini', label: 'Gemini CLI', roots: [h('.gemini', 'skills'), h('.gemini', 'extensions')], defaultEnabled: false },
    {
      id: 'opencode',
      label: 'opencode',
      roots: [h('.config', 'opencode', 'skills'), h('.config', 'opencode', 'skill')],
      defaultEnabled: false,
    },
    { id: 'cursor', label: 'Cursor', roots: [h('.cursor', 'skills')], defaultEnabled: false },
    { id: 'copilot', label: 'GitHub Copilot', roots: [h('.copilot', 'skills')], defaultEnabled: false },
  ];
}
