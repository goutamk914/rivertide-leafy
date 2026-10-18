import { useEffect, useState } from 'react';
import type { Settings } from '@shared/settings';

export type ResolvedTheme = 'dark' | 'light';
type ThemePreference = Settings['appearance']['theme'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Pure: 'system' follows the OS, defaulting to dark (Rivertide is dark-first). */
export function resolveTheme(preference: ThemePreference | undefined, systemIsDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light';
  if (preference === 'dark') return 'dark';
  return systemIsDark ? 'dark' : 'light';
}

function systemIsDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(DARK_QUERY).matches;
}

function useSystemDark(): boolean {
  const [dark, setDark] = useState(systemIsDark);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(DARK_QUERY);
    const update = () => setDark(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return dark;
}

export interface AppearanceOptions {
  /** Apply the colour theme (`data-theme`). The island is always black, so it opts out. */
  readonly theme?: boolean;
  /** Apply `--text-scale`. Fixed-size overlays (island, Leafy) opt out. */
  readonly textScale?: boolean;
}

/**
 * Mirrors appearance settings onto `<html>`: `data-theme`, `--text-scale` and `data-reduce-motion`
 * (tokens.css reads all three). Returns the resolved theme.
 */
export function useApplyAppearance(settings: Settings | null, options: AppearanceOptions = {}): ResolvedTheme {
  const { theme: applyTheme = true, textScale: applyTextScale = true } = options;
  const dark = useSystemDark();
  const theme = resolveTheme(settings?.appearance.theme, dark);
  const scale = settings?.appearance.textScale ?? 1;
  const reduceMotion = settings?.appearance.reduceMotion ?? 'system';

  useEffect(() => {
    const root = document.documentElement;
    if (applyTheme) root.dataset.theme = theme;
    if (applyTextScale) root.style.setProperty('--text-scale', String(scale));
    // 'off' is written too, so CSS can let an in-app "motion on" override the OS preference.
    if (reduceMotion === 'system') delete root.dataset.reduceMotion;
    else root.dataset.reduceMotion = reduceMotion;
  }, [applyTheme, applyTextScale, theme, scale, reduceMotion]);

  return theme;
}
