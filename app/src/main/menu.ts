/**
 * The application menu. The Edit roles matter even though Rivertide is mostly overlays: without
 * them ⌘C / ⌘V / ⌘A do nothing in the palette and dashboard on macOS.
 */
import { Menu, shell, type MenuItemConstructorOptions } from 'electron';
import type { AppContext } from './services';
import { guarded } from './guard';

export const HELP_URL = 'https://codethecure.org';

export interface AppMenuOptions {
  readonly isMac: boolean;
  readonly isDev: boolean;
  readonly appName: string;
  readonly openSettings: () => void;
  readonly openDashboard: () => void;
  readonly openHelp: () => void;
}

const separator: MenuItemConstructorOptions = { type: 'separator' };

function editMenu(): MenuItemConstructorOptions {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' }, { role: 'redo' }, separator,
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle' }, { role: 'delete' },
      separator, { role: 'selectAll' },
    ],
  };
}

function viewMenu(isDev: boolean): MenuItemConstructorOptions {
  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, separator]
    : [];
  // Zoom stays in production: larger text helps tired eyes.
  return {
    label: 'View',
    submenu: [...devItems, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, separator, { role: 'togglefullscreen' }],
  };
}

export function appMenuTemplate(options: AppMenuOptions): MenuItemConstructorOptions[] {
  const settings: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CommandOrControl+,', click: options.openSettings };
  const open: MenuItemConstructorOptions = { label: 'Open Rivertide', click: options.openDashboard };
  const first: MenuItemConstructorOptions = options.isMac
    ? {
        label: options.appName,
        submenu: [
          { role: 'about', label: `About ${options.appName}` }, separator, settings, open, separator,
          { role: 'services' }, separator, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, separator,
          { role: 'quit', label: `Quit ${options.appName}` },
        ],
      }
    : { label: 'File', submenu: [open, settings, separator, { role: 'quit', label: `Quit ${options.appName}` }] };
  return [
    first,
    editMenu(),
    viewMenu(options.isDev),
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Code the Cure website', click: options.openHelp }] },
  ];
}

export function installAppMenu(ctx: AppContext, appName: string): void {
  const log = ctx.logger.child('menu');
  const template = appMenuTemplate({
    isMac: ctx.platform === 'darwin',
    isDev: ctx.isDev,
    appName,
    openSettings: guarded(log, 'Settings', () => ctx.windows.dashboard.show('/settings')),
    openDashboard: guarded(log, 'Open Rivertide', () => ctx.windows.dashboard.show()),
    openHelp: guarded(log, 'Help', () => shell.openExternal(HELP_URL)),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
