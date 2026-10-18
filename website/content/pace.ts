/**
 * Example speaking pace for two weeks (words per minute of speech), shown on the home page.
 * Illustrative only: the shape is typical (dips the day after an infusion), the numbers are made up
 * and labelled as an example on the page.
 */

export interface PaceDay {
  readonly date: string;
  readonly short: string;
  readonly wpm: number;
}

export const PACE_DAYS: readonly PaceDay[] = [
  { date: 'Mon, Sep 28', short: 'M', wpm: 136 },
  { date: 'Tue, Sep 29', short: 'T', wpm: 139 },
  { date: 'Wed, Sep 30', short: 'W', wpm: 131 },
  { date: 'Thu, Oct 1', short: 'T', wpm: 118 },
  { date: 'Fri, Oct 2', short: 'F', wpm: 124 },
  { date: 'Sat, Oct 3', short: 'S', wpm: 133 },
  { date: 'Sun, Oct 4', short: 'S', wpm: 137 },
  { date: 'Mon, Oct 5', short: 'M', wpm: 135 },
  { date: 'Tue, Oct 6', short: 'T', wpm: 138 },
  { date: 'Wed, Oct 7', short: 'W', wpm: 129 },
  { date: 'Thu, Oct 8', short: 'T', wpm: 114 },
  { date: 'Fri, Oct 9', short: 'F', wpm: 121 },
  { date: 'Sat, Oct 10', short: 'S', wpm: 130 },
  { date: 'Sun, Oct 11', short: 'S', wpm: 134 },
];

function quantile(sorted: readonly number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + (position - base) * (next - sorted[base]);
}

const SORTED = PACE_DAYS.map((day) => day.wpm).sort((a, b) => a - b);

/** Your usual range: the middle half of your own last 14 days. */
export const USUAL_RANGE = {
  low: Math.round(quantile(SORTED, 0.25)),
  high: Math.round(quantile(SORTED, 0.75)),
} as const;

export function describeDay(wpm: number): string {
  if (wpm < USUAL_RANGE.low) return `${USUAL_RANGE.low - wpm} below your usual`;
  if (wpm > USUAL_RANGE.high) return `${wpm - USUAL_RANGE.high} above your usual`;
  return 'within your usual';
}
