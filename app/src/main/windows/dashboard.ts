/**
 * The dashboard (main window): created on first use, hidden (not destroyed) on close so it reopens
 * instantly with its state, and told where to go with a `navigate` event.
 */
import { app, type BrowserWindow } from 'electron';
import { createSecureWindow, sendWhenLoaded, type WindowEnv } from './common';
import { DASHBOARD_MIN_SIZE, DASHBOARD_SIZE } from './geometry';

const BACKGROUND = '#0b0c0b';

export interface DashboardController {
  show(route?: string): void;
  hide(): void;
  isVisible(): boolean;
  current(): BrowserWindow | null;
  destroy(): void;
}

export function createDashboard(env: WindowEnv, isQuitting: () => boolean, onFirstLoad: (win: BrowserWindow) => void): DashboardController {
  let win: BrowserWindow | null = null;

  const create = (): BrowserWindow => {
    const created = createSecureWindow(env, 'dashboard', {
      width: DASHBOARD_SIZE.width,
      height: DASHBOARD_SIZE.height,
      minWidth: DASHBOARD_MIN_SIZE.width,
      minHeight: DASHBOARD_MIN_SIZE.height,
      title: 'Rivertide',
      backgroundColor: BACKGROUND,
      titleBarStyle: env.isMac ? 'hiddenInset' : 'default',
      autoHideMenuBar: !env.isMac,
    }, { spellcheck: true });
    created.once('ready-to-show', () => {
      if (!created.isDestroyed()) created.show();
    });
    created.webContents.once('did-finish-load', () => onFirstLoad(created));
    created.on('close', (event) => {
      if (isQuitting()) return;
      event.preventDefault();
      created.hide();
    });
    created.on('closed', () => {
      if (win === created) win = null;
    });
    return created;
  };

  const reveal = (target: BrowserWindow): void => {
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    // Leafy and the palette never activate the app, so bring Rivertide forward explicitly.
    if (env.isMac) app.focus({ steal: true });
  };

  return {
    show(route) {
      const isNew = win === null || win.isDestroyed();
      if (isNew) win = create();
      const target = win as BrowserWindow;
      if (route) sendWhenLoaded(target, 'navigate', { route });
      // A brand-new window shows itself on ready-to-show (no white flash).
      if (!isNew) reveal(target);
      else if (env.isMac) app.focus({ steal: true });
    },
    hide() {
      if (win && !win.isDestroyed()) win.hide();
    },
    isVisible: () => win !== null && !win.isDestroyed() && win.isVisible(),
    current: () => (win && !win.isDestroyed() ? win : null),
    destroy() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
