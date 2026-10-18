import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createSettingsService, SETTINGS_STORE } from '../../../src/main/settings-service';
import { DEFAULT_SETTINGS, migrateSettings, type Settings } from '../../../src/shared/settings';
import { fakeContext, memoryStore } from './fakes';

function setup(initial: Settings = DEFAULT_SETTINGS) {
  const store = memoryStore(initial);
  const openStore = vi.fn(() => store);
  const ctx = fakeContext({ openStore: openStore as never });
  const changed = vi.fn();
  ctx.bus.on('settings:changed', changed);
  return { ctx, store, openStore, changed, service: createSettingsService(ctx) };
}

describe('settings service', () => {
  it('opens the settings store lazily with migrateSettings as the validator', () => {
    // Arrange
    const { openStore, service } = setup();

    // Act
    const before = openStore.mock.calls.length;
    const settings = service.get();

    // Assert
    expect(before).toBe(0);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(openStore).toHaveBeenCalledWith(SETTINGS_STORE, { defaults: DEFAULT_SETTINGS, validate: migrateSettings });
  });

  it('update merges, persists and emits settings:changed', () => {
    // Arrange
    const { store, changed, service } = setup();

    // Act
    const next = service.update({ leafy: { size: 'large' } });

    // Assert
    expect(next.leafy).toEqual({ ...DEFAULT_SETTINGS.leafy, size: 'large' });
    expect(store.writes).toEqual([next]);
    expect(changed).toHaveBeenCalledWith(next);
    expect(service.get()).toBe(next);
  });

  it('rejects an invalid patch and leaves settings untouched', () => {
    // Arrange
    const { store, changed, service } = setup();

    // Act
    const attempt = () => service.update({ voice: { endSilenceMs: 99_999 } });

    // Assert
    expect(attempt).toThrow(ZodError);
    expect(store.writes).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(service.get()).toEqual(DEFAULT_SETTINGS);
  });
});
