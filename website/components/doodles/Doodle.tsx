import type { ReactNode } from 'react';

interface DoodleProps {
  readonly viewBox: string;
  readonly className?: string;
  readonly strokeWidth?: number;
  readonly children: ReactNode;
}

/**
 * Code the Cure's line-doodle look: round caps, warm off-white strokes, a little green. Paths use
 * pathLength="1" so `.rt-doodle` can draw them in once as they scroll into view. Always decorative.
 */
export function Doodle({ viewBox, className, strokeWidth = 2.4, children }: DoodleProps) {
  return (
    <svg
      viewBox={viewBox}
      className={['rt-doodle', className].filter(Boolean).join(' ')}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** One stroke of a doodle; `order` staggers when it draws in. */
export function Stroke({ d, order = 0, accent = false }: { readonly d: string; readonly order?: number; readonly accent?: boolean }) {
  return <path d={d} pathLength={1} stroke={accent ? 'var(--accent)' : undefined} style={{ '--i': order } as React.CSSProperties} />;
}
