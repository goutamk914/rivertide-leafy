// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/dashboard/App';
import { useSettingsStore } from '../../../src/renderer/dashboard/state/settings-store';
import type { MockBridge } from '../../../src/renderer/lib/mock-bridge';
import { renderUi, setupBridge } from './helpers';

describe('dashboard App shell', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
    useSettingsStore.setState({ settings: null });
    window.location.hash = '#/';
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
    delete document.documentElement.dataset.theme;
  });

  it('loads settings, then shows the sidebar and the home page', async () => {
    // Arrange + Act
    renderUi(<App />);

    // Assert
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Today/ }).getAttribute('aria-current')).toBe('page');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows the navigate event from main', async () => {
    // Arrange
    renderUi(<App />);
    await screen.findByRole('navigation', { name: 'Main' });

    // Act
    act(() => bridge.emit('navigate', { route: '/history' }));

    // Assert
    await waitFor(() => expect(screen.getByRole('link', { name: /History/ }).getAttribute('aria-current')).toBe('page'));
  });

  it('sends people who have not finished setup to onboarding', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, settings: { ...s.settings, onboarded: false } }));

    // Act
    renderUi(<App />);

    // Assert
    await waitFor(() => expect(window.location.hash).toBe('#/onboarding'));
  });

  it('trims the sidebar to the essentials in calm mode', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, settings: { ...s.settings, appearance: { ...s.settings.appearance, calmMode: 'on' } } }));

    // Act
    renderUi(<App />);

    // Assert
    await screen.findByText(/Calm mode is on/);
    expect(screen.queryByRole('link', { name: /Knowledge/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('shows toasts pushed by main', async () => {
    // Arrange
    renderUi(<App />);
    await screen.findByRole('navigation', { name: 'Main' });

    // Act
    act(() => bridge.emit('toast', { kind: 'success', message: 'Reminder set for 8:00 PM.' }));

    // Assert
    expect(await screen.findByText('Reminder set for 8:00 PM.')).toBeTruthy();
  });
});
