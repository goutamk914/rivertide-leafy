import { describe, expect, it } from 'vitest';
import {
  formatPercent, formatRate, formatSeconds, msFromSeconds, retentionOptions, roundTo, saveStatus, sttModelFor,
  testResultText, validateHttpUrl, validateLanguage, validateModel, validateName, validatePath, voiceOptions, withBaseUrl,
} from '../../../../src/renderer/dashboard/pages/settings/model/settings-model';
import { resolveSection, sectionHref, visibleSections } from '../../../../src/renderer/dashboard/pages/settings/model/sections';

describe('sections', () => {
  it('falls back to General for a missing or unknown section', () => {
    // Arrange + Act + Assert
    expect(resolveSection(null)).toBe('general');
    expect(resolveSection('nope')).toBe('general');
    expect(resolveSection('ai')).toBe('ai');
  });

  it('shows every section normally and only the essentials in calm mode', () => {
    // Arrange + Act
    const all = visibleSections(false, 'general').map((s) => s.id);
    const calm = visibleSections(true, 'general').map((s) => s.id);

    // Assert
    expect(all).toHaveLength(8);
    expect(calm).toEqual(['general', 'voice', 'privacy']);
  });

  it('keeps the open section in the calm list so the reader knows where they are', () => {
    // Arrange + Act
    const calm = visibleSections(true, 'about').map((s) => s.id);

    // Assert
    expect(calm).toEqual(['general', 'voice', 'privacy', 'about']);
  });

  it('links to the hash route', () => {
    // Arrange + Act + Assert
    expect(sectionHref('voice')).toBe('#/settings/voice');
  });
});

describe('validation', () => {
  it('limits the name to 80 characters', () => {
    // Arrange + Act + Assert
    expect(validateName('Sam')).toBeNull();
    expect(validateName('x'.repeat(81))).toMatch(/80 characters/);
  });

  it('accepts only http and https addresses', () => {
    // Arrange + Act + Assert
    expect(validateHttpUrl('http://localhost:11434/v1')).toBeNull();
    expect(validateHttpUrl('https://example.com/v1')).toBeNull();
    expect(validateHttpUrl('')).toBeNull();
    expect(validateHttpUrl('', { required: true })).toMatch(/Add the server address/);
    expect(validateHttpUrl('ftp://example.com')).toMatch(/http:\/\/ or https:\/\//);
    expect(validateHttpUrl('not a url')).toMatch(/http:\/\/ or https:\/\//);
    expect(validateHttpUrl(`https://example.com/${'a'.repeat(300)}`)).toMatch(/300 characters/);
  });

  it('accepts auto or a two-letter language code', () => {
    // Arrange + Act + Assert
    expect(validateLanguage('auto')).toBeNull();
    expect(validateLanguage('en')).toBeNull();
    expect(validateLanguage('english')).toMatch(/two-letter/);
    expect(validateLanguage('e')).toMatch(/two-letter/);
  });

  it('requires a model name of 120 characters or fewer', () => {
    // Arrange + Act + Assert
    expect(validateModel('gpt-5-mini')).toBeNull();
    expect(validateModel('')).toMatch(/Add a model name/);
    expect(validateModel('m'.repeat(121))).toMatch(/120 characters/);
  });

  it('limits file paths to 500 characters', () => {
    // Arrange + Act + Assert
    expect(validatePath('/opt/homebrew/bin/whisper-cli')).toBeNull();
    expect(validatePath('/'.repeat(501))).toMatch(/500 characters/);
  });
});

describe('withBaseUrl', () => {
  it('returns a new record with the address set', () => {
    // Arrange
    const record = { custom: 'https://a.example/v1' };

    // Act
    const next = withBaseUrl(record, 'ollama', 'http://localhost:11434/v1');

    // Assert
    expect(next).toEqual({ custom: 'https://a.example/v1', ollama: 'http://localhost:11434/v1' });
    expect(record).toEqual({ custom: 'https://a.example/v1' });
  });

  it('removes the address when it is cleared', () => {
    // Arrange + Act
    const next = withBaseUrl({ custom: 'https://a.example/v1', ollama: 'http://x' }, 'custom', '  ');

    // Assert
    expect(next).toEqual({ ollama: 'http://x' });
  });
});

describe('formatting', () => {
  it('formats text size, seconds and speech rate', () => {
    // Arrange + Act + Assert
    expect(formatPercent(1.15)).toBe('115%');
    expect(formatSeconds(2200)).toBe('2.2 s');
    expect(formatRate(0.95)).toBe('0.95×');
  });

  it('rounds slider values and converts seconds to whole milliseconds', () => {
    // Arrange + Act + Assert
    expect(roundTo(1.1500000000000001, 2)).toBe(1.15);
    expect(msFromSeconds(2.2)).toBe(2200);
  });

  it('describes provider test results', () => {
    // Arrange + Act + Assert
    expect(testResultText({ ok: true, latencyMs: 412, message: 'Connected to Groq.' })).toBe('Connected · 412 ms');
    expect(testResultText({ ok: true, latencyMs: null, message: 'Connected.' })).toBe('Connected');
    expect(testResultText({ ok: false, latencyMs: null, message: 'Add a Groq key first.' })).toBe('Add a Groq key first.');
  });
});

describe('retentionOptions', () => {
  it('offers forever, 30, 90 and 365 days', () => {
    // Arrange + Act
    const options = retentionOptions(0);

    // Assert
    expect(options.map((o) => o.value)).toEqual(['0', '30', '90', '365']);
  });

  it('keeps an unusual saved value visible', () => {
    // Arrange + Act
    const options = retentionOptions(14);

    // Assert
    expect(options.at(-1)).toEqual({ value: '14', label: '14 days' });
  });
});

describe('saveStatus', () => {
  it('describes each save state', () => {
    // Arrange + Act + Assert
    expect(saveStatus('idle', null)).toEqual({ tone: 'idle', text: 'Changes save automatically' });
    expect(saveStatus('saving', null)).toEqual({ tone: 'saving', text: 'Saving…' });
    expect(saveStatus('saved', null)).toEqual({ tone: 'saved', text: 'Saved' });
    expect(saveStatus('error', 'Your change wasn’t saved. Disk full.')).toEqual({ tone: 'error', text: 'Your change wasn’t saved. Disk full.' });
    expect(saveStatus('error', null).text).toMatch(/wasn’t saved/);
  });
});

describe('voiceOptions', () => {
  it('starts with the system default, then unique voices sorted by name', () => {
    // Arrange
    const voices = [
      { name: 'Samantha', lang: 'en-US' },
      { name: 'Daniel', lang: 'en-GB' },
      { name: 'Samantha', lang: 'en-US' },
    ];

    // Act
    const options = voiceOptions(voices, null);

    // Assert
    expect(options).toEqual([
      { value: '', label: 'System default' },
      { value: 'Daniel', label: 'Daniel (en-GB)' },
      { value: 'Samantha', label: 'Samantha (en-US)' },
    ]);
  });

  it('keeps a saved voice that this window cannot see', () => {
    // Arrange + Act
    const options = voiceOptions([], 'Moira');

    // Assert
    expect(options.at(-1)).toEqual({ value: 'Moira', label: 'Moira (not found on this computer)' });
  });
});

describe('sttModelFor', () => {
  it('picks the first suggested model or keeps the current one', () => {
    // Arrange + Act + Assert
    expect(sttModelFor('openai', 'whisper-large-v3-turbo')).toBe('gpt-4o-mini-transcribe');
    expect(sttModelFor('local', 'whisper-1')).toBe('local');
    expect(sttModelFor('custom', 'whisper-1')).toBe('whisper-1');
  });
});
