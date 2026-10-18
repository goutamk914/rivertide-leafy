import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {}, Menu: {}, nativeImage: {}, shell: {}, Tray: class {} }));

import { appMenuTemplate } from '../../../src/main/menu';
import { trayIconPath, trayMenuTemplate, type TrayActions } from '../../../src/main/tray';
import { leafyMenuTemplate, type LeafyMenuActions } from '../../../src/main/windows/leafy-menu';
import { memoryLogger } from './fakes';

const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => item.label ?? item.role ?? item.type);
const submenu = (item: MenuItemConstructorOptions | undefined) => (item?.submenu ?? []) as MenuItemConstructorOptions[];
const click = (item: MenuItemConstructorOptions | undefined) =>
  (item?.click as unknown as (() => void) | undefined)?.();

const menuOptions = (overrides: Partial<Parameters<typeof appMenuTemplate>[0]> = {}) => ({
  isMac: true, isDev: false, appName: 'Rivertide', openSettings: vi.fn(), openDashboard: vi.fn(), openHelp: vi.fn(), ...overrides,
});

describe('application menu', () => {
  it('has the Edit roles that make copy and paste work', () => {
    // Act
    const edit = appMenuTemplate(menuOptions()).find((item) => item.label === 'Edit');

    // Assert
    expect(submenu(edit).map((item) => item.role).filter(Boolean)).toEqual(
      expect.arrayContaining(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']),
    );
  });

  it('has Settings… on ⌘, in the macOS app menu', () => {
    // Arrange
    const options = menuOptions();

    // Act
    const settings = submenu(appMenuTemplate(options)[0]).find((item) => item.label === 'Settings…');
    click(settings);

    // Assert
    expect(settings?.accelerator).toBe('CommandOrControl+,');
    expect(options.openSettings).toHaveBeenCalledOnce();
  });

  it('shows reload and devtools only in development', () => {
    const roles = (isDev: boolean) => submenu(appMenuTemplate(menuOptions({ isDev })).find((i) => i.label === 'View')).map((i) => i.role);
    expect(roles(false)).not.toContain('toggleDevTools');
    expect(roles(false)).not.toContain('reload');
    expect(roles(true)).toEqual(expect.arrayContaining(['reload', 'toggleDevTools']));
  });

  it('uses a File menu instead of the app menu on Windows and Linux', () => {
    expect(appMenuTemplate(menuOptions({ isMac: false }))[0]?.label).toBe('File');
  });
});

describe('Leafy menu', () => {
  const actions = (): LeafyMenuActions => ({ talk: vi.fn(), search: vi.fn(), openDashboard: vi.fn(), hideLeafy: vi.fn(), quit: vi.fn() });

  it('lists the actions in the agreed order', () => {
    expect(labels(leafyMenuTemplate(actions(), memoryLogger()))).toEqual([
      'Talk to Leafy', 'Search with Leafy', 'Open Rivertide', 'separator', 'Hide Leafy', 'Settings…', 'separator', 'Quit Rivertide',
    ]);
  });

  it('opens settings on the settings route', () => {
    // Arrange
    const leafyActions = actions();
    const template = leafyMenuTemplate(leafyActions, memoryLogger());

    // Act
    click(template.find((item) => item.label === 'Settings…'));

    // Assert
    expect(leafyActions.openDashboard).toHaveBeenCalledWith('/settings');
  });

  it('logs a failing action instead of throwing', () => {
    // Arrange
    const logger = memoryLogger();
    const leafyActions = { ...actions(), talk: vi.fn(() => { throw new Error('mic busy'); }) };
    const template = leafyMenuTemplate(leafyActions, logger);

    // Act / Assert
    expect(() => click(template[0])).not.toThrow();
    expect(logger.entries).toEqual([expect.objectContaining({ level: 'error', meta: expect.objectContaining({ label: 'Talk to Leafy' }) })]);
  });
});

describe('tray', () => {
  const actions: TrayActions = { dictate: vi.fn(), talk: vi.fn(), search: vi.fn(), openDashboard: vi.fn(), toggleLeafy: vi.fn(), quit: vi.fn() };

  it('offers dictation, Leafy, search, the dashboard, Leafy visibility and quit', () => {
    expect(labels(trayMenuTemplate(actions, true))).toEqual([
      'Start dictation', 'Talk to Leafy', 'Search with Leafy', 'separator', 'Open Rivertide', 'Hide Leafy', 'separator', 'Quit Rivertide',
    ]);
    expect(labels(trayMenuTemplate(actions, false))).toContain('Show Leafy');
  });

  it('uses the template image on macOS and the colour icon elsewhere', () => {
    expect(trayIconPath(true, '/icons')).toBe('/icons/trayTemplate.png');
    expect(trayIconPath(false, '/icons')).toBe('/icons/tray.png');
  });
});
