/** `chat:*` channels. Requests arrive already validated by ipc/register.ts. Answers stream as `chat:event`. */
import type { RegisterHandlers } from '../types';

export const registerChatHandlers: RegisterHandlers = (ctx, handle) => {
  handle('chat:list', () => ctx.chat.list());
  handle('chat:get', ({ id }) => ctx.chat.get(id));
  handle('chat:create', () => ctx.chat.create());
  handle('chat:rename', ({ id, title }) => ctx.chat.rename(id, title));
  handle('chat:delete', ({ id }) => {
    ctx.chat.delete(id);
    return { ok: true } as const;
  });
  handle('chat:send', ({ sessionId, text }) => ctx.chat.send(sessionId, text));
};
