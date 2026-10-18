// @vitest-environment jsdom
// Field errors appear twice by design: visibly under the field and in its always-present live region.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPage } from '../../../../src/renderer/dashboard/pages/settings/SettingsPage';
import { PresentationProvider } from '../../../../src/renderer/dashboard/app-context';
import { useSettingsStore } from '../../../../src/renderer/dashboard/state/settings-store';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { parseRoute } from '../../../../src/renderer/lib/router';
import { useToastStore } from '../../../../src/renderer/ui/components/toast-store';
import { renderUi, setupBridge } from '../helpers';

const SECTIONS: readonly [string, string][] = [
  ['general', 'General'],
  ['voice', 'Voice'],
  ['shortcuts', 'Shortcuts'],
  ['ai', 'AI'],
  ['leafy', 'Leafy'],
  ['leafy-permissions', 'Leafy’s permissions'],
  ['privacy', 'Privacy & data'],
  ['about', 'About'],
];

function renderSettings(path: string) {
  return renderUi(<SettingsPage route={parseRoute(path)} />);
}

describe('SettingsPage', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  it.each(SECTIONS)('renders the %s section with its sub-nav link marked current', async (id, label) => {
    // Arrange + Act
    renderSettings(`/settings/${id}`);

    // Assert
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: label })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: label }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(screen.queryByText('Checking…')).toBeNull());
  });

  it('opens General when the section is missing or unknown', () => {
    // Arrange + Act
    renderSettings('/settings/nonsense');

    // Assert
    expect(screen.getByRole('heading', { level: 2, name: 'General' })).toBeTruthy();
  });

  it('lists only General, Voice and Privacy in calm mode', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, settings: { ...s.settings, appearance: { ...s.settings.appearance, calmMode: 'on' } } }));
    const settings = bridge.getState().settings;
    useSettingsStore.setState({ settings });

    // Act
    renderUi(
      <PresentationProvider settings={settings}>
        <SettingsPage route={parseRoute('/settings/voice')} />
      </PresentationProvider>,
    );

    // Assert
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    const links = within(nav).getAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['General', 'Voice', 'Privacy & data']);
  });

  it('saves a toggle to main straight away and says Saved', async () => {
    // Arrange
    renderSettings('/settings/general');

    // Act
    fireEvent.click(screen.getByRole('switch', { name: /Open Rivertide when you log in/ }));

    // Assert
    await waitFor(() => expect(bridge.getState().settings.system.launchAtLogin).toBe(true));
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('checks the name on blur and saves only a valid value', async () => {
    // Arrange
    renderSettings('/settings/general');
    const input = screen.getByRole('textbox', { name: /Your name/ });

    // Act
    fireEvent.change(input, { target: { value: 'x'.repeat(81) } });
    fireEvent.blur(input);

    // Assert
    expect(await screen.findAllByText('Use 80 characters or fewer.')).toBeTruthy();
    expect(bridge.getState().settings.profile.name).toBe('Sam');

    // Act
    fireEvent.change(input, { target: { value: '  Alex ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Assert
    await waitFor(() => expect(bridge.getState().settings.profile.name).toBe('Alex'));
  });

  it('keeps the wipe button disabled until DELETE is typed exactly', async () => {
    // Arrange
    renderSettings('/settings/privacy');
    fireEvent.click(screen.getByRole('button', { name: /Delete all data/ }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: /Delete everything/ }) as HTMLButtonElement;
    const input = within(dialog).getByRole('textbox', { name: /Type DELETE to confirm/ });

    // Act
    fireEvent.change(input, { target: { value: 'delete' } });

    // Assert
    expect(confirm.disabled).toBe(true);

    // Act
    fireEvent.change(input, { target: { value: 'DELETE' } });
    fireEvent.click(confirm);

    // Assert
    expect(confirm.disabled).toBe(false);
    await waitFor(() => expect(bridge.getState().history).toHaveLength(0));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('exports data and tells the person where it went', async () => {
    // Arrange
    renderSettings('/settings/privacy');

    // Act
    fireEvent.click(screen.getByRole('button', { name: /Export my data/ }));

    // Assert
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.message).join(' ')).toMatch(/copied to ~\/Downloads\/Rivertide export/));
  });

  it('saves a key, then empties the field and shows it as saved', async () => {
    // Arrange
    renderSettings('/settings/ai');
    const card = screen.getByRole('region', { name: 'OpenAI' });
    await within(card).findByText('Not set');
    const input = within(card).getByLabelText('OpenAI API key') as HTMLInputElement;

    // Act
    fireEvent.change(input, { target: { value: 'sk-test-123' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save key' }));

    // Assert
    await waitFor(() => expect(bridge.getState().secrets.openai.set).toBe(true));
    await waitFor(() => expect(input.value).toBe(''));
    expect(await within(card).findByText('Saved')).toBeTruthy();
  });

  it('shows a connection test result in plain words', async () => {
    // Arrange
    renderSettings('/settings/ai');
    const card = screen.getByRole('region', { name: 'OpenAI' });

    // Act
    fireEvent.click(within(card).getByRole('button', { name: 'Test OpenAI connection' }));

    // Assert
    expect(await within(card).findByText('Add a OpenAI key first.')).toBeTruthy();
  });

  it('switching a job to another provider also picks that provider’s default model', async () => {
    // Arrange
    renderSettings('/settings/ai');
    const answers = screen.getByRole('group', { name: 'Answers' });

    // Act
    fireEvent.change(within(answers).getByRole('combobox', { name: 'Provider' }), { target: { value: 'groq' } });

    // Assert
    await waitFor(() => expect(bridge.getState().settings.llm.roles.answer).toEqual({ providerId: 'groq', model: 'openai/gpt-oss-120b' }));
  });

  it('rejects a server address that is not http(s) and saves a valid one', async () => {
    // Arrange
    renderSettings('/settings/ai');
    const input = screen.getByRole('textbox', { name: /Ollama address/ });

    // Act
    fireEvent.change(input, { target: { value: 'ftp://localhost' } });
    fireEvent.blur(input);

    // Assert
    expect(await screen.findAllByText(/starts with http:\/\/ or https:\/\//)).toBeTruthy();
    expect(bridge.getState().settings.llm.baseUrls).toEqual({});

    // Act
    fireEvent.change(input, { target: { value: 'http://127.0.0.1:11434/v1' } });
    fireEvent.blur(input);

    // Assert
    await waitFor(() => expect(bridge.getState().settings.llm.baseUrls).toEqual({ ollama: 'http://127.0.0.1:11434/v1' }));
  });
});
