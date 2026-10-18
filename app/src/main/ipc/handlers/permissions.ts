import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

export function registerPermissionsHandlers(ctx: AppContext, handle: Handle): void {
  handle('permissions:status', () => ctx.permissions.status());
  handle('permissions:request', ({ kind }) => ctx.permissions.request(kind));
  handle('permissions:openSettings', async ({ kind }) => {
    await ctx.permissions.openSettings(kind);
    return OK;
  });
}
