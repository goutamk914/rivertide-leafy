/**
 * The Dynamic Island overlay: created hidden at startup, shown top-centre of the display under the
 * cursor without ever taking focus, click-through except while the pointer is over its content.
 */
import { screen, type BrowserWindow } from 'electron';
import { applyOverlayBehaviour, createSecureWindow, overlayOptions, type WindowEnv } from './common';
import { ISLAND_SIZE, islandBounds } from './geometry';

export interface IslandController {
  show(): void;
  hide(): void;
  setInteractive(interactive: boolean): void;
  current(): BrowserWindow | null;
  destroy(): void;
}

export function createIsland(env: WindowEnv): IslandController {
  const win = createSecureWindow(env, 'island', overlayOptions(env.isMac, ISLAND_SIZE));
  applyOverlayBehaviour(win, 'screen-saver');
  const alive = (): boolean => !win.isDestroyed();

  return {
    show() {
      if (!alive()) return;
      if (!win.isVisible()) {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        win.setBounds(islandBounds(display.workArea, ISLAND_SIZE));
      }
      win.showInactive();
    },
    hide() {
      if (!alive()) return;
      win.setIgnoreMouseEvents(true, { forward: true });
      win.hide();
    },
    setInteractive(interactive) {
      if (alive()) win.setIgnoreMouseEvents(!interactive, { forward: true });
    },
    current: () => (alive() ? win : null),
    destroy() {
      if (alive()) win.destroy();
    },
  };
}
