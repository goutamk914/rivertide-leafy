/**
 * Settings (`ctx.settings`): `settings.json`, validated and migrated by `migrateSettings`.
 * `update(patch)` merges via `applySettingsPatch` (throws ZodError on invalid input, leaving the
 * current settings untouched), persists, then emits `settings:changed`.
 */
import { applySettingsPatch, DEFAULT_SETTINGS, migrateSettings, type Settings, type SettingsPatch } from '../shared/settings';
import type { AppContext, JsonStore, SettingsService } from './services';

export const SETTINGS_STORE = 'settings';

export function createSettingsService(ctx: AppContext): SettingsService {
  // Opened lazily: factories may only store ctx while the context is being assembled.
  let store: JsonStore<Settings> | null = null;
  const settingsStore = (): JsonStore<Settings> => {
    store ??= ctx.openStore<Settings>(SETTINGS_STORE, { defaults: DEFAULT_SETTINGS, validate: migrateSettings });
    return store;
  };

  return {
    get: () => settingsStore().read(),
    update(patch: SettingsPatch): Settings {
      const next = applySettingsPatch(settingsStore().read(), patch);
      settingsStore().write(next);
      ctx.bus.emit('settings:changed', next);
      return next;
    },
  };
}
