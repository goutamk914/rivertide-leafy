/**
 * Menu-bar / system-tray icon. macOS uses a template image (tinted by the system); Windows and
 * Linux use the colour icon, and a left click opens the Leafy palette there.
 */
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { guarded } from './guard';
import type { AppContext } from './services';

export interface TrayActions {
  dictate(): void;
  talk(): void;
  search(): void;
  openDashboard(): void;
  toggleLeafy(): void;
  quit(): void;
}

/** Icons are copied next to main.cjs by scripts/build-main.mjs. */
export function trayIconPath(isMac: boolean, iconDir: string = join(__dirname, 'icons')): string {
  return join(iconDir, isMac ? 'trayTemplate.png' : 'tray.png');
}

export function trayMenuTemplate(actions: TrayActions, leafyVisible: boolean): MenuItemConstructorOptions[] {
  return [
    { label: 'Start dictation', click: actions.dictate },
    { label: 'Talk to Leafy', click: actions.talk },
    { label: 'Search with Leafy', click: actions.search },
    { type: 'separator' },
    { label: 'Open Rivertide', click: actions.openDashboard },
    { label: leafyVisible ? 'Hide Leafy' : 'Show Leafy', click: actions.toggleLeafy },
    { type: 'separator' },
    { label: 'Quit Rivertide', click: actions.quit },
  ];
}

export interface TrayHandle {
  destroy(): void;
}

export function createTray(ctx: AppContext): TrayHandle {
  const log = ctx.logger.child('tray');
  const isMac = ctx.platform === 'darwin';
  const image = nativeImage.createFromPath(trayIconPath(isMac));
  if (image.isEmpty()) log.warn('tray icon not found; run the build to copy icons', { path: trayIconPath(isMac) });
  if (isMac) image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip('Rivertide');

  const actions: TrayActions = {
    dictate: guarded(log, 'Start dictation', () => ctx.voice.start('dictate', 'tray')),
    talk: guarded(log, 'Talk to Leafy', () => ctx.voice.start('command', 'tray')),
    search: guarded(log, 'Search with Leafy', () => ctx.windows.palette.show('search')),
    openDashboard: guarded(log, 'Open Rivertide', () => ctx.windows.dashboard.show()),
    toggleLeafy: guarded(log, 'Show/Hide Leafy', () => {
      const visible = ctx.settings.get().leafy.visible;
      ctx.settings.update({ leafy: { visible: !visible } });
    }),
    quit: () => app.quit(),
  };

  const rebuild = (): void => {
    tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate(actions, ctx.settings.get().leafy.visible)));
  };
  rebuild();
  const unsubscribe = ctx.bus.on('settings:changed', rebuild);
  if (!isMac) tray.on('click', actions.search);

  return {
    destroy() {
      unsubscribe();
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
