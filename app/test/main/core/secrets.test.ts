import { describe, expect, it, vi } from 'vitest';
import {
  createSecretsService, ENCRYPTION_UNAVAILABLE_MESSAGE, parseSecretsFile, SECRET_IDS, type SafeStorageLike,
} from '../../../src/main/secrets';
import { fakeContext, memoryLogger, memoryStore } from './fakes';

vi.mock('electron', () => ({ safeStorage: {} }));

/** Reversible fake "encryption" so tests can prove plain text never reaches the store. */
function fakeSafeStorage(available = true, backend = 'keychain'): SafeStorageLike {
  return {
    isEncryptionAvailable: vi.fn(() => available),
    encryptString: vi.fn((plain: string) => Buffer.from(`enc:${[...plain].reverse().join('')}`)),
    decryptString: vi.fn((buffer: Buffer) => {
      const text = buffer.toString();
      if (!text.startsWith('enc:')) throw new Error('bad ciphertext');
      return [...text.slice(4)].reverse().join('');
    }),
    getSelectedStorageBackend: vi.fn(() => backend),
  };
}

function setup(options: { available?: boolean; platform?: 'darwin' | 'linux'; backend?: string; initial?: Record<string, string> } = {}) {
  const store = memoryStore<Record<string, string>>(options.initial ?? {});
  const logger = memoryLogger();
  const ctx = fakeContext({ openStore: (() => store) as never, logger, platform: options.platform ?? 'darwin' });
  const safe = fakeSafeStorage(options.available ?? true, options.backend);
  return { store, logger, safe, service: createSecretsService(ctx, safe) };
}

describe('secrets service', () => {
  it('stores keys encrypted as base64 and decrypts them back', () => {
    // Arrange
    const { store, service } = setup();

    // Act
    const status = service.set('anthropic', '  sk-ant-secret-value  ');

    // Assert
    const saved = store.read().anthropic ?? '';
    expect(saved).not.toContain('sk-ant');
    expect(Buffer.from(saved, 'base64').toString()).toMatch(/^enc:/);
    expect(service.get('anthropic')).toBe('sk-ant-secret-value');
    expect(status.anthropic).toEqual({ set: true });
    expect(status.groq).toEqual({ set: false });
  });

  it('refuses to store anything when OS encryption is unavailable', () => {
    // Arrange
    const { store, service } = setup({ available: false });

    // Act / Assert
    expect(() => service.set('groq', 'gsk_123')).toThrow(ENCRYPTION_UNAVAILABLE_MESSAGE);
    expect(store.writes).toEqual([]);
    expect(service.isEncryptionAvailable()).toBe(false);
  });

  it('treats the Linux plain-text backend as unavailable', () => {
    // Arrange
    const { service } = setup({ platform: 'linux', backend: 'basic_text' });

    // Act / Assert
    expect(service.isEncryptionAvailable()).toBe(false);
    expect(() => service.set('openai', 'sk-abc')).toThrow(ENCRYPTION_UNAVAILABLE_MESSAGE);
  });

  it('clear removes only that key', () => {
    // Arrange
    const { store, service } = setup();
    service.set('anthropic', 'a-key');
    service.set('groq', 'g-key');

    // Act
    const status = service.clear('anthropic');

    // Assert
    expect(Object.keys(store.read())).toEqual(['groq']);
    expect(status.anthropic.set).toBe(false);
    expect(service.get('groq')).toBe('g-key');
  });

  it('returns null (and logs without the value) when a saved key cannot be decrypted', () => {
    // Arrange
    const { service, logger } = setup({ initial: { openai: Buffer.from('garbage').toString('base64') } });

    // Act
    const value = service.get('openai');

    // Assert
    expect(value).toBeNull();
    expect(logger.entries.some((e) => e.message.includes('decrypt'))).toBe(true);
    expect(JSON.stringify(logger.entries)).not.toContain('garbage');
  });

  it('never logs key values', () => {
    // Arrange
    const { service, logger } = setup();

    // Act
    service.set('custom', 'super-secret-value-123');

    // Assert
    expect(JSON.stringify(logger.entries)).not.toContain('super-secret-value-123');
  });

  it('rejects empty keys', () => {
    const { service } = setup();
    expect(() => service.set('anthropic', '   ')).toThrow(/empty/);
  });

  it('parseSecretsFile drops unknown ids and non-string values', () => {
    expect(parseSecretsFile({ anthropic: 'abc', nope: 'x', groq: 5 })).toEqual({ anthropic: 'abc' });
    expect(() => parseSecretsFile(['not', 'an', 'object'])).toThrow();
    expect(SECRET_IDS).toContain('stt-custom');
  });
});
