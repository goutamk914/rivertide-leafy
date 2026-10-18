import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { ExecFn, ExecResult } from '../../../src/main/os/exec';
import { isUsefulPath, kindOf, mergeResults, sanitizeQuery, searchFiles, walkSearch } from '../../../src/main/os/files';
import { createMediaControls } from '../../../src/main/os/media';
import { createHelperHost, helperBinaryPath } from '../../../src/main/os/native';
import { createPaster, RESTORE_DELAY_MS, type ClipboardLike, type ClipboardSnapshot } from '../../../src/main/os/paste';
import { createShortcutsControls } from '../../../src/main/os/shortcuts';
import { createSystemControls, parseMacVolume, parsePmsetBattery, screenshotName } from '../../../src/main/os/system';
import type { NativeHelper } from '../../../src/main/os/helper';
import { osExtras } from '../../../src/main/os/extras';
import { fakeOs, silentLogger } from '../agent/fake-context';

const result = (partial: Partial<ExecResult> = {}): ExecResult => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, error: null, ...partial });
const recordingExec = (respond: (file: string, args: readonly string[]) => Partial<ExecResult> = () => ({})) => {
  const calls: [string, readonly string[]][] = [];
  const exec: ExecFn = async (file, args) => { calls.push([file, args]); return result(respond(file, args)); };
  return { exec, calls };
};

describe('file search', () => {
  it('filters hidden, library and bundle-internal paths', () => {
    expect(isUsefulPath('/Users/me/Documents/taxes.pdf', '/Users/me')).toBe(true);
    expect(isUsefulPath('/Users/me/.ssh/id_rsa', '/Users/me')).toBe(false);
    expect(isUsefulPath('/Users/me/Library/Caches/x', '/Users/me')).toBe(false);
    expect(isUsefulPath('/Users/me/code/node_modules/a.js', '/Users/me')).toBe(false);
    expect(isUsefulPath('/Users/me/Pictures/Photos Library.photoslibrary/x.jpg', '/Users/me')).toBe(false);
  });

  it('merges name matches before content matches without duplicates', () => {
    expect(mergeResults(['/h/a.pdf', '/h/b.pdf', ''], ['/h/b.pdf', '/h/c.pdf'], '/h', 10)).toEqual(['/h/a.pdf', '/h/b.pdf', '/h/c.pdf']);
    expect(mergeResults(['/h/a', '/h/b', '/h/c'], [], '/h', 2)).toEqual(['/h/a', '/h/b']);
  });

  it('sanitises queries and names kinds', () => {
    expect(sanitizeQuery('  "tax*" \\ return  ')).toBe('tax return');
    expect(kindOf('a.PDF', false)).toBe('pdf');
    expect(kindOf('Folder', true)).toBe('folder');
  });

  it('uses Spotlight by name and by content on macOS, within the time budget', async () => {
    const home = mkdtempSync(join(tmpdir(), 'rt-home-'));
    writeFileSync(join(home, 'taxes.pdf'), 'x');
    const { exec, calls } = recordingExec(() => ({ stdout: `${join(home, 'taxes.pdf')}\n` }));
    const hits = await searchFiles({ platform: 'darwin', home, exec }, 'taxes', 5);
    expect(calls).toEqual([['mdfind', ['-onlyin', home, '-name', 'taxes']], ['mdfind', ['-onlyin', home, 'taxes']]]);
    expect(hits).toEqual([{ path: join(home, 'taxes.pdf'), name: 'taxes.pdf', kind: 'pdf', modifiedAt: expect.any(String) }]);
  });

  it('walks a bounded tree elsewhere, matching every word', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-walk-'));
    mkdirSync(join(root, 'a', 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'a', 'Insurance Letter 2026.pdf'), 'x');
    writeFileSync(join(root, 'a', 'node_modules', 'insurance letter.js'), 'x');
    writeFileSync(join(root, 'letter.txt'), 'x');
    expect(await walkSearch([root], 'insurance letter', 10)).toEqual([join(root, 'a', 'Insurance Letter 2026.pdf')]);
  });
});

describe('system controls (macOS commands, never executed for real)', () => {
  it('parses volume, battery and screenshot names', () => {
    expect(parseMacVolume('output volume:44, input volume:75, alert volume:100, output muted:false')).toEqual({ level: 44, muted: false });
    expect(parseMacVolume('output volume:missing value, output muted:missing value')).toBeNull();
    expect(parsePmsetBattery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t85%; discharging; 4:12 remaining present: true")).toEqual({ percent: 85, charging: false, onBattery: true });
    expect(parsePmsetBattery("Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t100%; charged; 0:00 remaining")).toEqual({ percent: 100, charging: true, onBattery: false });
    expect(parsePmsetBattery("Now drawing from 'AC Power'")).toBeNull();
    expect(screenshotName(new Date(2026, 9, 15, 14, 3, 7))).toBe('Rivertide screenshot 2026-10-15 at 14.03.07.png');
  });

  it('builds the right commands', async () => {
    const { exec, calls } = recordingExec((file) => (file === 'osascript' ? { stdout: 'output volume:40, output muted:false' } : {}));
    const system = createSystemControls({ platform: 'darwin', exec, desktopDir: '/Users/me/Desktop', openExternal: vi.fn(), readTextFile: async () => null });

    expect(await system.changeVolume(10)).toEqual({ level: 50, muted: false });
    await system.setVolume(150);
    await system.setDarkMode(true);
    await system.sleepDisplay();
    const path = await system.screenshot(new Date(2026, 9, 15, 14, 3, 7));
    await system.openSettings('sound');

    expect(calls).toEqual([
      ['osascript', ['-e', 'get volume settings']],
      ['osascript', ['-e', 'set volume output volume 50 without output muted']],
      ['osascript', ['-e', 'set volume output volume 100 without output muted']],
      ['osascript', ['-e', 'tell application "System Events" to tell appearance preferences to set dark mode to true']],
      ['pmset', ['displaysleepnow']],
      ['screencapture', ['-x', '/Users/me/Desktop/Rivertide screenshot 2026-10-15 at 14.03.07.png']],
      ['open', ['x-apple.systempreferences:com.apple.preference.sound']],
    ]);
    expect(path).toBe('/Users/me/Desktop/Rivertide screenshot 2026-10-15 at 14.03.07.png');
  });

  it('explains permission problems and unavailable features', async () => {
    const failing = recordingExec(() => ({ ok: false, error: 'exited with code 1' })).exec;
    const mac = createSystemControls({ platform: 'darwin', exec: failing, desktopDir: '/d', openExternal: vi.fn(), readTextFile: async () => null });
    await expect(mac.lockScreen()).rejects.toThrow(/Privacy & Security/);
    const windows = createSystemControls({ platform: 'win32', exec: failing, desktopDir: '/d', openExternal: vi.fn(), readTextFile: async () => null });
    await expect(windows.setDarkMode(true)).rejects.toThrow('Switching dark mode isn’t available on this computer yet.');
  });
});

describe('paste', () => {
  function clipboard(initial: string) {
    let text = initial;
    const saved: ClipboardSnapshot = [{ 'text/plain': initial, 'text/html': '<b>x</b>' }];
    const restored: ClipboardSnapshot[] = [];
    const board: ClipboardLike = {
      readText: async () => text,
      writeText: async (value) => { text = value; },
      snapshot: async () => saved,
      restore: async (snapshot) => { restored.push(snapshot); text = initial; },
    };
    return { board, restored, current: () => text, set: (value: string) => { text = value; } };
  }
  const deps = (board: ClipboardLike, helper: Parameters<typeof createPaster>[0]['helper'], exec: ExecFn = recordingExec().exec) => {
    const scheduled: (() => void)[] = [];
    return { scheduled, paster: createPaster({ platform: 'darwin', clipboard: board, helper, exec, logger: silentLogger(), wait: async () => undefined, schedule: (fn) => { scheduled.push(fn); } }) };
  };

  it('pastes through the helper into the target app and restores the clipboard', async () => {
    const cb = clipboard('previous');
    const helper = { isReady: () => true, paste: vi.fn(async () => undefined), typeText: vi.fn() };
    const { paster, scheduled } = deps(cb.board, helper);

    expect(await paster.paste('new text', { name: 'Notes', bundleId: 'com.apple.Notes', pid: 1 })).toBe(true);
    expect(helper.paste).toHaveBeenCalledWith('com.apple.Notes');
    expect(cb.current()).toBe('new text');
    scheduled.forEach((fn) => fn());
    await Promise.resolve();
    await Promise.resolve();
    expect(cb.restored).toHaveLength(1);
    expect(RESTORE_DELAY_MS).toBe(400);
  });

  it('back-to-back pastes leave the user’s ORIGINAL clipboard in the end', async () => {
    let text = 'my original';
    const original: ClipboardSnapshot = [{ 'text/plain': 'my original' }];
    const restored: ClipboardSnapshot[] = [];
    const board: ClipboardLike = {
      readText: async () => text,
      writeText: async (value) => { text = value; },
      snapshot: async () => [{ 'text/plain': text }],
      restore: async (snapshot) => { restored.push(snapshot); text = String(snapshot[0]?.['text/plain'] ?? ''); },
    };
    const { paster, scheduled } = deps(board, { isReady: () => true, paste: async () => undefined, typeText: vi.fn() });

    await Promise.all([paster.paste('first dictation', null), paster.paste('second dictation', null)]);
    scheduled.forEach((fn) => fn());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(restored).toEqual([original]);
    expect(text).toBe('my original');
  });

  it('serialises concurrent pastes in call order', async () => {
    const order: string[] = [];
    const cb = clipboard('');
    const { paster } = deps(cb.board, { isReady: () => true, paste: async () => { order.push(cb.current()); }, typeText: vi.fn() });
    await Promise.all([paster.paste('one', null), paster.paste('two', null), paster.paste('three', null)]);
    expect(order).toEqual(['one', 'two', 'three']);
  });

  it('does not restore if the user copied something else meanwhile', async () => {
    const cb = clipboard('previous');
    const { paster, scheduled } = deps(cb.board, { isReady: () => true, paste: async () => undefined, typeText: vi.fn() });
    await paster.paste('new text', null);
    cb.set('user copied this');
    scheduled.forEach((fn) => fn());
    await Promise.resolve();
    expect(cb.restored).toHaveLength(0);
  });

  it('falls back to AppleScript, refusing unsafe bundle ids', async () => {
    const cb = clipboard('');
    const { exec, calls } = recordingExec();
    const { paster } = deps(cb.board, null, exec);
    await paster.paste('x', { name: 'Evil', bundleId: 'a" to quit', pid: 1 });
    expect(calls[0]).toEqual(['osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']]);
  });

  it('leaves the text on the clipboard when the keystroke fails', async () => {
    const cb = clipboard('previous');
    const { paster, scheduled } = deps(cb.board, null, recordingExec(() => ({ ok: false })).exec);
    expect(await paster.paste('keep me', null)).toBe(false);
    expect(cb.current()).toBe('keep me');
    expect(scheduled).toHaveLength(0);
  });
});

describe('media, shortcuts and the native helper host', () => {
  it('sends media keys through the helper and explains when it is missing', async () => {
    const helper = { isReady: () => true, mediaKey: vi.fn(async () => undefined) };
    await createMediaControls({ platform: 'darwin', exec: recordingExec().exec, helper }).press('next');
    expect(helper.mediaKey).toHaveBeenCalledWith('next');
    await expect(createMediaControls({ platform: 'darwin', exec: recordingExec().exec, helper: null }).press('next')).rejects.toThrow(/Accessibility/);
  });

  it('runs only shortcuts that exist, matching names case-insensitively', async () => {
    const { exec, calls } = recordingExec((_file, args) => (args[0] === 'list' ? { stdout: 'Morning Meds\nCall Mom\n' } : { stdout: 'done' }));
    const shortcuts = createShortcutsControls({ platform: 'darwin', exec });
    expect(await shortcuts.run('morning meds')).toEqual({ name: 'Morning Meds', output: 'done' });
    expect(calls[1]).toEqual(['shortcuts', ['run', 'Morning Meds']]);
    await expect(shortcuts.run('delete everything')).rejects.toThrow('I couldn’t find a shortcut called “delete everything”.');
  });

  it('finds the helper next to the app code when running unpackaged (`electron .`)', () => {
    const electronResources = '/repo/node_modules/electron/dist/Electron.app/Contents/Resources';
    expect(helperBinaryPath({ isPackaged: false, appPath: '/repo/app', resourcesPath: electronResources })).toBe('/repo/app/native/rivertide-helper');
  });

  it('finds the helper in the bundle resources when packaged', () => {
    expect(helperBinaryPath({ isPackaged: true, appPath: '/Applications/Rivertide.app/Contents/Resources/app.asar', resourcesPath: '/Applications/Rivertide.app/Contents/Resources' }))
      .toBe('/Applications/Rivertide.app/Contents/Resources/native/rivertide-helper');
  });

  it('tracks helper status and fans out fn keys', () => {
    const fake = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn(), isRunning: true });
    const host = createHelperHost({ platform: 'darwin', binaryPath: '/h', logger: silentLogger(), createHelper: () => fake as unknown as NativeHelper });
    const keys: boolean[] = [];
    host.onFnKey((event) => keys.push(event.down));
    host.start();
    expect(host.status()).toBe('unavailable');
    fake.emit('ready', { version: 1, accessibility: true });
    expect(host.status()).toBe('running');
    fake.emit('key', { key: 'fn', down: true, mods: { ctrl: false, shift: false, alt: false, cmd: false }, t: 1 });
    expect(keys).toEqual([true]);
    expect(createHelperHost({ platform: 'linux', binaryPath: '/h', logger: silentLogger() }).status()).toBe('unsupported');
  });

  it('exposes extras only when the OS layer provides them', () => {
    expect(osExtras(fakeOs())).toBeNull();
  });
});
