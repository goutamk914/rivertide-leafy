import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, LLM_ROLES, applySettingsPatch, type Settings } from '@shared/settings';
import {
  GROQ_STT_MODEL, choiceFromSettings, formatTestResult, presetPatch, providersFor, secretIdFor,
} from '../../../../src/renderer/dashboard/pages/onboarding/ai-presets';

function withRoles(providerId: 'anthropic' | 'groq' | 'ollama', stt: Settings['stt']['providerId'] = 'groq'): Settings {
  return applySettingsPatch(DEFAULT_SETTINGS, {
    llm: {
      roles: Object.fromEntries(LLM_ROLES.map((role) => [role, { providerId, model: DEFAULT_MODEL[providerId] }])) as Settings['llm']['roles'],
    },
    stt: { providerId: stt, model: stt === 'local' ? 'local' : GROQ_STT_MODEL },
  });
}

describe('presetPatch', () => {
  it('points every role at Claude and speech at Groq for the Claude preset', () => {
    // Arrange + Act
    const patch = presetPatch({ preset: 'claude', speech: 'local' });

    // Assert
    for (const role of LLM_ROLES) {
      expect(patch.llm?.roles?.[role]).toEqual({ providerId: 'anthropic', model: DEFAULT_MODEL.anthropic });
    }
    expect(patch.stt).toEqual({ providerId: 'groq', model: 'whisper-large-v3-turbo' });
  });

  it('uses Groq for thinking and speech in the fast and free preset', () => {
    // Arrange + Act
    const patch = presetPatch({ preset: 'fast', speech: 'local' });

    // Assert
    for (const role of LLM_ROLES) {
      expect(patch.llm?.roles?.[role]).toEqual({ providerId: 'groq', model: DEFAULT_MODEL.groq });
    }
    expect(patch.stt).toEqual({ providerId: 'groq', model: GROQ_STT_MODEL });
  });

  it('keeps thinking on this computer and lets speech be local or Groq in the private preset', () => {
    // Arrange + Act
    const local = presetPatch({ preset: 'private', speech: 'local' });
    const groq = presetPatch({ preset: 'private', speech: 'groq' });

    // Assert
    for (const role of LLM_ROLES) {
      expect(local.llm?.roles?.[role]).toEqual({ providerId: 'ollama', model: DEFAULT_MODEL.ollama });
    }
    expect(local.stt).toEqual({ providerId: 'local', model: 'local' });
    expect(groq.stt).toEqual({ providerId: 'groq', model: GROQ_STT_MODEL });
  });

  it('produces patches the settings schema accepts', () => {
    // Arrange
    const choices = [
      { preset: 'claude', speech: 'local' },
      { preset: 'fast', speech: 'groq' },
      { preset: 'private', speech: 'local' },
    ] as const;

    // Act + Assert
    for (const choice of choices) expect(() => applySettingsPatch(DEFAULT_SETTINGS, presetPatch(choice))).not.toThrow();
  });
});

describe('choiceFromSettings', () => {
  it('recognises the default settings as the Claude preset', () => {
    // Arrange + Act + Assert
    expect(choiceFromSettings(DEFAULT_SETTINGS).preset).toBe('claude');
  });

  it('recognises Groq-only and Ollama-only setups', () => {
    // Arrange + Act + Assert
    expect(choiceFromSettings(withRoles('groq')).preset).toBe('fast');
    expect(choiceFromSettings(withRoles('ollama', 'local'))).toEqual({ preset: 'private', speech: 'local' });
    expect(choiceFromSettings(withRoles('ollama', 'groq'))).toEqual({ preset: 'private', speech: 'groq' });
  });

  it('falls back to Claude when roles use a mix of providers', () => {
    // Arrange
    const mixed = applySettingsPatch(DEFAULT_SETTINGS, { llm: { roles: { polish: { providerId: 'groq', model: 'x' } } } });

    // Act + Assert
    expect(choiceFromSettings(mixed)).toEqual({ preset: 'claude', speech: 'local' });
  });
});

describe('providersFor', () => {
  it('needs a Claude key and a Groq key for the Claude preset', () => {
    // Arrange + Act
    const needs = providersFor({ preset: 'claude', speech: 'local' });

    // Assert
    expect(needs.map((n) => [n.providerId, n.testKind])).toEqual([['anthropic', 'llm'], ['groq', 'stt']]);
    expect(needs.map(secretIdFor)).toEqual(['anthropic', 'groq']);
  });

  it('needs one Groq key for the fast and free preset', () => {
    // Arrange + Act
    const needs = providersFor({ preset: 'fast', speech: 'local' });

    // Assert
    expect(needs.map((n) => n.providerId)).toEqual(['groq']);
    expect(needs[0]?.testKind).toBe('llm');
  });

  it('needs no keys for a fully private setup and a Groq key when speech uses Groq', () => {
    // Arrange + Act
    const local = providersFor({ preset: 'private', speech: 'local' });
    const groq = providersFor({ preset: 'private', speech: 'groq' });

    // Assert
    expect(local.map((n) => n.providerId)).toEqual(['ollama', 'local']);
    expect(local.map(secretIdFor)).toEqual([null, null]);
    expect(groq.map(secretIdFor)).toEqual([null, 'groq']);
  });
});

describe('formatTestResult', () => {
  it('shows the round trip when the provider answered', () => {
    // Arrange + Act + Assert
    expect(formatTestResult({ ok: true, latencyMs: 412, message: 'Connected to Groq.' })).toBe('Connected · 412 ms');
    expect(formatTestResult({ ok: true, latencyMs: null, message: 'Connected.' })).toBe('Connected');
  });

  it('passes the plain error through when the test failed', () => {
    // Arrange + Act + Assert
    expect(formatTestResult({ ok: false, latencyMs: null, message: 'Add a Groq key first.' })).toBe('Add a Groq key first.');
  });
});
