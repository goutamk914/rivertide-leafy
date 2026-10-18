/** Deterministic helpers for the browser mock (`npm run dev:web`) so sample data is stable between reloads. */

export type Rng = () => number;

/** mulberry32: tiny seeded PRNG, good enough for sample data. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length] as T;
}

export function between(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

let counter = 0;

/** `<base36 time><4 chars>`, matching the main-process id format. */
export function mockId(now: number = Date.now()): string {
  counter = (counter + 1) % 1_679_616;
  return `${now.toString(36)}${counter.toString(36).padStart(4, '0')}`;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** ISO string for `now` shifted by `offsetMs`. */
export function isoAt(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

/** ISO string for a local clock time `daysAgo` days before `now`. */
export function isoOnDay(now: Date, daysAgo: number, hour: number, minute: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
  return d.toISOString();
}
