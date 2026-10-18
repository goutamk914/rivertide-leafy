/** `dictionary:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

export const registerDictionaryHandlers: RegisterHandlers = (ctx, handle) => {
  handle('dictionary:list', () => ctx.dictionary.list());
  handle('dictionary:upsert', ({ entry }) => ctx.dictionary.upsert(entry, 'manual'));
  handle('dictionary:delete', ({ id }) => {
    ctx.dictionary.delete(id);
    return { ok: true } as const;
  });
};
