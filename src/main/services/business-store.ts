// Business autopilot persistence: company profile, rolling memory (capped
// markdown), and sprint/action/feed state. Plain JSON files under
// userData/business/ (dir injectable for tests), sync write-through like the
// zoom-recorder job store.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BusinessProfile {
  name: string;
  product: string;
  audience: string;
  goals: string[];
  links: { site?: string; repo?: string };
  roleAgentIds: { strategy: string; marketing: string; ops: string };
  schedule: { enabled: boolean; time: string /* "HH:MM" */ };
  createdAt: number;
}

export interface SprintTask {
  id: string;
  role: 'marketing' | 'ops';
  instruction: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
  error?: string;
}

export interface BusinessSprint {
  id: string;
  status: 'planning' | 'running' | 'wrapping' | 'done' | 'error';
  goals: string[];
  tasks: SprintTask[];
  briefing?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface ProposedAction {
  id: string;
  sprintId: string;
  role: 'strategy' | 'marketing' | 'ops';
  kind: 'email' | 'post' | 'code' | 'other';
  title: string;
  body: string;
  status: 'proposed' | 'approved' | 'executing' | 'done' | 'failed' | 'rejected';
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BusinessFeedEvent {
  id: string;
  ts: number;
  sprintId?: string;
  role?: string;
  kind:
    | 'sprint-start'
    | 'phase'
    | 'task-start'
    | 'task-tool'
    | 'task-done'
    | 'action-proposed'
    | 'action-executed'
    | 'action-failed'
    | 'briefing'
    | 'sprint-end'
    | 'error';
  text: string;
}

const MEMORY_HEADER = '# Business memory\n';
const MEMORY_CAP = 64_000;
const SPRINT_CAP = 30;
const FEED_CAP = 500;

interface State {
  sprints: BusinessSprint[];
  actions: ProposedAction[];
  feed: BusinessFeedEvent[];
}

export class BusinessStore {
  private state: State = { sprints: [], actions: [], feed: [] };

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.loadState();
  }

  private path(name: string): string {
    return join(this.dir, name);
  }

  // ── profile ────────────────────────────────────────────────────────────

  loadProfile(): BusinessProfile | null {
    try {
      const raw = readFileSync(this.path('profile.json'), 'utf8');
      const p = JSON.parse(raw) as BusinessProfile;
      if (typeof p?.name !== 'string' || !p.roleAgentIds) return null;
      return p;
    } catch {
      return null;
    }
  }

  saveProfile(p: BusinessProfile): void {
    writeFileSync(this.path('profile.json'), JSON.stringify(p, null, 2), 'utf8');
  }

  // ── memory ─────────────────────────────────────────────────────────────

  readMemory(): string {
    try {
      return readFileSync(this.path('memory.md'), 'utf8');
    } catch {
      return MEMORY_HEADER;
    }
  }

  appendMemory(section: string): void {
    let mem = this.readMemory();
    if (!mem.startsWith(MEMORY_HEADER.trim())) mem = MEMORY_HEADER + mem;
    mem = `${mem.replace(/\n*$/, '\n\n')}${section.trim()}\n`;
    // Trim oldest sections (the chunk right after the header) until under cap.
    while (mem.length > MEMORY_CAP) {
      const parts = mem.split('\n## ');
      if (parts.length <= 2) {
        // single oversized section — hard-truncate its middle, keep header + tail
        mem = MEMORY_HEADER + mem.slice(mem.length - (MEMORY_CAP - MEMORY_HEADER.length));
        break;
      }
      // parts[0] is the header block; drop parts[1] (oldest section)
      mem = [parts[0], ...parts.slice(2)].join('\n## ');
    }
    writeFileSync(this.path('memory.md'), mem, 'utf8');
  }

  // ── state ──────────────────────────────────────────────────────────────

  private loadState(): void {
    try {
      const raw = readFileSync(this.path('state.json'), 'utf8');
      const parsed = JSON.parse(raw) as Partial<State>;
      this.state = {
        sprints: Array.isArray(parsed.sprints) ? parsed.sprints : [],
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        feed: Array.isArray(parsed.feed) ? parsed.feed : [],
      };
    } catch {
      this.state = { sprints: [], actions: [], feed: [] };
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.path('state.json'), JSON.stringify(this.state), 'utf8');
    } catch {
      // best-effort
    }
  }

  sprints(): BusinessSprint[] {
    return this.state.sprints.slice();
  }

  upsertSprint(s: BusinessSprint): void {
    const idx = this.state.sprints.findIndex((x) => x.id === s.id);
    if (idx >= 0) this.state.sprints[idx] = s;
    else this.state.sprints.push(s);
    if (this.state.sprints.length > SPRINT_CAP) {
      this.state.sprints = this.state.sprints.slice(-SPRINT_CAP);
    }
    this.persist();
  }

  actions(): ProposedAction[] {
    return this.state.actions.slice();
  }

  upsertAction(a: ProposedAction): void {
    const idx = this.state.actions.findIndex((x) => x.id === a.id);
    if (idx >= 0) this.state.actions[idx] = a;
    else this.state.actions.push(a);
    this.persist();
  }

  feed(): BusinessFeedEvent[] {
    return this.state.feed.slice();
  }

  pushFeed(e: BusinessFeedEvent): void {
    this.state.feed.push(e);
    if (this.state.feed.length > FEED_CAP) {
      this.state.feed = this.state.feed.slice(-FEED_CAP);
    }
    this.persist();
  }
}
