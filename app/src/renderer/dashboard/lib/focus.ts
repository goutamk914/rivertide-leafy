/**
 * Focus helpers for list pages. After a delete or rename the focused element often disappears;
 * these move focus to a sensible neighbour once React has rendered the change.
 */

/** Waits two animation frames (render + layout), then focuses the first selector that matches. */
export function focusSoon(...selectors: readonly string[]): void {
  if (typeof window === 'undefined') return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const selector of selectors) {
        const el = document.querySelector<HTMLElement>(selector);
        if (el) {
          el.focus();
          return;
        }
      }
    }),
  );
}

/** The item to select after removing `id`: the next one, else the previous one, else null. */
export function neighbourOf<T extends { readonly id: string }>(items: readonly T[], id: string): T | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  return items[index + 1] ?? items[index - 1] ?? null;
}

/** CSS attribute selector for a data-id value (ids are base36, but escape anyway). */
export function byDataId(attribute: string, id: string): string {
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
  return `[${attribute}="${escaped}"]`;
}
