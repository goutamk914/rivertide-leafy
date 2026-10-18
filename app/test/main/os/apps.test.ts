import { describe, expect, it, vi } from 'vitest';
import { createAppsService } from '../../../src/main/os/apps';
import { findMacBundles, parseDesktopEntry, scanApps } from '../../../src/main/os/apps-index';
import {
  cleanSpokenAppName, editDistance, findApp, indexApp, normaliseAppName, scoreKey, searchApps, type IndexedApp,
} from '../../../src/main/os/apps-match';
import type { ExecFn } from '../../../src/main/os/exec';
import { silentLogger } from '../agent/fake-context';

const app = (name: string, extra: string[] = [], bundleId: string | null = null): IndexedApp =>
  indexApp({ name, path: `/Applications/${name}.app`, bundleId }, extra);

const APPS = [
  app('Calendar', [], 'com.apple.iCal'), app('Spotify'), app('Safari'), app('Google Chrome'), app('Music'), app('Notes'),
  app('Visual Studio Code', ['Code']), app('zoom.us', ['zoom.us']), app('System Settings'), app('Microsoft Word'), app('Messages'), app('Photo Booth'),
];
const context = { apps: APPS, defaultBrowser: 'Google Chrome' };

describe('normalisation', () => {
  it('normalises names and strips spoken filler', () => {
    expect(normaliseAppName('Café.app')).toBe('cafe');
    expect(cleanSpokenAppName('the Calendar app')).toBe('calendar');
    expect(cleanSpokenAppName('my notes application')).toBe('notes');
  });

  it('computes edit distance', () => {
    expect(editDistance('spotifi', 'spotify')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
});

describe('findApp', () => {
  it.each([
    ['calendar', 'Calendar'], ['the calendar app', 'Calendar'], ['Spotify', 'Spotify'], ['spot if i', 'Spotify'], ['spotifi', 'Spotify'],
    ['browser', 'Google Chrome'], ['the internet', 'Google Chrome'], ['music', 'Music'], ['word', 'Microsoft Word'], ['vs code', 'Visual Studio Code'],
    ['code', 'Visual Studio Code'], ['zoom', 'zoom.us'], ['settings', 'System Settings'], ['chrome', 'Google Chrome'], ['texts', 'Messages'],
    ['camera', 'Photo Booth'], ['visual studio', 'Visual Studio Code'],
  ])('"%s" → %s', (query, expected) => {
    expect(findApp(query, context)?.name).toBe(expected);
  });

  it.each(['about my feelings', 'the deal', 'it', 'window', ''])('"%s" → no app', (query) => {
    expect(findApp(query, context)).toBeNull();
  });

  it('falls back to Safari when the default browser is unknown', () => {
    expect(findApp('browser', { apps: APPS, defaultBrowser: null })?.name).toBe('Safari');
  });
});

describe('searchApps and scoring', () => {
  it('ranks prefix matches first', () => {
    expect(searchApps('s', APPS, 3).map((entry) => entry.name)).toEqual(['Safari', 'Spotify', 'System Settings']);
    expect(searchApps('', APPS, 3)).toEqual([]);
    expect(searchApps('sa', APPS, 3).map((entry) => entry.name)[0]).toBe('Safari');
    expect(searchApps('mic', APPS, 5).map((entry) => entry.name)).toContain('Microsoft Word');
  });

  it('scores exact > prefix > word > substring', () => {
    expect(scoreKey('notes', 'notes')).toBeGreaterThan(scoreKey('note', 'notes'));
    expect(scoreKey('note', 'notes')).toBeGreaterThan(scoreKey('studio', 'visual studio code'));
    expect(scoreKey('studio', 'visual studio code')).toBeGreaterThan(scoreKey('udio', 'visual studio code'));
  });
});

describe('app discovery', () => {
  it('parses .desktop entries and skips hidden ones', () => {
    expect(parseDesktopEntry('[Desktop Entry]\nType=Application\nName=Firefox\nGenericName=Web Browser\n')).toEqual({ name: 'Firefox', genericName: 'Web Browser' });
    expect(parseDesktopEntry('[Desktop Entry]\nName=Hidden\nNoDisplay=true\n')).toBeNull();
    expect(parseDesktopEntry('[Desktop Entry]\nType=Link\nName=Docs\n')).toBeNull();
  });

  it('finds bundles in the app folders and one level of subfolders', async () => {
    const tree: Record<string, { name: string; isDirectory: boolean }[]> = {
      '/Applications': [{ name: 'Spotify.app', isDirectory: true }, { name: 'Utilities', isDirectory: true }, { name: 'readme.txt', isDirectory: false }],
      '/Applications/Utilities': [{ name: 'Terminal.app', isDirectory: true }],
    };
    const bundles = await findMacBundles('/Users/me', async (dir) => tree[dir] ?? []);
    expect(bundles).toEqual(['/System/Library/CoreServices/Finder.app', '/Applications/Spotify.app', '/Applications/Utilities/Terminal.app']);
  });

  it('reads names and bundle ids from Info.plist', async () => {
    const exec: ExecFn = vi.fn(async (_file, args) => ({
      ok: true, code: 0, stdout: JSON.stringify({ CFBundleIdentifier: args[4].includes('Code') ? 'com.microsoft.VSCode' : 'com.apple.finder', CFBundleName: args[4].includes('Code') ? 'Code' : 'Finder' }),
      stderr: '', timedOut: false, error: null,
    }));
    const tree: Record<string, { name: string; isDirectory: boolean }[]> = { '/Applications': [{ name: 'Visual Studio Code.app', isDirectory: true }] };
    const apps = await scanApps({ platform: 'darwin', home: '/Users/me', env: {}, exec, listDir: async (dir) => tree[dir] ?? [] });
    expect(apps.map((entry) => entry.entry)).toEqual([
      { name: 'Finder', path: '/System/Library/CoreServices/Finder.app', bundleId: 'com.apple.finder' },
      { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', bundleId: 'com.microsoft.VSCode' },
    ]);
    expect(apps[1].keys).toContain('code');
  });
});

describe('createAppsService', () => {
  const deps = (exec: ExecFn) => ({
    platform: 'darwin' as const, exec, home: '/Users/me', env: {}, logger: silentLogger(), defaultBrowser: () => null,
    getFileIcon: vi.fn(async () => 'data:image/png;base64,AAA'), openPath: async () => '', scan: async () => APPS,
  });

  it('indexes, finds and opens apps with `open -a`', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, error: null }));
    const apps = createAppsService(deps(exec));
    await apps.refresh();
    const calendar = apps.find('calendar');
    await apps.open(calendar!);
    expect(exec).toHaveBeenCalledWith('open', ['-a', '/Applications/Calendar.app']);
  });

  it('quits by bundle id through AppleScript without injection', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, error: null }));
    const apps = createAppsService(deps(exec));
    await apps.quit({ name: 'Evil" & do shell script "x', path: '/x.app', bundleId: null });
    await apps.quit({ name: 'Calendar', path: '/c.app', bundleId: 'com.apple.iCal' });
    expect(exec.mock.calls[0][1]).toEqual(['-e', 'tell application "Evil\\" & do shell script \\"x" to quit']);
    expect(exec.mock.calls[1][1]).toEqual(['-e', 'tell application id "com.apple.iCal" to quit']);
  });

  it('caches icons', async () => {
    const service = deps(vi.fn<ExecFn>());
    const apps = createAppsService(service);
    await apps.iconDataUrl('/a.app');
    await apps.iconDataUrl('/a.app');
    expect(service.getFileIcon).toHaveBeenCalledTimes(1);
  });
});
