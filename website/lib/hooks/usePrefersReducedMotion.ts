'use client';

import { useMediaQuery } from './useMediaQuery';

/**
 * Reduced-motion preference that is `false` during prerender and hydration, then follows the OS.
 * Prevents hydration mismatches when a component renders a different tree for reduced motion.
 */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false);
}
