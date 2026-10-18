/** Pure helpers for the permissions step: what each macOS answer means in plain words. */
import type { MediaPermission, PermissionStatus } from '@shared/types';

/** How often the step re-reads permission status while it is on screen. */
export const PERMISSION_POLL_MS = 2000;

export type GrantState = 'granted' | 'not-yet' | 'blocked';

export const GRANT_LABEL: Readonly<Record<GrantState, string>> = {
  granted: 'Granted',
  'not-yet': 'Not yet',
  blocked: 'Blocked',
};

export function microphoneState(permission: MediaPermission): GrantState {
  if (permission === 'granted') return 'granted';
  if (permission === 'denied' || permission === 'restricted') return 'blocked';
  return 'not-yet';
}

export function accessibilityState(granted: boolean): GrantState {
  return granted ? 'granted' : 'not-yet';
}

export function allGranted(status: PermissionStatus): boolean {
  return microphoneState(status.microphone) === 'granted' && accessibilityState(status.accessibility) === 'granted';
}
