import { useEffect, useSyncExternalStore } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the inline script in web/index.html. */
export const THEME_STORAGE_KEY = 'sonarr.theme';

const listeners = new Set<() => void>();

function isPreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function systemPrefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-color-scheme: light)').matches;
}

export function getTheme(): ThemePreference {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isPreference(saved)) return saved;
  } catch {
    // Storage may be unavailable (private mode); fall back to system.
  }
  return 'system';
}

export function resolveTheme(pref: ThemePreference = getTheme()): ResolvedTheme {
  if (pref === 'system') return systemPrefersLight() ? 'light' : 'dark';
  return pref;
}

/** Writes data-theme on <html> for the given preference. */
export function applyTheme(pref: ThemePreference = getTheme()): ResolvedTheme {
  const resolved = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
}

function notify() {
  for (const l of listeners) l();
}

/** Persists and applies a theme preference. */
export function setTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // ignore
  }
  applyTheme(pref);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current preference and resolved theme; follows OS changes while on 'system'. */
export function useTheme(): {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (pref: ThemePreference) => void;
} {
  const theme = useSyncExternalStore(subscribe, getTheme, () => 'system' as ThemePreference);
  const resolvedTheme = useSyncExternalStore(
    subscribe,
    () => resolveTheme(theme),
    () => 'dark' as ResolvedTheme,
  );

  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      applyTheme('system');
      notify();
    };
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, [theme]);

  return { theme, resolvedTheme, setTheme };
}
