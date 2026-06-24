import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  customizePrefsSchema,
  mergeWithDefaults,
  moveSection,
  reconcileSections,
  reorderSections,
  type CustomizePrefs,
} from '../../src/renderer/src/lib/customize-schema';

describe('customizePrefsSchema', () => {
  it('accepts the default prefs', () => {
    const parsed = customizePrefsSchema.safeParse(DEFAULT_PREFS);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown accent', () => {
    const bad = { ...DEFAULT_PREFS, accent: 'neon' };
    const parsed = customizePrefsSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown theme', () => {
    const bad = { ...DEFAULT_PREFS, theme: 'midnight' };
    expect(customizePrefsSchema.safeParse(bad).success).toBe(false);
  });
});

describe('mergeWithDefaults', () => {
  it('returns defaults for null / non-object input', () => {
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_PREFS);
    expect(mergeWithDefaults('not an object')).toEqual(DEFAULT_PREFS);
    expect(mergeWithDefaults(42)).toEqual(DEFAULT_PREFS);
  });

  it('returns defaults when zod validation fails after merge', () => {
    const corrupt = {
      version: 1,
      theme: 'midnight', // invalid
      density: 'comfortable',
      accent: 'platinum',
      radius: 'soft',
      reducedMotion: false,
      dashboardSections: DEFAULT_PREFS.dashboardSections,
      hiddenNav: [],
      chatHeader: DEFAULT_PREFS.chatHeader,
      sidebar: DEFAULT_PREFS.sidebar,
      mascots: true,
      agentCards: DEFAULT_PREFS.agentCards,
    };
    expect(mergeWithDefaults(corrupt)).toEqual(DEFAULT_PREFS);
  });

  it('keeps user choices while filling in missing nested fields', () => {
    const partial = {
      theme: 'light' as const,
      accent: 'plum' as const,
      density: 'compact' as const,
      agentCards: { size: 'lg' as const, showStatus: false },
    };
    const merged = mergeWithDefaults(partial);
    expect(merged.theme).toBe('light');
    expect(merged.accent).toBe('plum');
    expect(merged.density).toBe('compact');
    expect(merged.agentCards.size).toBe('lg');
    expect(merged.agentCards.showStatus).toBe(false);
    // unspecified card fields fall back to defaults
    expect(merged.agentCards.showAvatar).toBe(true);
    // unspecified top-level fields fall back to defaults
    expect(merged.chatHeader).toEqual(DEFAULT_PREFS.chatHeader);
  });

  it('drops invalid nav entries from hiddenNav', () => {
    const merged = mergeWithDefaults({ hiddenNav: ['models', 'invalid', 'brain'] });
    expect(merged.hiddenNav).toEqual(['models', 'brain']);
  });

  it('drops unknown dashboard-section IDs and appends missing ones', () => {
    const merged = mergeWithDefaults({
      dashboardSections: [
        { id: 'composer', visible: false },
        { id: 'ghost', visible: true }, // unknown — drop
        { id: 'hero', visible: true },
      ],
    });
    const ids = merged.dashboardSections.map((s) => s.id);
    expect(ids).toEqual(['composer', 'hero', 'streaming', 'recent']);
    expect(merged.dashboardSections[0]?.visible).toBe(false);
  });

  it('migrates an unversioned payload by stamping version = 1', () => {
    const unversioned = { theme: 'dark', density: 'spacious' };
    const merged = mergeWithDefaults(unversioned);
    expect(merged.version).toBe(1);
    expect(merged.density).toBe('spacious');
  });
});

describe('reconcileSections', () => {
  it('returns full default order for non-array input', () => {
    expect(reconcileSections(undefined)).toEqual(DEFAULT_PREFS.dashboardSections);
    expect(reconcileSections({})).toEqual(DEFAULT_PREFS.dashboardSections);
  });

  it('preserves user order + visibility for known IDs', () => {
    const input = [
      { id: 'recent', visible: false },
      { id: 'hero', visible: true },
    ];
    const out = reconcileSections(input);
    expect(out[0]).toEqual({ id: 'recent', visible: false });
    expect(out[1]).toEqual({ id: 'hero', visible: true });
    expect(out.length).toBe(DEFAULT_PREFS.dashboardSections.length);
  });
});

describe('moveSection', () => {
  const sections: CustomizePrefs['dashboardSections'] = [
    { id: 'hero', visible: true },
    { id: 'composer', visible: true },
    { id: 'streaming', visible: true },
    { id: 'recent', visible: true },
  ];

  it('moves down by +1', () => {
    const out = moveSection(sections, 'hero', 1);
    expect(out.map((s) => s.id)).toEqual(['composer', 'hero', 'streaming', 'recent']);
  });

  it('moves up by -1', () => {
    const out = moveSection(sections, 'streaming', -1);
    expect(out.map((s) => s.id)).toEqual(['hero', 'streaming', 'composer', 'recent']);
  });

  it('clamps at array bounds', () => {
    const out = moveSection(sections, 'hero', -5);
    expect(out).toEqual(sections);
    const out2 = moveSection(sections, 'recent', 5);
    expect(out2).toEqual(sections);
  });

  it('no-ops for unknown id', () => {
    const out = moveSection(sections, 'ghost' as never, 1);
    expect(out).toEqual(sections);
  });
});

describe('reorderSections', () => {
  const sections: CustomizePrefs['dashboardSections'] = [
    { id: 'hero', visible: true },
    { id: 'composer', visible: true },
    { id: 'streaming', visible: true },
    { id: 'recent', visible: true },
  ];

  it('moves an item from index 0 to 2', () => {
    const out = reorderSections(sections, 0, 2);
    expect(out.map((s) => s.id)).toEqual(['composer', 'streaming', 'hero', 'recent']);
  });

  it('moves an item from index 3 to 0', () => {
    const out = reorderSections(sections, 3, 0);
    expect(out.map((s) => s.id)).toEqual(['recent', 'hero', 'composer', 'streaming']);
  });

  it('returns the input when from === to', () => {
    expect(reorderSections(sections, 1, 1)).toEqual(sections);
  });

  it('returns the input for an out-of-range `from`', () => {
    expect(reorderSections(sections, 99, 0)).toEqual(sections);
  });
});
