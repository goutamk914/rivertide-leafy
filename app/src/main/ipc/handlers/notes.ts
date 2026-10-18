/** `notes:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

export const registerNotesHandlers: RegisterHandlers = (ctx, handle) => {
  handle('notes:list', ({ query }) => ctx.notes.list(query));
  handle('notes:upsert', ({ note }) => ctx.notes.upsert(note, 'manual'));
  handle('notes:delete', ({ id }) => {
    ctx.notes.delete(id);
    return { ok: true } as const;
  });
};
