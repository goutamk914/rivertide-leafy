/** `documents:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

export const registerDocumentsHandlers: RegisterHandlers = (ctx, handle) => {
  handle('documents:list', () => ctx.documents.list());
  // The native file picker belongs to the dashboard window only.
  handle('documents:pick', () => ctx.documents.pick(), { allow: ['dashboard'] });
  handle('documents:importText', ({ name, text }) => ctx.documents.importText(name, text));
  handle('documents:get', ({ id }) => ctx.documents.get(id));
  handle('documents:delete', ({ id }) => {
    ctx.documents.delete(id);
    return { ok: true } as const;
  });
};
