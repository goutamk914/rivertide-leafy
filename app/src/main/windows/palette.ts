/**
 * The Leafy palette (Spotlight-style): created hidden at startup so it opens instantly, centred on
 * the cursor's display at 22 % height, takes focus, hides on blur, and hands focus back to the
 * previous app when it closes (macOS: `app.hide()` when the dashboard isn't open).
 */
import { app, screen, type BrowserWindow } from 'electron';
import { createSecureWindow, sendWhenLoaded, type WindowEnv } from './common';
import { PALETTE_SIZE, paletteBounds, resizeKeepingTop } from './geometry';

/** A blur right after showing is the previous app losing focus, not the user leaving. */
export const BLUR_GRACE_MS = 150;

export interface PaletteController {
  show(mode: 'search' | 'voice', query?: string | null): void;
  hide(): void;
  isVisible(): boolean;
  resize(height: number): void;
  current(): BrowserWindow | null;
  destroy(): void;
}

export function createPalette(env: WindowEnv, isDashboardVisible: () => boolean): PaletteController {
  const win = createSecureWindow(env, 'palette', {
    width: PALETTE_SIZE.width,
    height: PALETTE_SIZE.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
  }, { spellcheck: true });
  win.setAlwaysOnTop(true, 'floating');
  // Appear on the current Space instead of switching back to the one it was created on.
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  const alive = (): boolean => !win.isDestroyed();
  let shownAt = 0;

  const hide = (): void => {
    if (!alive() || !win.isVisible()) return;
    win.hide();
    if (env.isMac && !isDashboardVisible()) app.hide();
  };

  win.on('blur', () => {
    if (Date.now() - shownAt < BLUR_GRACE_MS) return;
    hide();
  });

  return {
    show(mode, query = null) {
      if (!alive()) return;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const { height } = win.getBounds();
      win.setBounds(paletteBounds(display.workArea, { width: PALETTE_SIZE.width, height }));
      shownAt = Date.now();
      win.show();
      // Opened from a global shortcut or Leafy, Rivertide is not the active app: take focus so typing works.
      if (env.isMac) app.focus({ steal: true });
      win.focus();
      sendWhenLoaded(win, 'palette:open', { mode, query: query ?? null });
    },
    hide,
    isVisible: () => alive() && win.isVisible(),
    resize(height) {
      if (!alive()) return;
      const bounds = win.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      win.setBounds(resizeKeepingTop(bounds, height, area));
    },
    current: () => (alive() ? win : null),
    destroy() {
      if (alive()) win.destroy();
    },
  };
}
