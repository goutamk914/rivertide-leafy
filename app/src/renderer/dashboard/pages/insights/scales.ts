/**
 * Pure chart maths for the Insights page: linear, band and point scales, "nice" ticks, and SVG
 * path builders. No DOM and no React, so every function is deterministic and unit-tested.
 */

export type Pair = readonly [number, number];

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface LinearScale {
  readonly domain: Pair;
  readonly range: Pair;
  readonly map: (value: number) => number;
  readonly invert: (pixel: number) => number;
}

export interface BandScale {
  readonly count: number;
  /** Distance between the starts of two neighbouring bands. */
  readonly step: number;
  /** Width of the painted band (step minus the inner padding). */
  readonly bandwidth: number;
  readonly center: (index: number) => number;
  readonly indexAt: (pixel: number) => number;
}

export interface PointScale {
  readonly count: number;
  readonly step: number;
  readonly position: (index: number) => number;
  readonly indexAt: (pixel: number) => number;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export const DEFAULT_TICK_COUNT = 4;
export const DEFAULT_BAND_PADDING = 0.25;
export const COLUMN_RADIUS = 4;

// Thresholds from d3-array's tickIncrement: pick 1, 2, 5 or 10 × 10ⁿ.
const STEP_10 = Math.sqrt(50);
const STEP_5 = Math.sqrt(10);
const STEP_2 = Math.SQRT2;
const PRECISION = 1e9;
const DEGENERATE_PAD_RATIO = 0.1;
const NICE_PASSES = 2;
const PATH_DECIMALS = 100;

/** Rounds away binary noise such as 0.30000000000000004. */
export function tidy(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Maps `domain` onto `range` linearly. A zero-width domain maps everything to the range middle. */
export function linearScale(domain: Pair, range: Pair): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const map = (value: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
  const invert = (pixel: number) => (r1 === r0 ? d0 : d0 + ((pixel - r0) / (r1 - r0)) * span);
  return { domain, range, map, invert };
}

/** The "nice" spacing (1, 2 or 5 × 10ⁿ) for about `count` ticks across [min, max]; 0 when undefined. */
export function tickStep(min: number, max: number, count: number = DEFAULT_TICK_COUNT): number {
  const span = Math.abs(max - min);
  if (!Number.isFinite(span) || span === 0 || count <= 0) return 0;
  const raw = span / count;
  const base = 10 ** Math.floor(Math.log10(raw));
  const error = raw / base;
  const factor = error >= STEP_10 ? 10 : error >= STEP_5 ? 5 : error >= STEP_2 ? 2 : 1;
  return tidy(factor * base);
}

/** Round tick values inside [min, max], e.g. (0, 1284) → 0, 500, 1000. */
export function niceTicks(min: number, max: number, count: number = DEFAULT_TICK_COUNT): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const step = tickStep(lo, hi, count);
  if (step === 0) return [tidy(lo)];
  const first = Math.ceil(tidy(lo / step));
  const last = Math.floor(tidy(hi / step));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => tidy((first + i) * step));
}

/** Widens [min, max] outward to tick boundaries so the top gridline sits at or above the data. */
export function niceDomain(min: number, max: number, count: number = DEFAULT_TICK_COUNT): Pair {
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (lo === hi) {
    const pad = Math.abs(lo) * DEGENERATE_PAD_RATIO || 1;
    lo = lo === 0 ? 0 : lo - pad;
    hi += pad;
  }
  for (let pass = 0; pass < NICE_PASSES; pass += 1) {
    const step = tickStep(lo, hi, count);
    lo = tidy(Math.floor(tidy(lo / step)) * step);
    hi = tidy(Math.ceil(tidy(hi / step)) * step);
  }
  return [lo, hi];
}

/** Evenly spaced bands (columns) across `range`, each centred in its slot. */
export function bandScale(count: number, range: Pair, padding: number = DEFAULT_BAND_PADDING): BandScale {
  const [r0, r1] = range;
  const step = count > 0 ? (r1 - r0) / count : 0;
  const bandwidth = step * (1 - clamp(padding, 0, 1));
  const center = (index: number) => r0 + step * (index + 0.5);
  const indexAt = (pixel: number) => (count > 0 && step > 0 ? clamp(Math.floor((pixel - r0) / step), 0, count - 1) : -1);
  return { count, step, bandwidth, center, indexAt };
}

/** Evenly spaced points (line vertices) from the first to the last pixel of `range`. */
export function pointScale(count: number, range: Pair): PointScale {
  const [r0, r1] = range;
  const step = count > 1 ? (r1 - r0) / (count - 1) : 0;
  const position = (index: number) => (count > 1 ? r0 + index * step : (r0 + r1) / 2);
  const indexAt = (pixel: number) => {
    if (count <= 0) return -1;
    if (count === 1 || step === 0) return 0;
    return clamp(Math.round((pixel - r0) / step), 0, count - 1);
  };
  return { count, step, position, indexAt };
}

/** Up to `maxTicks` evenly spaced indices, always ending on the latest one. */
export function tickIndices(count: number, maxTicks: number): number[] {
  if (count <= 0 || maxTicks <= 0) return [];
  if (count <= maxTicks) return Array.from({ length: count }, (_, i) => i);
  if (maxTicks === 1) return [count - 1];
  const stride = Math.ceil((count - 1) / (maxTicks - 1));
  const indices: number[] = [];
  for (let i = count - 1; i >= 0; i -= stride) indices.push(i);
  return indices.reverse();
}

/** Keeps an axis label inside the plot: anchor to the start or end near the edges. */
export function labelAnchor(x: number, left: number, right: number, halfWidth: number): TextAnchor {
  if (x - halfWidth < left) return 'start';
  if (x + halfWidth > right) return 'end';
  return 'middle';
}

/** Splits a series into runs of consecutive non-null points (a null is a gap, not a zero). */
export function lineSegments(points: readonly (Point | null)[]): Point[][] {
  const segments: Point[][] = [];
  let current: Point[] = [];
  for (const point of points) {
    if (point) {
      current = [...current, point];
      continue;
    }
    if (current.length > 0) segments.push(current);
    current = [];
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

const fmt = (value: number) => String(Math.round(value * PATH_DECIMALS) / PATH_DECIMALS);

/** SVG path for a line that breaks at nulls. Lone points draw nothing here (see `isolatedPoints`). */
export function linePath(points: readonly (Point | null)[]): string {
  return lineSegments(points)
    .filter((segment) => segment.length > 1)
    .map((segment) => segment.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)},${fmt(p.y)}`).join(''))
    .join('');
}

/** Points with no neighbour on either side; they need a marker because a path cannot show them. */
export function isolatedPoints(points: readonly (Point | null)[]): Point[] {
  return lineSegments(points)
    .filter((segment) => segment.length === 1)
    .map((segment) => segment[0] as Point);
}

/** A column with a rounded data end (top) and a square baseline. Empty for zero-size columns. */
export function columnPath(x: number, y: number, width: number, height: number, radius: number = COLUMN_RADIUS): string {
  if (width <= 0 || height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  const right = x + width;
  const bottom = y + height;
  return [
    `M${fmt(x)},${fmt(bottom)}`,
    `V${fmt(y + r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(x + r)},${fmt(y)}`,
    `H${fmt(right - r)}`,
    `A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(right)},${fmt(y + r)}`,
    `V${fmt(bottom)}`,
    'Z',
  ].join('');
}
