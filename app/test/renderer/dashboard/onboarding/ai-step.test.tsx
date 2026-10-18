// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, LLM_ROLES } from '@shared/settings';
import { OnboardingPage } from '../../../../src/renderer/dashboard/pages/onboarding/OnboardingPage';
import { parseRoute } from '../../../../src/renderer/lib/router';
import type { MockBridge } from '../../../../src/renderer/lib/mock-bridge';
import { renderUi, setupBridge } from '../helpers';

async function renderAiStep() {
  renderUi(<OnboardingPage route={parseRoute('/onboarding/ai')} />);
  await screen.findByRole('heading', { level: 1, name: 'Choose your AI' });
}

const region = (name: string) => screen.getByRole('region', { name });

describe('OnboardingPage AI step', () => {
  let bridge: MockBridge;

  beforeEach(() => {
    bridge = setupBridge();
    window.location.hash = '#/onboarding/ai';
  });

  afterEach(() => {
    cleanup();
    bridge.dispose();
  });

  it('saves a key, clears the field and shows it as saved without echoing it', async () => {
    // Arrange
    bridge.setState((s) => ({ ...s, secrets: { ...s.secrets, anthropic: { set: false } } }));
    await renderAiStep();
    const claude = region('Claude (Anthropic)');
    await within(claude).findByText('No key yet');
    const input = within(claude).getByLabelText('Claude key') as HTMLInputElement;

    // Act
    fireEvent.change(input, { target: { value: 'sk-test-not-real' } });
    fireEvent.click(within(claude).getByRole('button', { name: 'Save key' }));

    // Assert
    await within(claude).findByText('Saved');
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    expect(bridge.getState().secrets.anthropic.set).toBe(true);
    expect(screen.queryByText(/sk-test-not-real/)).toBeNull();
  });

  it('shows the round trip when a provider test connects', async () => {
    // Arrange
    await renderAiStep();
    const groq = region('Groq');

    // Act
    fireEvent.click(within(groq).getByRole('button', { name: 'Test' }));

    // Assert
    expect(await within(groq).findByText(/^Connected · \d+ ms$/)).toBeTruthy();
  });

  it('shows the plain error when a provider test fails', async () => {
    // Arrange
    await renderAiStep();
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    const ollama = region('Ollama (on this computer)');

    // Act
    fireEvent.click(within(ollama).getByRole('button', { name: 'Test' }));

    // Assert
    expect(await within(ollama).findByText(/Couldn’t reach Ollama on this computer/)).toBeTruthy();
  });

  it('opens the provider’s key page in the browser', async () => {
    // Arrange
    const invoke = vi.spyOn(bridge, 'invoke');
    await renderAiStep();

    // Act
    fireEvent.click(within(region('Claude (Anthropic)')).getByRole('button', { name: 'Get a key' }));

    // Assert
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('system:openExternal', { url: 'https://console.anthropic.com/settings/keys' }));
  });

  it('moves the choice with arrow keys like a radio group', async () => {
    // Arrange
    await renderAiStep();
    const claude = screen.getByRole('radio', { name: 'Claude' });

    // Act
    fireEvent.keyDown(claude, { key: 'ArrowDown' });

    // Assert
    const fast = screen.getByRole('radio', { name: 'Fast & free tier' });
    expect(fast.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(fast);
    expect(claude.getAttribute('tabindex')).toBe('-1');
  });

  it('writes the private setup with Groq speech on continue', async () => {
    // Arrange
    await renderAiStep();
    fireEvent.click(screen.getByRole('radio', { name: 'Private' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Groq (faster)' }));

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Assert
    await screen.findByRole('heading', { level: 1, name: 'Try your first dictation' });
    const settings = bridge.getState().settings;
    for (const role of LLM_ROLES) expect(settings.llm.roles[role]).toEqual({ providerId: 'ollama', model: DEFAULT_MODEL.ollama });
    expect(settings.stt).toMatchObject({ providerId: 'groq', model: 'whisper-large-v3-turbo' });
  });
});
