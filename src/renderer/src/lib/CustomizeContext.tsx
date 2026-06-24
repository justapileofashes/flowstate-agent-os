// CustomizeProvider — single React Context holding the committed user prefs
// + a draft for live preview while the drawer is open. Applies declarative
// `data-*` attributes on <html> so all CSS overrides are pure cascade with
// no JS bridging required for visuals.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type JSX,
} from 'react';
import {
  DEFAULT_PREFS,
  loadPrefs,
  resetPrefs,
  savePrefs,
  type CustomizePrefs,
} from './customize';

type Updater = (prev: CustomizePrefs) => CustomizePrefs;

interface CustomizeContextValue {
  /** The currently *applied* prefs (live preview when drawer open, else
   *  the committed/persisted prefs). */
  prefs: CustomizePrefs;
  /** True when a draft is in progress (user has unsaved changes). */
  isDraft: boolean;
  /** Begin a draft session (call when opening the drawer). */
  beginDraft: () => void;
  /** Update the draft (or commit instantly if no draft is active). */
  updateDraft: (u: Updater | Partial<CustomizePrefs>) => void;
  /** Persist current draft. Resolves once written. */
  commit: () => Promise<void>;
  /** Discard the draft, revert visuals to the committed prefs. */
  cancel: () => void;
  /** Reset everything to defaults and persist. */
  reset: () => Promise<void>;
  /** True once initial load has completed. */
  ready: boolean;
}

const CustomizeContext = createContext<CustomizeContextValue | null>(null);

function applyHtmlAttrs(prefs: CustomizePrefs): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const resolvedTheme =
    prefs.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : prefs.theme;
  html.setAttribute('data-theme', resolvedTheme);
  html.setAttribute('data-density', prefs.density);
  html.setAttribute('data-accent', prefs.accent);
  html.setAttribute('data-radius', prefs.radius);
  html.setAttribute('data-reduce-motion', prefs.reducedMotion ? 'true' : 'false');
}

export function CustomizeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [committed, setCommitted] = useState<CustomizePrefs>(DEFAULT_PREFS);
  const [draft, setDraft] = useState<CustomizePrefs | null>(null);
  const [ready, setReady] = useState(false);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadPrefs();
      if (cancelled) return;
      setCommitted(loaded);
      applyHtmlAttrs(loaded);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = draft ?? committed;

  // Apply attrs whenever the active prefs change (live preview).
  useEffect(() => {
    applyHtmlAttrs(active);
  }, [active]);

  // Re-resolve system theme on OS-level change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (active.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (): void => applyHtmlAttrs(active);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [active]);

  const beginDraft = useCallback(() => {
    setDraft((d) => d ?? { ...committed });
  }, [committed]);

  const updateDraft = useCallback((u: Updater | Partial<CustomizePrefs>) => {
    setDraft((d) => {
      const base = d ?? committed;
      const next = typeof u === 'function' ? u(base) : { ...base, ...u };
      return next;
    });
  }, [committed]);

  const commit = useCallback(async () => {
    const toSave = draft ?? committed;
    setCommitted(toSave);
    setDraft(null);
    await savePrefs(toSave);
  }, [draft, committed]);

  const cancel = useCallback(() => {
    setDraft(null);
    applyHtmlAttrs(committed);
  }, [committed]);

  const reset = useCallback(async () => {
    const fresh = await resetPrefs();
    setCommitted(fresh);
    setDraft(null);
    applyHtmlAttrs(fresh);
  }, []);

  const value = useMemo<CustomizeContextValue>(
    () => ({
      prefs: active,
      isDraft: draft !== null,
      beginDraft,
      updateDraft,
      commit,
      cancel,
      reset,
      ready,
    }),
    [active, draft, beginDraft, updateDraft, commit, cancel, reset, ready],
  );

  return <CustomizeContext.Provider value={value}>{children}</CustomizeContext.Provider>;
}

export function useCustomize(): CustomizeContextValue {
  const ctx = useContext(CustomizeContext);
  if (!ctx) throw new Error('useCustomize must be used inside <CustomizeProvider>');
  return ctx;
}

/** Lightweight subscription hook for components that only need the prefs
 *  (not the mutation API). Equivalent to `useCustomize().prefs` but cheaper
 *  to type at call sites. */
export function useCustomizePrefs(): CustomizePrefs {
  return useCustomize().prefs;
}

/** Helper for a11y dialogs to trap focus inside an element. Returns
 *  attach/detach helpers. Pure DOM, no deps. */
export function useFocusTrap(active: boolean, ref: React.RefObject<HTMLElement>): void {
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const focusables = (): HTMLElement[] =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);

    const first = focusables()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const cur = document.activeElement as HTMLElement | null;
      const firstEl = list[0]!;
      const lastEl = list[list.length - 1]!;
      if (e.shiftKey && cur === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && cur === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus();
    };
  }, [active, ref]);
}
