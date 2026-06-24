// Second Brain — an Obsidian-compatible vault that lives on disk as plain
// .md files with YAML frontmatter. Strict PARA-like folder structure so
// the user can open the same folder in Obsidian and get sensible
// out-of-the-box behavior (graph view + wiki-links + daily notes).
//
// Layout:
//   <vault>/
//     0_Inbox/           — quick capture, processed weekly
//     1_Projects/        — finite outcome + deadline
//     2_Areas/           — ongoing responsibilities
//     3_Resources/       — topics, knowledge, skills
//     4_Archive/         — completed / inactive
//     Daily/             — daily notes (Daily/YYYY-MM-DD.md)
//     Routines/          — auto-detected recurring patterns
//     Templates/         — Obsidian-style templates
//     .obsidian/         — Obsidian workspace config (created lazily)

import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve, relative, sep, basename, dirname } from 'node:path';

export type BrainCategory =
  | 'inbox'
  | 'projects'
  | 'areas'
  | 'resources'
  | 'archive'
  | 'daily'
  | 'routines';

const FOLDERS: Record<BrainCategory, string> = {
  inbox: '0_Inbox',
  projects: '1_Projects',
  areas: '2_Areas',
  resources: '3_Resources',
  archive: '4_Archive',
  daily: 'Daily',
  routines: 'Routines',
};

const TEMPLATES_DIR = 'Templates';

export interface BrainNote {
  /** Path relative to vault root, forward-slash separated. */
  relPath: string;
  title: string;
  category: BrainCategory | 'other';
  tags: string[];
  links: string[];
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface BrainListEntry {
  relPath: string;
  title: string;
  category: BrainCategory | 'other';
  tags: string[];
  updatedAt: number;
}

export interface BrainStatus {
  vaultPath: string;
  initialized: boolean;
  counts: Record<BrainCategory, number>;
  totalNotes: number;
}

const FILENAME_BAD = /[<>:"|?*\x00-\x1f]/g;

function sanitizeTitle(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return 'Untitled';
  return trimmed.replace(FILENAME_BAD, '').replace(/\\/g, '-').slice(0, 120);
}

function todayLocalISODate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function escapeYaml(s: string): string {
  // Conservative — quote anything with special chars.
  if (/[:#\-?*&!|>"'%@`,{}[\]]/.test(s) || s.includes('\n')) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(raw: string): ParsedFrontmatter {
  if (!raw.startsWith('---')) return { data: {}, body: raw };
  const end = raw.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: raw };
  const block = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const data: Record<string, unknown> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_\-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1]!;
    let v = (m[2] ?? '').trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      // Inline array
      const inner = v.slice(1, -1).trim();
      const items =
        inner.length === 0
          ? []
          : inner
              .split(',')
              .map((s) => s.trim().replace(/^["']|["']$/g, ''))
              .filter((s) => s.length > 0);
      data[k] = items;
    } else if (v.startsWith('"') && v.endsWith('"')) {
      data[k] = v.slice(1, -1).replace(/\\"/g, '"');
    } else {
      data[k] = v;
    }
  }
  return { data, body };
}

function extractWikiLinks(body: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const inner = m[1]!.split('|')[0]!.trim();
    if (inner.length > 0) links.push(inner);
  }
  return links;
}

function extractInlineTags(body: string): string[] {
  const tags: string[] = [];
  const re = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_\-/]{0,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    tags.push(m[1]!);
  }
  return tags;
}

function buildFrontmatter(
  data: Record<string, string | string[] | undefined>,
): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => escapeYaml(x)).join(', ')}]`);
    } else {
      lines.push(`${k}: ${escapeYaml(v)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Resolve a path strictly inside the vault. Rejects absolute paths,
 * traversal, and symlink escapes (best-effort: blocks `..` segments).
 */
function safeJoin(vaultRoot: string, relPath: string): string {
  // Normalize separators
  const cleaned = relPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) {
    throw new Error(`Path must be vault-relative, got: ${relPath}`);
  }
  if (cleaned.includes('..')) {
    throw new Error(`Path traversal rejected: ${relPath}`);
  }
  const full = resolve(vaultRoot, cleaned);
  const rel = relative(vaultRoot, full);
  if (rel.startsWith('..') || rel.startsWith(sep) || /^[a-zA-Z]:/.test(rel)) {
    throw new Error(`Path escapes vault: ${relPath}`);
  }
  return full;
}

export class SecondBrain {
  constructor(private vaultPath: string) {}

  setVaultPath(p: string): void {
    this.vaultPath = p;
  }

  getVaultPath(): string {
    return this.vaultPath;
  }

  /** Create folder structure + README if vault doesn't exist yet. */
  async initialize(): Promise<void> {
    await fs.mkdir(this.vaultPath, { recursive: true });
    for (const folder of Object.values(FOLDERS)) {
      await fs.mkdir(join(this.vaultPath, folder), { recursive: true });
    }
    await fs.mkdir(join(this.vaultPath, TEMPLATES_DIR), { recursive: true });

    const readmePath = join(this.vaultPath, 'README.md');
    if (!existsSync(readmePath)) {
      await fs.writeFile(
        readmePath,
        `# Flowstate Second Brain

This vault is managed by Flowstate but is just plain markdown — open it in
[Obsidian](https://obsidian.md) for graph view, wiki-links, and search.

## Structure (PARA)

- **0_Inbox/** — fleeting captures, processed weekly
- **1_Projects/** — finite outcome with a deadline
- **2_Areas/** — ongoing responsibilities ("Career", "Homelab", ...)
- **3_Resources/** — topics, knowledge, skills
- **4_Archive/** — completed or inactive
- **Daily/** — one note per day (YYYY-MM-DD.md)
- **Routines/** — recurring patterns auto-detected by agents
- **Templates/** — Obsidian-style templates

## How agents update this vault

Agents can write here via three tools:

- \`brain_capture\` — append a line to today's daily note
- \`brain_note\` — create / update a note in any category
- \`brain_search\` — full-text search across the vault

You can also capture from the Flowstate **Brain** page or by saying
"remember that …" in any chat.
`,
        'utf8',
      );
    }

    // Seed a couple of templates
    const tplDir = join(this.vaultPath, TEMPLATES_DIR);
    const tplProject = join(tplDir, 'Project.md');
    if (!existsSync(tplProject)) {
      await fs.writeFile(
        tplProject,
        `---
created: {{date:YYYY-MM-DD}}
tags: [project]
status: active
---

# {{title}}

## Outcome
-

## Tasks
- [ ]

## Notes
`,
        'utf8',
      );
    }
    const tplConcept = join(tplDir, 'Concept.md');
    if (!existsSync(tplConcept)) {
      await fs.writeFile(
        tplConcept,
        `---
created: {{date:YYYY-MM-DD}}
tags: [concept]
---

# {{title}}

## Summary

## Connections

## Sources
`,
        'utf8',
      );
    }
  }

  isInitialized(): boolean {
    return existsSync(join(this.vaultPath, FOLDERS.inbox));
  }

  async status(): Promise<BrainStatus> {
    if (!this.isInitialized()) {
      return {
        vaultPath: this.vaultPath,
        initialized: false,
        counts: {
          inbox: 0,
          projects: 0,
          areas: 0,
          resources: 0,
          archive: 0,
          daily: 0,
          routines: 0,
        },
        totalNotes: 0,
      };
    }
    const counts = {} as Record<BrainCategory, number>;
    let total = 0;
    for (const [cat, folder] of Object.entries(FOLDERS) as [BrainCategory, string][]) {
      try {
        const entries = await fs.readdir(join(this.vaultPath, folder));
        const n = entries.filter((e) => e.endsWith('.md')).length;
        counts[cat] = n;
        total += n;
      } catch {
        counts[cat] = 0;
      }
    }
    return { vaultPath: this.vaultPath, initialized: true, counts, totalNotes: total };
  }

  /**
   * Append a single fleeting capture to today's daily note. Creates the
   * daily note if it does not exist. Each line is timestamped + tagged
   * with the source (chat agent / user / tool).
   */
  async capture(
    text: string,
    opts: { source?: string; tags?: string[] } = {},
  ): Promise<{ relPath: string }> {
    if (text.trim().length === 0) throw new Error('Empty capture');
    await this.initialize(); // idempotent
    const date = todayLocalISODate();
    const relPath = `${FOLDERS.daily}/${date}.md`;
    const full = safeJoin(this.vaultPath, relPath);

    if (!existsSync(full)) {
      const fm = buildFrontmatter({
        created: nowIso(),
        tags: ['daily'],
      });
      const header = `# ${date}\n\n## Captures\n\n`;
      await fs.writeFile(full, fm + header, 'utf8');
    }

    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const tagStr =
      opts.tags && opts.tags.length > 0
        ? ' ' + opts.tags.map((t) => `#${t.replace(/^#/, '')}`).join(' ')
        : '';
    const srcStr = opts.source ? ` _(${opts.source})_` : '';
    const line = `- **${hh}:${mm}** ${text.trim()}${tagStr}${srcStr}\n`;
    await fs.appendFile(full, line, 'utf8');
    return { relPath };
  }

  async writeNote(input: {
    category: BrainCategory;
    title: string;
    body: string;
    tags?: string[];
    links?: string[];
  }): Promise<{ relPath: string }> {
    await this.initialize();
    const filename = sanitizeTitle(input.title) + '.md';
    const folder = FOLDERS[input.category];
    const relPath = `${folder}/${filename}`;
    const full = safeJoin(this.vaultPath, relPath);
    const existed = existsSync(full);
    let createdAt = nowIso();
    if (existed) {
      try {
        const old = await fs.readFile(full, 'utf8');
        const parsed = parseFrontmatter(old);
        if (typeof parsed.data['created'] === 'string') {
          createdAt = parsed.data['created'];
        }
      } catch {
        // ignored
      }
    }
    const fm = buildFrontmatter({
      created: createdAt,
      updated: nowIso(),
      tags: input.tags ?? [],
    });
    const linksBlock =
      input.links && input.links.length > 0
        ? `\n## Links\n${input.links.map((l) => `- [[${l}]]`).join('\n')}\n`
        : '';
    const md =
      fm + `# ${input.title.trim()}\n\n${input.body.trim()}\n${linksBlock}`;
    await fs.mkdir(dirname(full), { recursive: true });
    await fs.writeFile(full, md, 'utf8');
    return { relPath };
  }

  async readNote(relPath: string): Promise<BrainNote> {
    const full = safeJoin(this.vaultPath, relPath);
    const raw = await fs.readFile(full, 'utf8');
    const stat = await fs.stat(full);
    const parsed = parseFrontmatter(raw);
    const titleMatch = /^#\s+(.+)$/m.exec(parsed.body);
    const title = titleMatch ? titleMatch[1]!.trim() : basename(relPath, '.md');
    const fmTags = Array.isArray(parsed.data['tags'])
      ? (parsed.data['tags'] as string[])
      : typeof parsed.data['tags'] === 'string'
        ? [(parsed.data['tags'] as string).trim()]
        : [];
    const inlineTags = extractInlineTags(parsed.body);
    const tags = Array.from(new Set([...fmTags, ...inlineTags]));
    const links = extractWikiLinks(parsed.body);
    const createdRaw = parsed.data['created'];
    const updatedRaw = parsed.data['updated'];
    const createdAt =
      typeof createdRaw === 'string' ? Date.parse(createdRaw) || stat.birthtimeMs : stat.birthtimeMs;
    const updatedAt =
      typeof updatedRaw === 'string' ? Date.parse(updatedRaw) || stat.mtimeMs : stat.mtimeMs;
    return {
      relPath,
      title,
      category: relPathToCategory(relPath),
      tags,
      links,
      body: parsed.body,
      createdAt,
      updatedAt,
    };
  }

  async list(category?: BrainCategory): Promise<BrainListEntry[]> {
    if (!this.isInitialized()) return [];
    const out: BrainListEntry[] = [];
    const cats = category
      ? [category]
      : (Object.keys(FOLDERS) as BrainCategory[]);
    for (const cat of cats) {
      const dir = join(this.vaultPath, FOLDERS[cat]);
      let entries: string[];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.endsWith('.md')) continue;
        const relPath = `${FOLDERS[cat]}/${e}`;
        try {
          const note = await this.readNote(relPath);
          out.push({
            relPath: note.relPath,
            title: note.title,
            category: note.category,
            tags: note.tags,
            updatedAt: note.updatedAt,
          });
        } catch {
          // skip unreadable
        }
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  async search(
    query: string,
    limit: number = 25,
  ): Promise<Array<BrainListEntry & { snippet: string }>> {
    const all = await this.list();
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const hits: Array<BrainListEntry & { snippet: string }> = [];
    for (const entry of all) {
      try {
        const note = await this.readNote(entry.relPath);
        const hayTitle = entry.title.toLowerCase();
        const hayBody = note.body.toLowerCase();
        const inTitle = hayTitle.includes(q);
        const inBody = hayBody.includes(q);
        if (!inTitle && !inBody) continue;
        // Snippet: 80 chars around first body hit, else title
        let snippet = '';
        const idx = hayBody.indexOf(q);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(note.body.length, idx + q.length + 40);
          snippet = (start > 0 ? '…' : '') + note.body.slice(start, end) + (end < note.body.length ? '…' : '');
        } else {
          snippet = note.body.split('\n').find((l) => l.trim().length > 0)?.slice(0, 120) ?? '';
        }
        hits.push({ ...entry, snippet: snippet.replace(/\n/g, ' ').trim() });
        if (hits.length >= limit) break;
      } catch {
        // skip
      }
    }
    return hits;
  }
}

function relPathToCategory(relPath: string): BrainCategory | 'other' {
  for (const [cat, folder] of Object.entries(FOLDERS) as [BrainCategory, string][]) {
    if (relPath.startsWith(folder + '/')) return cat;
  }
  return 'other';
}
