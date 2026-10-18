/**
 * Leafy, the floating pet: a click-through overlay sized by `settings.leafy.size`, bottom-right by
 * default, dragged by the renderer through `leafy:moveTo`, with its position kept in `leafy.json`
 * (other keys in that file belong to other modules and are preserved).
 */
import { Menu, screen, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import { z } from 'zod';
import type { Settings } from '../../shared/settings';
import type { JsonStore } from '../services';
import { applyOverlayBehaviour, createSecureWindow, overlayOptions, type WindowEnv } from './common';
import {
  centerOf, clampToArea, cornerOf, LEAFY_SIZES, leafyDefaultBounds, resizeAnchored, type Point, type Rect, type Size,
} from './geometry';

export const LEAFY_STORE = 'leafy';
export type LeafyFile = Readonly<Record<string, unknown>> & { readonly position?: Point | null };

const PositionSchema = z.object({ x: z.number().int(), y: z.number().int() });

/** Accepts any JSON object so keys owned by other modules survive; only `position` is ours. */
export function validateLeafyFile(raw: unknown): LeafyFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('leafy.json is not an object');
  return raw as LeafyFile;
}

export function savedPosition(file: LeafyFile): Point | null {
  const parsed = PositionSchema.safeParse(file.position);
  return parsed.success ? parsed.data : null;
}

export interface LeafyDeps {
  readonly env: WindowEnv;
  readonly size: () => Settings['leafy']['size'];
  readonly store: JsonStore<LeafyFile>;
  readonly menuTemplate: () => MenuItemConstructorOptions[];
}

export interface LeafyController {
  show(): void;
  hide(): void;
  isVisible(): boolean;
  setInteractive(interactive: boolean): void;
  moveTo(x: number, y: number): void;
  persistPosition(): void;
  position(): { x: number; y: number; corner: 'left' | 'right' };
  popupMenu(): void;
  applySize(size: Settings['leafy']['size']): void;
  current(): BrowserWindow | null;
  destroy(): void;
}

const roundPoint = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) });

function areaFor(rect: Rect): Rect {
  return screen.getDisplayNearestPoint(roundPoint(centerOf(rect))).workArea;
}

function restoreBounds(file: LeafyFile, size: Size): Rect {
  const saved = savedPosition(file);
  if (!saved) return leafyDefaultBounds(screen.getPrimaryDisplay().workArea, size);
  const rect = { ...saved, ...size };
  // The display Leafy was on may be gone (unplugged monitor): clamp to the closest visible one.
  return clampToArea(rect, screen.getDisplayMatching(rect).workArea);
}

export function createLeafy(deps: LeafyDeps): LeafyController {
  const { env, store } = deps;
  const initialSize = LEAFY_SIZES[deps.size()];
  const win = createSecureWindow(env, 'leafy', overlayOptions(env.isMac, initialSize));
  applyOverlayBehaviour(win, 'floating');
  win.setBounds(restoreBounds(store.read(), initialSize));
  const alive = (): boolean => !win.isDestroyed();

  const persistPosition = (): void => {
    if (!alive()) return;
    const { x, y } = win.getBounds();
    store.update((current) => ({ ...current, position: { x, y } }));
  };

  const keepOnScreen = (): void => {
    if (!alive()) return;
    const bounds = win.getBounds();
    win.setBounds(clampToArea(bounds, areaFor(bounds)));
  };
  screen.on('display-removed', keepOnScreen);
  screen.on('display-metrics-changed', keepOnScreen);

  return {
    show: () => alive() && win.showInactive(),
    hide: () => alive() && win.hide(),
    isVisible: () => alive() && win.isVisible(),
    setInteractive(interactive) {
      if (alive()) win.setIgnoreMouseEvents(!interactive, { forward: true });
    },
    moveTo(x, y) {
      if (!alive()) return;
      const { width, height } = win.getBounds();
      const target = { x: Math.round(x), y: Math.round(y), width, height };
      win.setBounds(clampToArea(target, areaFor(target)));
    },
    persistPosition,
    position() {
      const bounds = alive() ? win.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
      const corner = alive() ? cornerOf(bounds, areaFor(bounds)) : 'right';
      return { x: bounds.x, y: bounds.y, corner };
    },
    popupMenu() {
      if (alive()) Menu.buildFromTemplate(deps.menuTemplate()).popup({ window: win });
    },
    applySize(size) {
      if (!alive()) return;
      const bounds = win.getBounds();
      win.setBounds(resizeAnchored(bounds, LEAFY_SIZES[size], areaFor(bounds)));
      persistPosition();
    },
    current: () => (alive() ? win : null),
    destroy() {
      screen.removeListener('display-removed', keepOnScreen);
      screen.removeListener('display-metrics-changed', keepOnScreen);
      if (alive()) win.destroy();
    },
  };
}
