import { useEffect, useState } from 'react';
import type { Settings } from '@shared/settings';

export type MotionPreference = Settings['appearance']['reduceMotion'];

const QUERY = '(prefers-reduced-motion: reduce)';

/** Pure: the user's in-app choice wins; 'system' defers to the OS. */
export function resolveReducedMotion(preference: MotionPreference | undefined, systemReduces: boolean): boolean {
  if (preference === 'on') return true;
  if (preference === 'off') return false;
  return systemReduces;
}

function systemPrefersReduced(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** Whether to reduce motion, following the OS setting live. Pass `settings.appearance.reduceMotion`. */
export function useReducedMotion(preference?: MotionPreference): boolean {
  const [system, setSystem] = useState(systemPrefersReduced);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(QUERY);
    const update = () => setSystem(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return resolveReducedMotion(preference, system);
}
