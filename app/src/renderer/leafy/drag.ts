/** Pure drag and click maths for moving Leafy around the desktop. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Movement (px) before a press becomes a drag, so a slightly shaky click still clicks. */
export const DRAG_THRESHOLD_PX = 4;
/** Time to wait for a second click before treating the first as a single click. */
export const DOUBLE_CLICK_MS = 280;

export function exceedsDragThreshold(start: Point, current: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

/**
 * Where the window's top-left must go so the pointer keeps holding Leafy at the same spot.
 * `grab` is the pointer's position inside the window at pointerdown (clientX/Y).
 */
export function windowOrigin(pointerScreen: Point, grab: Point): Point {
  return { x: Math.round(pointerScreen.x - grab.x), y: Math.round(pointerScreen.y - grab.y) };
}

export interface ClickGate {
  click(): void;
  dispose(): void;
}

export interface ClickGateOptions {
  readonly onSingle: () => void;
  readonly onDouble: () => void;
  readonly delayMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** Tells single clicks from double clicks: a single fires after `delayMs` unless a second click lands first. */
export function createClickGate({
  onSingle,
  onDouble,
  delayMs = DOUBLE_CLICK_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: ClickGateOptions): ClickGate {
  let pending: unknown = null;
  return {
    click() {
      if (pending !== null) {
        clearTimer(pending);
        pending = null;
        onDouble();
        return;
      }
      pending = setTimer(() => {
        pending = null;
        onSingle();
      }, delayMs);
    },
    dispose() {
      if (pending !== null) clearTimer(pending);
      pending = null;
    },
  };
}
