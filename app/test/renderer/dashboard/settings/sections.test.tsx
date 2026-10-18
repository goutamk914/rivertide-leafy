// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPage } from '../../../../src/renderer/dashboard/pages/settings/SettingsPage';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { parseRoute } from '../../../../src/renderer/lib/router';
import { renderUi, setupBridge } from '../helpers';

function renderSettings(path: string) {
  return renderUi(<SettingsPage route={parseRoute(path)} />);
}

function captureField(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name });
}

describe('Settings sections', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  describe('Shortcuts', () => {
    it('captures a new shortcut from the keyboard and shows it is ready', async () => {
      // Arrange
      renderSettings('/settings/shortcuts');
      const field = captureField(/Open the palette/);

      // Act
      fireEvent.focus(field);

      // Assert
      expect(screen.getByText('Press the new shortcut')).toBeTruthy();

      // Act
      fireEvent.keyDown(field, { key: 'k', code: 'KeyK', metaKey: true, shiftKey: true });

      // Assert
      await waitFor(() => expect(bridge.getState().settings.hotkeys.palette).toBe('CommandOrControl+Shift+K'));
      fireEvent.blur(field);
      const message = document.getElementById(field.getAttribute('aria-describedby') ?? '') as HTMLElement;
      await waitFor(() => expect(message.textContent).toBe('Ready'));
    });

    it('explains a conflict when another app owns the shortcut', async () => {
      // Arrange
      renderSettings('/settings/shortcuts');
      const field = captureField(/Start a Leafy command/);
      fireEvent.focus(field);

      // Act
      fireEvent.keyDown(field, { key: ' ', code: 'Space', altKey: true });
      fireEvent.blur(field);

      // Assert
      await waitFor(() => expect(bridge.getState().settings.hotkeys.command).toBe('Alt+Space'));
      expect(await screen.findByText('Another app is using this shortcut. Pick a different one.')).toBeTruthy();
      expect(screen.getByText(/ChatGPT and Codex use Option\+Space, so this shortcut may not work/)).toBeTruthy();
    });

    it('refuses a shortcut that another action already uses', async () => {
      // Arrange
      renderSettings('/settings/shortcuts');
      const field = captureField(/Start or stop dictation/);
      fireEvent.focus(field);

      // Act
      fireEvent.keyDown(field, { key: 'l', code: 'KeyL', metaKey: true, shiftKey: true });

      // Assert
      expect(await screen.findByText(/already does “Start a Leafy command”/)).toBeTruthy();
      expect(bridge.getState().settings.hotkeys.dictate).toBe('CommandOrControl+Shift+D');
    });

    it('turns a shortcut off with Delete and cancels with Escape', async () => {
      // Arrange
      renderSettings('/settings/shortcuts');
      const field = captureField(/Start or stop dictation/);
      fireEvent.focus(field);

      // Act
      fireEvent.keyDown(field, { key: 'Escape', code: 'Escape' });

      // Assert
      expect(screen.queryByText('Press the new shortcut')).toBeNull();

      // Act
      fireEvent.click(field);
      fireEvent.keyDown(field, { key: 'Backspace', code: 'Backspace' });

      // Assert
      await waitFor(() => expect(bridge.getState().settings.hotkeys.dictate).toBe(''));
    });

    it('turns the fn key off', async () => {
      // Arrange
      renderSettings('/settings/shortcuts');

      // Act
      fireEvent.click(screen.getByRole('switch', { name: /Use the fn key/ }));

      // Assert
      await waitFor(() => expect(bridge.getState().settings.hotkeys.useFn).toBe(false));
      expect(screen.queryByText('Hold fn')).toBeNull();
    });
  });

  describe('Leafy’s permissions', () => {
    it('stores an override and removes it again when the default is chosen', async () => {
      // Arrange
      renderSettings('/settings/leafy-permissions');
      const select = screen.getByRole('combobox', { name: /Quit apps/ }) as HTMLSelectElement;
      expect(select.value).toBe('ask');

      // Act
      fireEvent.change(select, { target: { value: 'never' } });

      // Assert
      await waitFor(() => expect(bridge.getState().settings.agent.toolPolicy).toEqual({ quit_app: 'never' }));

      // Act
      fireEvent.change(select, { target: { value: 'ask' } });

      // Assert
      await waitFor(() => expect(bridge.getState().settings.agent.toolPolicy).toEqual({}));
    });

    it('labels risk with words and turns internet tools off together', async () => {
      // Arrange
      renderSettings('/settings/leafy-permissions');
      const weatherRow = screen.getByRole('rowheader', { name: /Check the weather/ }).closest('tr') as HTMLElement;
      expect(within(weatherRow).getByText('Looks things up')).toBeTruthy();
      expect(within(weatherRow).getByText('Internet')).toBeTruthy();

      // Act
      fireEvent.click(screen.getByRole('switch', { name: /Allow tools that use the internet/ }));

      // Assert
      await waitFor(() => expect(bridge.getState().settings.agent.allowNetworkTools).toBe(false));
      expect((within(weatherRow).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    });
  });

  describe('Leafy', () => {
    it('shows clap options and the microphone note once clap detection is on', async () => {
      // Arrange
      renderSettings('/settings/leafy');
      expect(screen.getByText(/the microphone stays open and macOS shows its mic indicator/)).toBeTruthy();

      // Act
      fireEvent.click(screen.getByRole('switch', { name: /Listen for a double clap/ }));

      // Assert
      await waitFor(() => expect(bridge.getState().settings.clap.enabled).toBe(true));
      fireEvent.click(screen.getByRole('radio', { name: 'Open the palette' }));
      await waitFor(() => expect(bridge.getState().settings.clap.action).toBe('palette'));
    });

    it('offers “Hey Leafy” off by default, with the on-device privacy note', async () => {
      // Arrange
      renderSettings('/settings/leafy');
      const toggle = screen.getByRole('switch', { name: /Listen for “Hey Leafy”/ });
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      expect(screen.getByText(/audio never leaves it, is never saved/)).toBeTruthy();

      // Act
      fireEvent.click(toggle);

      // Assert
      await waitFor(() => expect(bridge.getState().settings.wakeWord.enabled).toBe(true));
      const sensitivity = screen.getByRole('radiogroup', { name: /How easily Leafy wakes/ });
      fireEvent.click(within(sensitivity).getByRole('radio', { name: 'High' }));
      await waitFor(() => expect(bridge.getState().settings.wakeWord.sensitivity).toBe('high'));
    });
  });

  describe('Voice', () => {
    it('saves the output choice and turns off cleanup options with cleanup', async () => {
      // Arrange
      renderSettings('/settings/voice');

      // Act
      fireEvent.click(screen.getByRole('radio', { name: 'Copy only' }));
      fireEvent.click(screen.getByRole('switch', { name: /Clean up my writing/ }));

      // Assert
      await waitFor(() => expect(bridge.getState().settings.voice.output).toBe('clipboard'));
      await waitFor(() => expect(bridge.getState().settings.voice.polish.enabled).toBe(false));
      expect((screen.getByRole('switch', { name: /Remove filler words/ }) as HTMLInputElement).disabled).toBe(true);
    });

    it('says when voices cannot be listed in this window', () => {
      // Arrange + Act
      renderSettings('/settings/voice');

      // Assert
      expect(screen.getByText('Preview isn’t available in this window.')).toBeTruthy();
      expect((screen.getByRole('button', { name: 'Preview' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('saves the end-of-speech pause in milliseconds when the slider is released', async () => {
      // Arrange
      renderSettings('/settings/voice');
      const slider = screen.getByRole('slider', { name: /Pause before Rivertide stops listening/ });

      // Act
      fireEvent.change(slider, { target: { value: '3.5' } });
      fireEvent.keyUp(slider, { key: 'ArrowRight' });

      // Assert
      await waitFor(() => expect(bridge.getState().settings.voice.endSilenceMs).toBe(3500));
    });
  });

  describe('Privacy', () => {
    it('saves history retention as a number of days', async () => {
      // Arrange
      renderSettings('/settings/privacy');

      // Act
      fireEvent.change(screen.getByRole('combobox', { name: /Keep history for/ }), { target: { value: '90' } });

      // Assert
      await waitFor(() => expect(bridge.getState().settings.privacy.retentionDays).toBe(90));
    });
  });

  describe('About', () => {
    it('shows the version once app details load', async () => {
      // Arrange + Act
      renderSettings('/settings/about');

      // Assert
      expect(await screen.findByText('2.0.0')).toBeTruthy();
      expect(screen.getByText('Rivertide is made by Code the Cure.')).toBeTruthy();
    });
  });
});
