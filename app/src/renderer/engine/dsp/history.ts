/** The last `count` items of `items` as a new array (`slice(-0)` would return everything). */
export function keepLast<T>(items: readonly T[], count: number): T[] {
  return count > 0 ? items.slice(-count) : [];
}

/** Appends `item` and keeps at most `capacity` items, returning a new array. */
export function appendBounded<T>(items: readonly T[], item: T, capacity: number): T[] {
  return [...keepLast(items, capacity - 1), item];
}
