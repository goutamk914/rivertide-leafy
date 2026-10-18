import { useId } from 'react';

export interface SparklineProps {
  /** One value per day, oldest first; null = no data that day (drawn as a gap). */
  readonly values: readonly (number | null)[];
  /** Accessible summary, e.g. "Fog index over the last 14 days, lower is clearer". */
  readonly label: string;
  readonly width?: number;
  readonly height?: number;
  readonly min?: number;
  readonly max?: number;
}

const PAD = 4;

/** Builds an SVG path for `values`, breaking the line at nulls. Exported for tests. */
export function sparklinePath(values: readonly (number | null)[], width: number, height: number, min: number, max: number): string {
  if (values.length === 0) return '';
  const span = max - min || 1;
  const step = values.length > 1 ? (width - PAD * 2) / (values.length - 1) : 0;
  let path = '';
  let penDown = false;
  values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      penDown = false;
      return;
    }
    const x = PAD + i * step;
    const y = PAD + (1 - (value - min) / span) * (height - PAD * 2);
    path += `${penDown ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
    penDown = true;
  });
  return path.trim();
}

/** Tiny single-series trend line with an end dot. Decorative detail; the label carries the meaning. */
export function Sparkline({ values, label, width = 120, height = 32, min = 0, max = 100 }: SparklineProps) {
  const titleId = useId();
  const path = sparklinePath(values, width, height, min, max);
  const lastIndex = values.reduce<number>((found, v, i) => (v === null ? found : i), -1);
  const last = lastIndex >= 0 ? values[lastIndex] : null;
  const step = values.length > 1 ? (width - PAD * 2) / (values.length - 1) : 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={titleId}>
      <title id={titleId}>{label}</title>
      <path d={path} fill="none" stroke="var(--viz-series)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {last !== null && last !== undefined ? (
        <circle
          cx={PAD + lastIndex * step}
          cy={PAD + (1 - (last - min) / (max - min || 1)) * (height - PAD * 2)}
          r={4}
          fill="var(--viz-series)"
          stroke="var(--surface-1)"
          strokeWidth={2}
        />
      ) : null}
    </svg>
  );
}
