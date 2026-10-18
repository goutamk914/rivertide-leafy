/** Window-wide presentation state derived from settings: theme, text size, motion and calm mode. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Settings } from '@shared/settings';
import type { FogLabel } from '@shared/types';
import { invoke } from '../lib/ipc';
import { useIpcQuery } from './hooks/useIpc';

export const CALM_TEXT_BOOST = 1.12;
const FOG_LOOKBACK_DAYS = 14;

export interface Presentation {
  /** Calm mode is active (setting 'on', or 'auto' with a foggy latest reading). */
  readonly calm: boolean;
  /** true / false when the user chose; undefined to follow the OS. */
  readonly reduceMotion: boolean | undefined;
  readonly latestFog: FogLabel | null;
}

const PresentationContext = createContext<Presentation>({ calm: false, reduceMotion: undefined, latestFog: null });

export function usePresentation(): Presentation {
  return useContext(PresentationContext);
}

export function useCalm(): boolean {
  return useContext(PresentationContext).calm;
}

export function isCalm(mode: Settings['appearance']['calmMode'], fog: FogLabel | null): boolean {
  return mode === 'on' || (mode === 'auto' && fog === 'foggy');
}

export function resolveReduceMotion(mode: Settings['appearance']['reduceMotion']): boolean | undefined {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return undefined;
}

const DARK_QUERY = '(prefers-color-scheme: dark)';
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => (hasMatchMedia() ? window.matchMedia(DARK_QUERY).matches : true));
  useEffect(() => {
    if (!hasMatchMedia()) return undefined;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** Applies theme, text scale and motion attributes to <html>, and provides calm mode to pages. */
export function PresentationProvider({ settings, children }: { readonly settings: Settings; readonly children: ReactNode }) {
  const systemDark = useSystemDark();
  const { data: dynamics } = useIpcQuery(() => invoke('insights:dynamics', { days: FOG_LOOKBACK_DAYS }), [], ['dynamics']);
  const latestFog = dynamics?.latest?.label ?? null;
  const { theme, textScale, calmMode, reduceMotion } = settings.appearance;
  const calm = isCalm(calmMode, latestFog);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
    root.style.setProperty('--text-scale', String(textScale * (calm ? CALM_TEXT_BOOST : 1)));
    if (reduceMotion === 'system') delete root.dataset.reduceMotion;
    else root.dataset.reduceMotion = reduceMotion;
    root.dataset.calm = calm ? 'on' : 'off';
  }, [theme, systemDark, textScale, calm, reduceMotion]);

  const value = useMemo<Presentation>(
    () => ({ calm, reduceMotion: resolveReduceMotion(reduceMotion), latestFog }),
    [calm, reduceMotion, latestFog],
  );
  return <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>;
}
