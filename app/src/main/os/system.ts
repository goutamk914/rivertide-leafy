/**
 * System controls: volume, appearance, battery, lock/sleep, screenshots, System Settings.
 * macOS is complete; cheap Windows/Linux equivalents exist where a built-in command does the job,
 * everything else throws a friendly "isn't available on this computer" error.
 */
import { join } from 'node:path';
import type { ExecFn, ExecResult } from './exec';
import { runAppleScript } from './exec';
import { notAvailable, OsActionError } from './errors';

export interface VolumeState { readonly level: number; readonly muted: boolean }
export interface BatteryState { readonly percent: number; readonly charging: boolean; readonly onBattery: boolean }

export interface SystemControls {
  getVolume(): Promise<VolumeState | null>;
  setVolume(level: number): Promise<VolumeState>;
  changeVolume(delta: number): Promise<VolumeState>;
  setMuted(muted: boolean): Promise<void>;
  getDarkMode(): Promise<boolean | null>;
  setDarkMode(on: boolean): Promise<void>;
  battery(): Promise<BatteryState | null>;
  lockScreen(): Promise<void>;
  sleepDisplay(): Promise<void>;
  screenshot(now: Date): Promise<string>;
  openSettings(pane: SettingsPane): Promise<void>;
}

export const SETTINGS_PANES = ['general', 'sound', 'display', 'wifi', 'bluetooth', 'notifications', 'privacy', 'accessibility', 'keyboard', 'battery', 'appearance'] as const;
export type SettingsPane = (typeof SETTINGS_PANES)[number];

const MAC_PANES: Readonly<Record<SettingsPane, string>> = {
  general: 'com.apple.systempreferences.GeneralSettings', sound: 'com.apple.preference.sound', display: 'com.apple.preference.displays',
  wifi: 'com.apple.preference.network', bluetooth: 'com.apple.preferences.Bluetooth', notifications: 'com.apple.preference.notifications',
  privacy: 'com.apple.preference.security', accessibility: 'com.apple.preference.universalaccess', keyboard: 'com.apple.preference.keyboard',
  battery: 'com.apple.preference.battery', appearance: 'com.apple.Appearance-Settings.extension',
};
const WINDOWS_PANES: Readonly<Record<SettingsPane, string>> = {
  general: 'ms-settings:', sound: 'ms-settings:sound', display: 'ms-settings:display', wifi: 'ms-settings:network-wifi',
  bluetooth: 'ms-settings:bluetooth', notifications: 'ms-settings:notifications', privacy: 'ms-settings:privacy',
  accessibility: 'ms-settings:easeofaccess', keyboard: 'ms-settings:keyboard', battery: 'ms-settings:batterysaver', appearance: 'ms-settings:colors',
};

export interface SystemDeps {
  readonly platform: NodeJS.Platform;
  readonly exec: ExecFn;
  readonly desktopDir: string;
  readonly openExternal: (url: string) => Promise<void>;
  readonly readTextFile: (path: string) => Promise<string | null>;
}

const clampLevel = (level: number): number => Math.round(Math.min(100, Math.max(0, level)));

/** "output volume:50, input volume:75, alert volume:100, output muted:false" */
export function parseMacVolume(stdout: string): VolumeState | null {
  const level = /output volume:(\d+|missing value)/.exec(stdout)?.[1];
  const muted = /output muted:(true|false)/.exec(stdout)?.[1];
  if (level === undefined || level === 'missing value') return null;
  return { level: Number(level), muted: muted === 'true' };
}

/** `pmset -g batt` → percent / charging; null on Macs without a battery. */
export function parsePmsetBattery(stdout: string): BatteryState | null {
  const match = /(\d{1,3})%;\s*([a-zA-Z ]+?)(?:;|$)/m.exec(stdout);
  if (!match) return null;
  const state = match[2].trim().toLowerCase();
  return { percent: Number(match[1]), charging: state === 'charging' || state === 'charged' || state === 'finishing charge', onBattery: /Battery Power/.test(stdout) };
}

/** "Rivertide screenshot 2026-10-15 at 14.03.22.png" */
export function screenshotName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Rivertide screenshot ${date} at ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.png`;
}

function ensureOk(result: ExecResult, what: string): void {
  if (!result.ok) throw new OsActionError(`I couldn’t ${what}. Rivertide may need permission in System Settings → Privacy & Security.`, { cause: new Error(result.error ?? 'failed') });
}

export function createSystemControls(deps: SystemDeps): SystemControls {
  const mac = deps.platform === 'darwin';
  const linux = deps.platform === 'linux';
  const script = (source: string) => runAppleScript(deps.exec, source);

  async function getVolume(): Promise<VolumeState | null> {
    if (mac) {
      const result = await script('get volume settings');
      return result.ok ? parseMacVolume(result.stdout) : null;
    }
    if (linux) {
      const result = await deps.exec('pactl', ['get-sink-volume', '@DEFAULT_SINK@']);
      const level = /(\d+)%/.exec(result.stdout)?.[1];
      return level ? { level: Number(level), muted: false } : null;
    }
    return null;
  }

  async function setVolume(level: number): Promise<VolumeState> {
    const target = clampLevel(level);
    if (mac) ensureOk(await script(`set volume output volume ${target} without output muted`), 'change the volume');
    else if (linux) ensureOk(await deps.exec('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${target}%`]), 'change the volume');
    else throw notAvailable('Setting an exact volume');
    return { level: target, muted: false };
  }

  async function changeVolume(delta: number): Promise<VolumeState> {
    const current = await getVolume();
    if (!current) throw notAvailable('Changing the volume');
    return setVolume(current.level + delta);
  }

  async function setMuted(muted: boolean): Promise<void> {
    if (mac) return ensureOk(await script(`set volume output muted ${muted}`), muted ? 'mute the sound' : 'unmute the sound');
    if (linux) return ensureOk(await deps.exec('pactl', ['set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0']), 'change mute');
    throw notAvailable('Muting');
  }

  async function getDarkMode(): Promise<boolean | null> {
    if (mac) return (await deps.exec('defaults', ['read', '-g', 'AppleInterfaceStyle'])).stdout.trim() === 'Dark';
    if (linux) return /dark/i.test((await deps.exec('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'])).stdout);
    return null;
  }

  async function setDarkMode(on: boolean): Promise<void> {
    if (mac) return ensureOk(await script(`tell application "System Events" to tell appearance preferences to set dark mode to ${on}`), 'change the appearance');
    if (linux) return ensureOk(await deps.exec('gsettings', ['set', 'org.gnome.desktop.interface', 'color-scheme', on ? 'prefer-dark' : 'default']), 'change the appearance');
    throw notAvailable('Switching dark mode');
  }

  async function battery(): Promise<BatteryState | null> {
    if (mac) return parsePmsetBattery((await deps.exec('pmset', ['-g', 'batt'])).stdout);
    if (linux) {
      const capacity = await deps.readTextFile('/sys/class/power_supply/BAT0/capacity');
      const status = (await deps.readTextFile('/sys/class/power_supply/BAT0/status')) ?? '';
      return capacity ? { percent: Number(capacity.trim()), charging: /^(?:charging|full)$/i.test(status.trim()), onBattery: /^discharging$/i.test(status.trim()) } : null;
    }
    const result = await deps.exec('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_Battery).EstimatedChargeRemaining']);
    const percent = Number(result.stdout.trim());
    return result.ok && Number.isFinite(percent) && result.stdout.trim() ? { percent, charging: false, onBattery: true } : null;
  }

  async function lockScreen(): Promise<void> {
    if (mac) return ensureOk(await script('tell application "System Events" to keystroke "q" using {command down, control down}'), 'lock the screen');
    if (linux) return ensureOk(await deps.exec('loginctl', ['lock-session']), 'lock the screen');
    return ensureOk(await deps.exec('rundll32.exe', ['user32.dll,LockWorkStation']), 'lock the screen');
  }

  async function sleepDisplay(): Promise<void> {
    if (mac) return ensureOk(await deps.exec('pmset', ['displaysleepnow']), 'turn off the display');
    if (linux) return ensureOk(await deps.exec('xset', ['dpms', 'force', 'off']), 'turn off the display');
    throw notAvailable('Turning off the display');
  }

  async function screenshot(now: Date): Promise<string> {
    const path = join(deps.desktopDir, screenshotName(now));
    if (mac) ensureOk(await deps.exec('screencapture', ['-x', path], { timeoutMs: 10_000 }), 'take a screenshot');
    else if (linux) ensureOk(await deps.exec('gnome-screenshot', ['-f', path], { timeoutMs: 10_000 }), 'take a screenshot');
    else throw notAvailable('Taking a screenshot');
    return path;
  }

  async function openSettings(pane: SettingsPane): Promise<void> {
    if (mac) return ensureOk(await deps.exec('open', [`x-apple.systempreferences:${MAC_PANES[pane]}`]), 'open System Settings');
    if (deps.platform === 'win32') return deps.openExternal(WINDOWS_PANES[pane]);
    return ensureOk(await deps.exec('gnome-control-center', pane === 'general' ? [] : [pane === 'display' ? 'display' : pane]), 'open Settings');
  }

  return { getVolume, setVolume, changeVolume, setMuted, getDarkMode, setDarkMode, battery, lockScreen, sleepDisplay, screenshot, openSettings };
}
