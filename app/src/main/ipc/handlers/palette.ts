/**
 * `palette:*` channels. Requests arrive already validated by ipc/register.ts. Execution is by id
 * only: actions are looked up in the palette service's own cache, never taken from the renderer.
 */
import type { RegisterHandlers } from '../types';

const DEFAULT_LIMIT = 12;

export const registerPaletteHandlers: RegisterHandlers = (ctx, handle) => {
  handle('palette:search', ({ query, limit }) => ctx.palette.search(query, limit ?? DEFAULT_LIMIT));
  handle('palette:execute', ({ id, alt }) => ctx.palette.execute(id, alt ?? false));
  handle('palette:hide', () => {
    ctx.windows.palette.hide();
    return { ok: true } as const;
  });
  handle('palette:resize', ({ height }) => {
    ctx.windows.palette.resize(height);
    return { ok: true } as const;
  }, { allow: ['palette'] });
};
