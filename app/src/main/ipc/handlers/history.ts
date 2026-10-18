/** `history:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

const OK = { ok: true } as const;
const MISSING = 'That item is no longer in your history.';

export const registerHistoryHandlers: RegisterHandlers = (ctx, handle) => {
  handle('history:list', (request) => ctx.history.list(request));
  handle('history:get', ({ id }) => ctx.history.get(id));
  handle('history:delete', ({ id }) => {
    ctx.history.delete(id);
    return OK;
  });
  handle('history:clear', () => {
    ctx.history.clear();
    return OK;
  });
  handle('history:repaste', async ({ id }) => {
    const item = ctx.history.get(id);
    if (!item) throw new Error(MISSING);
    const text = item.output.trim() ? item.output : item.raw;
    if (!text.trim()) throw new Error('This item has no text to paste.');
    return { pasted: await ctx.os.paste(text, null) };
  });
};
