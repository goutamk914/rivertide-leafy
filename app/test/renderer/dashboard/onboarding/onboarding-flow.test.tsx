// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLM_ROLES } from '@shared/settings';
import { OnboardingPage } from '../../../../src/renderer/dashboard/pages/onboarding/OnboardingPage';
import { useSettingsStore } from '../../../../src/renderer/dashboard/state/settings-store';
import { parseRoute } from '../../../../src/renderer/lib/router';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { renderUi, setupBridge } from '../helpers';

function renderOnboarding(path = '/onboarding') {
  return renderUi(<OnboardingPage route={parseRoute(path)} />);
}

const title = (name: string | RegExp) => screen.findByRole('heading', { level: 1, name });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('OnboardingPage flow', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
    bridge.setState((s) => ({ ...s, settings: { ...s.settings, onboarded: false } }));
    useSettingsStore.setState({ settings: bridge.getState().settings });
    window.location.hash = '#/onboarding';
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
    vi.useRealTimers();
  });

  it('walks through all six steps and finishes setup', async () => {
    // Arrange
    renderOnboarding();
    await title(/You speak naturally/);
    expect(screen.getByRole('progressbar', { name: 'Setup progress' }).getAttribute('aria-valuenow')).toBe('1');

    // Act: welcome → permissions
    fireEvent.change(screen.getByLabelText(/What should Rivertide call you/), { target: { value: '  Ana ' } });
    click('Get started');
    const permissionsTitle = await title('Let Rivertide hear and type');

    // Assert
    expect(bridge.getState().settings.profile.name).toBe('Ana');
    expect(document.activeElement).toBe(permissionsTitle);
    expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    expect(window.location.hash).toBe('#/onboarding/permissions');
    expect((await screen.findAllByText('Granted')).length).toBe(2);

    // Act: permissions → AI (fast & free) → try → leafy
    click('Continue');
    await title('Choose your AI');
    fireEvent.click(screen.getByRole('radio', { name: 'Fast & free tier' }));
    click('Continue');
    await title('Try your first dictation');
    click('Skip for now');
    await title('Meet Leafy, your helper');
    fireEvent.click(screen.getByRole('switch', { name: /Clap twice to call Leafy/ }));
    await waitFor(() => expect(bridge.getState().settings.clap.enabled).toBe(true));
    click('Continue');
    await title('You’re all set');

    // Act: finish
    click('Open Rivertide');

    // Assert
    await waitFor(() => expect(window.location.hash).toBe('#/'));
    await waitFor(() => expect(document.activeElement?.id).toBe('page-title')); // focus lands on the next page's title
    const settings = bridge.getState().settings;
    expect(settings.onboarded).toBe(true);
    for (const role of LLM_ROLES) expect(settings.llm.roles[role].providerId).toBe('groq');
    expect(settings.stt.providerId).toBe('groq');
    // "Open Rivertide" focuses the next page's title in a frame; let it run before the next test renders.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  });

  it('does not steal focus on first load', async () => {
    // Arrange + Act
    renderOnboarding();
    const heading = await title(/You speak naturally/);

    // Assert
    expect(document.activeElement).not.toBe(heading);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('goes back to the previous step', async () => {
    // Arrange
    renderOnboarding('/onboarding/permissions');
    await title('Let Rivertide hear and type');

    // Act
    click('Back');

    // Assert
    const heading = await title(/You speak naturally/);
    expect(document.activeElement).toBe(heading);
    expect(window.location.hash).toBe('#/onboarding');
  });

  it('polls permissions every two seconds only while the permissions step is shown', async () => {
    // Arrange
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const invoke = vi.spyOn(bridge, 'invoke');
    const statusReads = () => invoke.mock.calls.filter(([channel]) => channel === 'permissions:status').length;
    renderOnboarding('/onboarding/permissions');
    await title('Let Rivertide hear and type');
    await waitFor(() => expect(statusReads()).toBe(1));

    // Act
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    // Assert
    expect(statusReads()).toBe(3);

    // Act: leave the step
    click('Continue');
    await title('Choose your AI');
    const afterLeaving = statusReads();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    // Assert
    expect(statusReads()).toBe(afterLeaving);
  });

  it('says so when finishing fails and stays on the last step', async () => {
    // Arrange
    const original = bridge.invoke;
    vi.spyOn(bridge, 'invoke').mockImplementation(((channel: string, request: unknown) => (
      channel === 'settings:update' ? Promise.reject(new Error('The disk is full.')) : original(channel as never, request as never)
    )) as typeof bridge.invoke);
    renderOnboarding('/onboarding/done');
    await title('You’re all set');

    // Act
    click('Open Rivertide');

    // Assert
    expect(await screen.findByText('Rivertide couldn’t finish setup. Try again in a moment.')).toBeTruthy();
    expect(window.location.hash).toBe('#/onboarding');
    expect(bridge.getState().settings.onboarded).toBe(false);
  });
});
