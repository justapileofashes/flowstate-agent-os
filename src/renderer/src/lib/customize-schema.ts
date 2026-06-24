// Pure schema + helpers for the Customize feature. No IPC, no DOM — safe
// to import from Node (vitest) and from the renderer alike.

import { z } from 'zod';

export const STORAGE_KEY = 'customize_prefs_v1';
export const CURRENT_VERSION = 1 as const;

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type Accent = 'platinum' | 'sage' | 'amber' | 'copper' | 'plum';
export type Radius = 'sharp' | 'soft' | 'round';
export type DashboardSectionId = 'hero' | 'composer' | 'recent' | 'streaming';
export type NavId = 'models' | 'brain' | 'connectors' | 'plugins' | 'flowclaw' | 'business';
export type CardSize = 'sm' | 'md' | 'lg';

export const DASHBOARD_SECTION_META: Record<
  DashboardSectionId,
  { label: string; description: string }
> = {
  hero: { label: 'Greeting', description: 'Time-of-day greeting + roster count' },
  composer: { label: 'Composer', description: 'Ask-anything box that routes to the best agent' },
  recent: { label: 'Specialists', description: 'Quick-launch chip list of agents' },
  streaming: { label: 'Streaming agents', description: 'Agents currently working' },
};

export const NAV_META: Record<NavId, { label: string }> = {
  models: { label: 'Models' },
  brain: { label: 'Brain' },
  connectors: { label: 'Connectors' },
  plugins: { label: 'Plugins' },
  flowclaw: { label: 'Flowclaw' },
  business: { label: 'Business' },
};

const dashboardSectionSchema = z.object({
  id: z.enum(['hero', 'composer', 'recent', 'streaming']),
  visible: z.boolean(),
});

export const customizePrefsSchema = z.object({
  version: z.literal(1),
  theme: z.enum(['system', 'light', 'dark']),
  density: z.enum(['compact', 'comfortable', 'spacious']),
  accent: z.enum(['platinum', 'sage', 'amber', 'copper', 'plum']),
  radius: z.enum(['sharp', 'soft', 'round']),
  reducedMotion: z.boolean(),
  dashboardSections: z.array(dashboardSectionSchema),
  hiddenNav: z.array(
    z.enum(['models', 'brain', 'connectors', 'plugins', 'flowclaw', 'business', 'stocks']),
  ),
  chatHeader: z.object({
    crumbs: z.boolean(),
    tokenChip: z.boolean(),
    snapshots: z.boolean(),
    audit: z.boolean(),
    files: z.boolean(),
    views: z.boolean(),
  }),
  sidebar: z.object({
    sessions: z.boolean(),
  }),
  mascots: z.boolean(),
  mascotSpeed: z.number().min(20).max(220),
  mascotPalette: z.enum(['default', 'sage', 'amber', 'plum', 'cyan']),
  agentCards: z.object({
    showAvatar: z.boolean(),
    showName: z.boolean(),
    showStatus: z.boolean(),
    showLastActivity: z.boolean(),
    showTags: z.boolean(),
    showModel: z.boolean(),
    size: z.enum(['sm', 'md', 'lg']),
  }),
});

export type CustomizePrefs = z.infer<typeof customizePrefsSchema>;

export const DEFAULT_PREFS: CustomizePrefs = {
  version: 1,
  theme: 'dark',
  density: 'comfortable',
  accent: 'platinum',
  radius: 'soft',
  reducedMotion: false,
  dashboardSections: [
    { id: 'hero', visible: true },
    { id: 'composer', visible: true },
    { id: 'streaming', visible: true },
    { id: 'recent', visible: true },
  ],
  hiddenNav: [],
  chatHeader: {
    crumbs: true,
    tokenChip: true,
    snapshots: true,
    audit: true,
    files: true,
    views: true,
  },
  sidebar: {
    sessions: true,
  },
  mascots: true,
  mascotSpeed: 55,
  mascotPalette: 'default',
  agentCards: {
    showAvatar: true,
    showName: true,
    showStatus: true,
    showLastActivity: true,
    showTags: true,
    showModel: false,
    size: 'md',
  },
};

function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as { version?: number };
  if (typeof obj.version !== 'number') return { ...obj, version: 1 };
  return obj;
}

export function mergeWithDefaults(raw: unknown): CustomizePrefs {
  const candidate = (() => {
    const migrated = migrate(raw);
    if (!migrated || typeof migrated !== 'object') return DEFAULT_PREFS;
    const m = migrated as Partial<CustomizePrefs>;
    return {
      version: 1 as const,
      theme: m.theme ?? DEFAULT_PREFS.theme,
      density: m.density ?? DEFAULT_PREFS.density,
      accent: m.accent ?? DEFAULT_PREFS.accent,
      radius: m.radius ?? DEFAULT_PREFS.radius,
      reducedMotion: m.reducedMotion ?? DEFAULT_PREFS.reducedMotion,
      dashboardSections: reconcileSections(m.dashboardSections),
      hiddenNav: Array.isArray(m.hiddenNav)
        ? m.hiddenNav.filter(
            (n): n is NavId =>
              n === 'models' ||
              n === 'brain' ||
              n === 'connectors' ||
              n === 'plugins' ||
              n === 'flowclaw' ||
              n === 'business' ||
              n === 'stocks',
          )
        : DEFAULT_PREFS.hiddenNav,
      chatHeader: { ...DEFAULT_PREFS.chatHeader, ...(m.chatHeader ?? {}) },
      sidebar: { ...DEFAULT_PREFS.sidebar, ...(m.sidebar ?? {}) },
      mascots: m.mascots ?? DEFAULT_PREFS.mascots,
      mascotSpeed:
        typeof m.mascotSpeed === 'number' && m.mascotSpeed >= 20 && m.mascotSpeed <= 220
          ? m.mascotSpeed
          : DEFAULT_PREFS.mascotSpeed,
      mascotPalette:
        m.mascotPalette === 'sage' ||
        m.mascotPalette === 'amber' ||
        m.mascotPalette === 'plum' ||
        m.mascotPalette === 'cyan'
          ? m.mascotPalette
          : DEFAULT_PREFS.mascotPalette,
      agentCards: { ...DEFAULT_PREFS.agentCards, ...(m.agentCards ?? {}) },
    };
  })();
  const parsed = customizePrefsSchema.safeParse(candidate);
  return parsed.success ? parsed.data : DEFAULT_PREFS;
}

export function reconcileSections(input: unknown): CustomizePrefs['dashboardSections'] {
  const known = new Set<DashboardSectionId>(DEFAULT_PREFS.dashboardSections.map((s) => s.id));
  const out: CustomizePrefs['dashboardSections'] = [];
  const seen = new Set<DashboardSectionId>();
  if (Array.isArray(input)) {
    for (const s of input) {
      if (!s || typeof s !== 'object') continue;
      const obj = s as { id?: unknown; visible?: unknown };
      if (typeof obj.id !== 'string' || !known.has(obj.id as DashboardSectionId)) continue;
      const id = obj.id as DashboardSectionId;
      if (seen.has(id)) continue;
      out.push({ id, visible: typeof obj.visible === 'boolean' ? obj.visible : true });
      seen.add(id);
    }
  }
  for (const def of DEFAULT_PREFS.dashboardSections) {
    if (!seen.has(def.id)) out.push({ ...def });
  }
  return out;
}

export function moveSection(
  sections: CustomizePrefs['dashboardSections'],
  id: DashboardSectionId,
  delta: number,
): CustomizePrefs['dashboardSections'] {
  const idx = sections.findIndex((s) => s.id === id);
  if (idx === -1) return sections;
  const next = [...sections];
  const target = Math.max(0, Math.min(next.length - 1, idx + delta));
  if (target === idx) return next;
  const [item] = next.splice(idx, 1);
  next.splice(target, 0, item!);
  return next;
}

export function reorderSections(
  sections: CustomizePrefs['dashboardSections'],
  from: number,
  to: number,
): CustomizePrefs['dashboardSections'] {
  if (from === to || from < 0 || from >= sections.length) return sections;
  const next = [...sections];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item!);
  return next;
}
