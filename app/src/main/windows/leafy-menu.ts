/**
 * Leafy's native context menu. Pure template builder: actions are injected, and each one is
 * guarded so a failing action is logged instead of throwing inside a native menu callback.
 */
import type { MenuItemConstructorOptions } from 'electron';
import { guarded } from '../guard';
import type { Logger } from '../services';

export interface LeafyMenuActions {
  talk(): void;
  search(): void;
  openDashboard(route?: string): void;
  hideLeafy(): void;
  quit(): void;
}

export function leafyMenuTemplate(actions: LeafyMenuActions, logger: Logger): MenuItemConstructorOptions[] {
  const item = (label: string, action: () => unknown): MenuItemConstructorOptions => ({ label, click: guarded(logger, label, action) });
  return [
    item('Talk to Leafy', () => actions.talk()),
    item('Search with Leafy', () => actions.search()),
    item('Open Rivertide', () => actions.openDashboard()),
    { type: 'separator' },
    item('Hide Leafy', () => actions.hideLeafy()),
    item('Settings…', () => actions.openDashboard('/settings')),
    { type: 'separator' },
    item('Quit Rivertide', () => actions.quit()),
  ];
}
