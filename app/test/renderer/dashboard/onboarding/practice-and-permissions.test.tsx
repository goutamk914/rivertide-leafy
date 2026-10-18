// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from '../../../../src/renderer/dashboard/pages/onboarding/OnboardingPage';
import { parseRoute } from '../../../../src/renderer/lib/router';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { IDLE_SNAPSHOT } from '../../../../src/renderer/lib/mock/handlers-live';
import { renderUi, setupBridge } from '../helpers';

async function renderStep(section: string, heading: string) {
  renderUi(<OnboardingPage route={parseRoute(`/onboarding/${section}`)} />);
  await screen.findByRole('heading', { level: 1, name: heading });
}

describe('OnboardingPage practice and permissions steps', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
    window.location.hash = '#/onboarding';
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  it('asks for the microphone and shows the new status in words', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, permissions: { ...s.permissions, microphone: 'not-determined' } }));
    await renderStep('permissions', 'Let Rivertide hear and type');
    const microphone = screen.getByRole('heading', { level: 2, name: 'Microphone' }).closest('li') as HTMLElement;
    await within(microphone).findByText('Not yet');
    expect(screen.getByText('You can do this later in Settings.')).toBeTruthy();

    // Act
    fireEvent.click(within(microphone).getByRole('button', { name: 'Allow' }));

    // Assert
    expect(await within(microphone).findByText('Granted')).toBeTruthy();
    expect(within(microphone).queryByRole('button', { name: 'Allow' })).toBeNull();
  });

  it('offers only System Settings when the microphone is blocked', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');
    bridge.setState((s) => ({ ...s, permissions: { ...s.permissions, microphone: 'denied' } }));
    await renderStep('permissions', 'Let Rivertide hear and type');
    const microphone = screen.getByRole('heading', { level: 2, name: 'Microphone' }).closest('li') as HTMLElement;
    await within(microphone).findByText('Blocked');

    // Act
    fireEvent.click(within(microphone).getByRole('button', { name: 'Open System Settings' }));

    // Assert
    expect(within(microphone).queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(await within(microphone).findByText(/Turn on Rivertide in System Settings/)).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('permissions:openSettings', { kind: 'microphone' });
  });

  it('practises without fn: focuses the box, starts dictation and fills in the result', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');
    await renderStep('try', 'Try your first dictation');
    const box = screen.getByLabelText('Practice here') as HTMLTextAreaElement;
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy();

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Practice without fn' }));

    // Assert
    expect(document.activeElement).toBe(box);
    expect(await screen.findByText('Listening')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('voice:start', { mode: 'dictate', source: 'dashboard' });
    expect(screen.getByRole('button', { name: 'I’m done talking' })).toBeTruthy();

    // Act: the session finishes (the browser mock pastes nothing)
    act(() => bridge.emit('voice:snapshot', { ...IDLE_SNAPSHOT, phase: 'done', mode: 'dictate', source: 'dashboard', output: 'Pick up milk on the way home.' }));

    // Assert
    expect(box.value).toBe('Pick up milk on the way home.');
    expect(screen.getByText(/That worked/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('keeps what the person typed instead of overwriting it', async () => {
    // Arrange
    await renderStep('try', 'Try your first dictation');
    const box = screen.getByLabelText('Practice here') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'My own words' } });

    // Act
    act(() => bridge.emit('voice:snapshot', { ...IDLE_SNAPSHOT, phase: 'done', mode: 'dictate', source: 'fn', output: 'Something else.' }));

    // Assert
    expect(box.value).toBe('My own words');
  });

  it('cancels a practice session that is still listening when the person moves on', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');
    await renderStep('try', 'Try your first dictation');
    fireEvent.click(screen.getByRole('button', { name: 'Practice without fn' }));
    await screen.findByText('Listening');

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }));
    await screen.findByRole('heading', { level: 1, name: 'Meet Leafy, your helper' });

    // Assert
    expect(invoke).toHaveBeenCalledWith('voice:cancel', undefined);
  });
});
