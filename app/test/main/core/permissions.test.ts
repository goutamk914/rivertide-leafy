import { describe, expect, it, vi } from 'vitest';
import {
  createPermissionsService, privacySettingsUrl, toMediaPermission, type PermissionDeps,
} from '../../../src/main/permissions';
import { fakeContext } from './fakes';

vi.mock('electron', () => ({ shell: {}, systemPreferences: {} }));

function setup(platform: 'darwin' | 'win32' | 'linux', mic = 'not-determined', trusted = false) {
  const deps: PermissionDeps = {
    systemPreferences: {
      getMediaAccessStatus: vi.fn((kind: string) => (kind === 'microphone' ? mic : 'denied')),
      askForMediaAccess: vi.fn(async () => true),
      isTrustedAccessibilityClient: vi.fn(() => trusted),
    },
    openExternal: vi.fn(async () => undefined),
  };
  const ctx = fakeContext({ platform });
  return { deps, ctx, service: createPermissionsService(ctx, deps) };
}

describe('permissions service', () => {
  it('reports macOS microphone, accessibility, screen and helper state', async () => {
    // Arrange
    const { service } = setup('darwin', 'granted', true);

    // Act
    const status = await service.status();

    // Assert
    expect(status).toEqual({ microphone: 'granted', accessibility: true, screen: 'denied', helper: 'running', platform: 'darwin' });
  });

  it('asks for the microphone only while macOS has not asked yet', async () => {
    // Arrange
    const { service, deps } = setup('darwin', 'not-determined');

    // Act
    await service.request('microphone');

    // Assert
    expect(deps.systemPreferences.askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(deps.openExternal).not.toHaveBeenCalled();
  });

  it('opens System Settings when the microphone was already denied', async () => {
    // Arrange
    const { service, deps } = setup('darwin', 'denied');

    // Act
    await service.request('microphone');

    // Assert
    expect(deps.systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
    expect(deps.openExternal).toHaveBeenCalledWith(privacySettingsUrl('microphone'));
  });

  it('prompts for accessibility and opens the pane when not trusted', async () => {
    // Arrange
    const { service, deps } = setup('darwin', 'granted', false);

    // Act
    await service.request('accessibility');

    // Assert
    expect(deps.systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
    expect(deps.openExternal).toHaveBeenCalledWith(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    );
  });

  it('deep-links input monitoring, automation and screen recording', async () => {
    // Arrange
    const { service, deps } = setup('darwin');

    // Act
    await service.request('input-monitoring');
    await service.openSettings('automation');
    await service.request('screen');

    // Assert
    expect(vi.mocked(deps.openExternal).mock.calls.map(([url]) => url.split('?')[1])).toEqual([
      'Privacy_ListenEvent', 'Privacy_Automation', 'Privacy_ScreenCapture',
    ]);
  });

  it('is a no-op on Linux and Windows without OS prompts', async () => {
    // Arrange
    const linux = setup('linux');
    const windows = setup('win32', 'granted');

    // Act
    const linuxStatus = await linux.service.request('microphone');
    await windows.service.openSettings('microphone');
    const windowsStatus = await windows.service.status();

    // Assert
    expect(linuxStatus).toMatchObject({ microphone: 'granted', accessibility: true, screen: 'granted', helper: 'unsupported' });
    expect(windowsStatus).toMatchObject({ microphone: 'granted', screen: 'granted', helper: 'unsupported' });
    expect(windows.deps.openExternal).not.toHaveBeenCalled();
  });

  it('maps unknown media states to "unknown"', () => {
    expect(toMediaPermission('granted')).toBe('granted');
    expect(toMediaPermission('weird')).toBe('unknown');
  });
});
