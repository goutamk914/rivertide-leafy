'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';

/**
 * Honours the OS reduced-motion setting for every motion component on the site: transforms and
 * layout animations are dropped, opacity changes stay. CSS animations have their own media queries.
 */
export function MotionProvider({ children }: { readonly children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
