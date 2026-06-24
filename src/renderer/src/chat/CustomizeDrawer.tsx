// CustomizeDrawer — right-side panel inspired by Perplexity's
// personalization flow. Live preview (visuals follow draft state),
// Reset / Cancel / Save in the footer.

import { useEffect, useRef, useState, type JSX } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCustomize, useFocusTrap } from '../lib/CustomizeContext';
import {
  DASHBOARD_SECTION_META,
  NAV_META,
  reorderSections,
  moveSection,
  type Accent,
  type CustomizePrefs,
  type DashboardSectionId,
  type Density,
  type NavId,
  type Radius,
  type ThemeChoice,
  type CardSize,
} from '../lib/customize';

interface Props {
  open: boolean;
  onClose: () => void;
}

const ACCENTS: Array<{ id: Accent; swatch: string; label: string }> = [
  { id: 'platinum', swatch: '#e8e3d5', label: 'Platinum' },
  { id: 'sage', swatch: '#aebf94', label: 'Sage' },
  { id: 'amber', swatch: '#d8b266', label: 'Amber' },
  { id: 'copper', swatch: '#c08866', label: 'Copper' },
  { id: 'plum', swatch: '#a587a8', label: 'Plum' },
];

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const DENSITIES: Array<{ id: Density; label: string }> = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'spacious', label: 'Spacious' },
];

const RADII: Array<{ id: Radius; label: string }> = [
  { id: 'sharp', label: 'Sharp' },
  { id: 'soft', label: 'Soft' },
  { id: 'round', label: 'Round' },
];

const CARD_SIZES: Array<{ id: CardSize; label: string }> = [
  { id: 'sm', label: 'Small' },
  { id: 'md', label: 'Medium' },
  { id: 'lg', label: 'Large' },
];

export function CustomizeDrawer({ open, onClose }: Props): JSX.Element {
  const { prefs, beginDraft, updateDraft, commit, cancel, reset, isDraft } = useCustomize();
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Begin draft mode on open so changes don't auto-persist until Save.
  useEffect(() => {
    if (open) beginDraft();
  }, [open, beginDraft]);

  // ESC closes (and cancels any draft).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        cancel();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, cancel]);

  useFocusTrap(open, drawerRef);

  const set = (u: (p: CustomizePrefs) => CustomizePrefs): void => updateDraft(u);

  const handleSave = async (): Promise<void> => {
    await commit();
    setSaveStatus('Saved.');
    setTimeout(() => setSaveStatus(null), 1800);
    onClose();
  };

  const handleCancel = (): void => {
    cancel();
    onClose();
  };

  const handleReset = async (): Promise<void> => {
    await reset();
    setSaveStatus('Reset to defaults.');
    setTimeout(() => setSaveStatus(null), 1800);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="drawer-backdrop"
          onClick={handleCancel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.aside
            ref={drawerRef}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customize-title"
            onClick={(e) => e.stopPropagation()}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <header className="drawer-head">
              <div>
                <div className="eyebrow">Customize</div>
                <h2 id="customize-title" style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 500 }}>
                  Tailor your workspace
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={handleCancel}
                aria-label="Close customize panel"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2 2l8 8 M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </header>

            <div className="drawer-body">
              {/* ── Appearance ───────────────────────────────────────── */}
              <section className="drawer-section" aria-labelledby="sec-appearance">
                <h3 id="sec-appearance">Appearance</h3>
                <p className="hint">Theme, accent, density, corner style.</p>

                <div className="drawer-row">
                  <span className="lab">Theme</span>
                  <ChoiceGroup
                    value={prefs.theme}
                    onChange={(v) => set((p) => ({ ...p, theme: v }))}
                    options={THEMES}
                    ariaLabel="Theme"
                  />
                </div>

                <div className="drawer-row" style={{ alignItems: 'flex-start' }}>
                  <span className="lab">Accent</span>
                  <div className="accent-swatch-row" role="radiogroup" aria-label="Accent color">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="radio"
                        aria-checked={prefs.accent === a.id}
                        aria-label={a.label}
                        title={a.label}
                        className={'accent-swatch ' + (prefs.accent === a.id ? 'on' : '')}
                        style={{ background: a.swatch }}
                        onClick={() => set((p) => ({ ...p, accent: a.id }))}
                      />
                    ))}
                  </div>
                </div>

                <div className="drawer-row">
                  <span className="lab">Density</span>
                  <ChoiceGroup
                    value={prefs.density}
                    onChange={(v) => set((p) => ({ ...p, density: v }))}
                    options={DENSITIES}
                    ariaLabel="Layout density"
                  />
                </div>

                <div className="drawer-row">
                  <span className="lab">Corner style</span>
                  <ChoiceGroup
                    value={prefs.radius}
                    onChange={(v) => set((p) => ({ ...p, radius: v }))}
                    options={RADII}
                    ariaLabel="Corner radius"
                  />
                </div>

                <div className="drawer-row">
                  <span className="lab">
                    Reduce motion
                    <span className="hint">Disable transitions + pulse animations.</span>
                  </span>
                  <Switch
                    checked={prefs.reducedMotion}
                    onChange={(v) => set((p) => ({ ...p, reducedMotion: v }))}
                    label="Reduce motion"
                  />
                </div>
              </section>

              {/* ── Sidebar ─────────────────────────────────────────── */}
              <section className="drawer-section" aria-labelledby="sec-sidebar">
                <h3 id="sec-sidebar">Sidebar</h3>
                <p className="hint">Hide nav rows or the sessions list.</p>

                {(Object.keys(NAV_META) as NavId[]).map((id) => (
                  <div className="drawer-row" key={id}>
                    <span className="lab">{NAV_META[id].label}</span>
                    <Switch
                      checked={!prefs.hiddenNav.includes(id)}
                      onChange={(v) =>
                        set((p) => ({
                          ...p,
                          hiddenNav: v
                            ? p.hiddenNav.filter((x) => x !== id)
                            : [...p.hiddenNav, id],
                        }))
                      }
                      label={NAV_META[id].label}
                    />
                  </div>
                ))}

                <div className="drawer-row">
                  <span className="lab">Sessions list</span>
                  <Switch
                    checked={prefs.sidebar.sessions}
                    onChange={(v) =>
                      set((p) => ({ ...p, sidebar: { ...p.sidebar, sessions: v } }))
                    }
                    label="Show sessions list"
                  />
                </div>
              </section>

              {/* ── Chat surface ─────────────────────────────────────── */}
              <section className="drawer-section" aria-labelledby="sec-chat">
                <h3 id="sec-chat">Chat surface</h3>
                <p className="hint">Header chips + buttons.</p>

                {(
                  [
                    ['crumbs', 'Model + workspace crumbs'],
                    ['tokenChip', 'Token usage chip'],
                    ['snapshots', 'Snapshots button'],
                    ['audit', 'Audit log button'],
                    ['files', 'Files button'],
                    ['views', 'Views dropdown'],
                  ] as const
                ).map(([k, label]) => (
                  <div className="drawer-row" key={k}>
                    <span className="lab">{label}</span>
                    <Switch
                      checked={prefs.chatHeader[k]}
                      onChange={(v) =>
                        set((p) => ({ ...p, chatHeader: { ...p.chatHeader, [k]: v } }))
                      }
                      label={label}
                    />
                  </div>
                ))}
              </section>

              {/* ── Mascots ─────────────────────────────────────────── */}
              <section className="drawer-section" aria-labelledby="sec-mascots">
                <h3 id="sec-mascots">Mascots</h3>
                <p className="hint">Pixel-art agents entering through the door on the chatbar.</p>
                <div className="drawer-row">
                  <span className="lab">Show mascots</span>
                  <Switch
                    checked={prefs.mascots}
                    onChange={(v) => set((p) => ({ ...p, mascots: v }))}
                    label="Show mascots"
                  />
                </div>
                <div className="drawer-row">
                  <span className="lab">
                    Walk speed
                    <span className="hint">{prefs.mascotSpeed} px/s</span>
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={220}
                    step={10}
                    value={prefs.mascotSpeed}
                    onChange={(e) =>
                      set((p) => ({ ...p, mascotSpeed: Number(e.target.value) }))
                    }
                    style={{ width: 160, accentColor: 'var(--accent)' }}
                    aria-label="Mascot walk speed"
                  />
                </div>
                <div className="drawer-row" style={{ alignItems: 'flex-start' }}>
                  <span className="lab">Palette</span>
                  <ChoiceGroup
                    value={prefs.mascotPalette}
                    onChange={(v) => set((p) => ({ ...p, mascotPalette: v }))}
                    options={[
                      { id: 'default', label: 'Default' },
                      { id: 'sage', label: 'Sage' },
                      { id: 'amber', label: 'Amber' },
                      { id: 'plum', label: 'Plum' },
                      { id: 'cyan', label: 'Cyan' },
                    ]}
                    ariaLabel="Mascot palette"
                  />
                </div>
              </section>

              {/* ── Agent cards ─────────────────────────────────────── */}
              <section className="drawer-section" aria-labelledby="sec-cards">
                <h3 id="sec-cards">Agent cards</h3>
                <p className="hint">Controls how session rows render in the sidebar.</p>

                <div className="drawer-row">
                  <span className="lab">Card size</span>
                  <ChoiceGroup
                    value={prefs.agentCards.size}
                    onChange={(v) =>
                      set((p) => ({ ...p, agentCards: { ...p.agentCards, size: v } }))
                    }
                    options={CARD_SIZES}
                    ariaLabel="Agent card size"
                  />
                </div>

                {(
                  [
                    ['showAvatar', 'Avatar'],
                    ['showName', 'Title'],
                    ['showStatus', 'Live status dot'],
                    ['showLastActivity', 'Subtitle (agent / last activity)'],
                    ['showTags', 'Tags'],
                    ['showModel', 'Model name'],
                  ] as const
                ).map(([k, label]) => (
                  <div className="drawer-row" key={k}>
                    <span className="lab">{label}</span>
                    <Switch
                      checked={prefs.agentCards[k]}
                      onChange={(v) =>
                        set((p) => ({ ...p, agentCards: { ...p.agentCards, [k]: v } }))
                      }
                      label={label}
                    />
                  </div>
                ))}
              </section>

              {/* ── Dashboard sections (drag to reorder) ────────────── */}
              <section className="drawer-section" aria-labelledby="sec-dash">
                <h3 id="sec-dash">Dashboard sections</h3>
                <p className="hint">Drag to reorder. Toggle to show / hide.</p>
                <SectionReorder
                  sections={prefs.dashboardSections}
                  onReorder={(from, to) =>
                    set((p) => ({ ...p, dashboardSections: reorderSections(p.dashboardSections, from, to) }))
                  }
                  onToggle={(id) =>
                    set((p) => ({
                      ...p,
                      dashboardSections: p.dashboardSections.map((s) =>
                        s.id === id ? { ...s, visible: !s.visible } : s,
                      ),
                    }))
                  }
                  onMove={(id, delta) =>
                    set((p) => ({ ...p, dashboardSections: moveSection(p.dashboardSections, id, delta) }))
                  }
                />
              </section>
            </div>

            <footer className="drawer-foot">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void handleReset()}
              >
                Reset to defaults
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {saveStatus ? (
                  <span aria-live="polite" style={{ fontSize: 11, color: 'var(--ink-muted)' }}>
                    {saveStatus}
                  </span>
                ) : null}
                <button type="button" className="btn btn-sm" onClick={handleCancel}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={() => void handleSave()}
                  disabled={!isDraft}
                >
                  Save
                </button>
              </div>
            </footer>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────

function ChoiceGroup<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: string }>;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="toggle-group">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          role="radio"
          aria-checked={value === opt.id}
          className={value === opt.id ? 'on' : ''}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    />
  );
}

function SectionReorder({
  sections,
  onReorder,
  onToggle,
  onMove,
}: {
  sections: CustomizePrefs['dashboardSections'];
  onReorder: (from: number, to: number) => void;
  onToggle: (id: DashboardSectionId) => void;
  onMove: (id: DashboardSectionId, delta: number) => void;
}): JSX.Element {
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  return (
    <div>
      {sections.map((s, i) => {
        const meta = DASHBOARD_SECTION_META[s.id];
        return (
          <div
            key={s.id}
            className={
              'reorder-row' +
              (draggingIdx === i ? ' dragging' : '') +
              (overIdx === i && draggingIdx !== null && draggingIdx !== i ? ' drag-over' : '')
            }
            draggable
            onDragStart={(e) => {
              setDraggingIdx(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
            }}
            onDragEnd={() => {
              setDraggingIdx(null);
              setOverIdx(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverIdx(i);
            }}
            onDragLeave={() => setOverIdx((cur) => (cur === i ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              const from = Number(e.dataTransfer.getData('text/plain'));
              if (!Number.isNaN(from)) onReorder(from, i);
              setDraggingIdx(null);
              setOverIdx(null);
            }}
          >
            <span className="grip" aria-hidden="true">⋮⋮</span>
            <span className="lab" style={{ minWidth: 0 }}>
              {meta.label}
              <span className="sub">{meta.description}</span>
            </span>
            <button
              type="button"
              className="arrow-btn"
              onClick={() => onMove(s.id, -1)}
              disabled={i === 0}
              aria-label={`Move ${meta.label} up`}
            >
              ↑
            </button>
            <button
              type="button"
              className="arrow-btn"
              onClick={() => onMove(s.id, 1)}
              disabled={i === sections.length - 1}
              aria-label={`Move ${meta.label} down`}
            >
              ↓
            </button>
            <Switch
              checked={s.visible}
              onChange={() => onToggle(s.id)}
              label={`Show ${meta.label}`}
            />
          </div>
        );
      })}
    </div>
  );
}
