/**
 * OS privacy permissions (`ctx.permissions`): microphone, Accessibility, screen recording, the
 * native helper, and deep links into System Settings for the ones apps can't request directly.
 */
import { shell, systemPreferences } from 'electron';
import type { MediaPermission, PermissionStatus } from '../shared/types';
import type { AppContext, PermissionKind, PermissionsService } from './services';

/** The parts of Electron used here (injectable for tests). */
export interface PermissionDeps {
  readonly systemPreferences: {
    getMediaAccessStatus(mediaType: 'microphone' | 'camera' | 'screen'): string;
    askForMediaAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>;
    isTrustedAccessibilityClient(prompt: boolean): boolean;
  };
  readonly openExternal: (url: string) => Promise<void>;
}

const PRIVACY_PANES: Readonly<Record<PermissionKind, string>> = {
  microphone: 'Privacy_Microphone',
  accessibility: 'Privacy_Accessibility',
  'input-monitoring': 'Privacy_ListenEvent',
  automation: 'Privacy_Automation',
  screen: 'Privacy_ScreenCapture',
};

export function privacySettingsUrl(kind: PermissionKind): string {
  return `x-apple.systempreferences:com.apple.preference.security?${PRIVACY_PANES[kind]}`;
}

const MEDIA_STATES: ReadonlySet<string> = new Set(['granted', 'denied', 'restricted', 'not-determined', 'unknown']);

export function toMediaPermission(value: string): MediaPermission {
  return MEDIA_STATES.has(value) ? (value as MediaPermission) : 'unknown';
}

const defaultDeps = (): PermissionDeps => ({
  systemPreferences,
  openExternal: (url) => shell.openExternal(url),
});

export function createPermissionsService(ctx: AppContext, deps: PermissionDeps = defaultDeps()): PermissionsService {
  const isMac = ctx.platform === 'darwin';
  const log = () => ctx.logger.child('permissions');

  const media = (kind: 'microphone' | 'screen'): MediaPermission => {
    // Linux has no OS-level gate; Windows gates only the microphone.
    if (ctx.platform === 'linux' || (kind === 'screen' && !isMac)) return 'granted';
    try {
      return toMediaPermission(deps.systemPreferences.getMediaAccessStatus(kind));
    } catch (error) {
      log().warn('could not read media permission', { kind, error });
      return 'unknown';
    }
  };

  const accessibility = (prompt: boolean): boolean => {
    if (!isMac) return true;
    try {
      return deps.systemPreferences.isTrustedAccessibilityClient(prompt);
    } catch (error) {
      log().warn('could not read accessibility permission', { error });
      return false;
    }
  };

  const helper = (): PermissionStatus['helper'] => {
    if (!isMac) return 'unsupported';
    try {
      return ctx.os.helperStatus();
    } catch (error) {
      log().warn('could not read helper status', { error });
      return 'unavailable';
    }
  };

  const status = async (): Promise<PermissionStatus> => ({
    microphone: media('microphone'),
    accessibility: accessibility(false),
    screen: media('screen'),
    helper: helper(),
    platform: ctx.platform,
  });

  const openSettings = async (kind: PermissionKind): Promise<void> => {
    if (!isMac) return;
    await deps.openExternal(privacySettingsUrl(kind));
  };

  const request = async (kind: PermissionKind): Promise<PermissionStatus> => {
    if (!isMac) return status();
    if (kind === 'microphone') {
      const current = media('microphone');
      // macOS only shows the prompt once; after a "no" the user must flip it in System Settings.
      if (current === 'not-determined') await deps.systemPreferences.askForMediaAccess('microphone');
      else if (current !== 'granted') await openSettings('microphone');
    } else if (kind === 'accessibility') {
      if (!accessibility(true)) await openSettings('accessibility');
    } else {
      await openSettings(kind);
    }
    return status();
  };

  return { status, request, openSettings };
}
