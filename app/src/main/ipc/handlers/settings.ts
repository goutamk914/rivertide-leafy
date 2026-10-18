import type { SettingsPatch } from '../../../shared/settings';
import type { AppContext } from '../../services';
import { describeZodError, isZodError } from '../errors';
import type { Handle } from '../types';

export function registerSettingsHandlers(ctx: AppContext, handle: Handle): void {
  handle('settings:get', () => ctx.settings.get());
  handle('settings:update', ({ patch }) => {
    try {
      // The deep shape is validated by applySettingsPatch inside the settings service.
      return ctx.settings.update(patch as SettingsPatch);
    } catch (error) {
      if (isZodError(error)) throw new Error(describeZodError(error, "That setting couldn't be saved"));
      throw error;
    }
  });
}
