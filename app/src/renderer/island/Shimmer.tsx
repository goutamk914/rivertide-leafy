export interface ShimmerProps {
  readonly text: string;
  readonly reducedMotion: boolean;
}

/**
 * Calm working text: a soft band of light passes over the words. Transform-only — an outer window
 * slides one way while an inner copy of the text slides back, so the letters stay put.
 * Holds still under reduced motion.
 */
export function Shimmer({ text, reducedMotion }: ShimmerProps) {
  return (
    <span className="il-shimmer">
      <span className="il-shimmer__base">{text}</span>
      {reducedMotion ? null : (
        <span className="il-shimmer__window" aria-hidden="true">
          <span className="il-shimmer__glint">{text}</span>
        </span>
      )}
    </span>
  );
}
