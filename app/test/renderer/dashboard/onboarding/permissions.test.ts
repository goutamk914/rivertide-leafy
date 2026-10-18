import { describe, expect, it } from 'vitest';
import type { PermissionStatus } from '@shared/types';
import {
  GRANT_LABEL, accessibilityState, allGranted, microphoneState,
} from '../../../../src/renderer/dashboard/pages/onboarding/permissions';

const STATUS: PermissionStatus = {
  microphone: 'granted',
  accessibility: true,
  screen: 'not-determined',
  helper: 'running',
  platform: 'darwin',
};

describe('permission states', () => {
  it('maps microphone answers to granted, not yet and blocked', () => {
    // Arrange + Act + Assert
    expect(microphoneState('granted')).toBe('granted');
    expect(microphoneState('not-determined')).toBe('not-yet');
    expect(microphoneState('unknown')).toBe('not-yet');
    expect(microphoneState('denied')).toBe('blocked');
    expect(microphoneState('restricted')).toBe('blocked');
  });

  it('maps accessibility to granted or not yet', () => {
    // Arrange + Act + Assert
    expect(accessibilityState(true)).toBe('granted');
    expect(accessibilityState(false)).toBe('not-yet');
  });

  it('labels each state in words', () => {
    // Arrange + Act + Assert
    expect(GRANT_LABEL).toEqual({ granted: 'Granted', 'not-yet': 'Not yet', blocked: 'Blocked' });
  });

  it('reports all granted only when both microphone and accessibility are allowed', () => {
    // Arrange + Act + Assert
    expect(allGranted(STATUS)).toBe(true);
    expect(allGranted({ ...STATUS, accessibility: false })).toBe(false);
    expect(allGranted({ ...STATUS, microphone: 'denied' })).toBe(false);
  });
});
