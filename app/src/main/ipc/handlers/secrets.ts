import type { AppContext } from '../../services';
import type { Handle } from '../types';

/** Keys go in, only `{ set: boolean }` per provider ever comes back out. */
export function registerSecretsHandlers(ctx: AppContext, handle: Handle): void {
  handle('secrets:status', () => ctx.secrets.status());
  handle('secrets:set', ({ id, value }) => ctx.secrets.set(id, value));
  handle('secrets:clear', ({ id }) => ctx.secrets.clear(id));
}
