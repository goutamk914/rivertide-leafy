import { useEffect, useState } from 'react';
import { usePresentation } from '../../app-context';

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

function systemPrefersReduced(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(REDUCE_QUERY).matches;
}

/** The user's motion choice from Settings, or the OS preference when they chose "system". */
export function useReducedMotionPreference(): boolean {
  const { reduceMotion } = usePresentation();
  const [system, setSystem] = useState(systemPrefersReduced);

  useEffect(() => {
    if (reduceMotion !== undefined || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(REDUCE_QUERY);
    const onChange = (event: MediaQueryListEvent) => setSystem(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [reduceMotion]);

  return reduceMotion ?? system;
}
