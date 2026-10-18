/** `reminders:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

export const registerRemindersHandlers: RegisterHandlers = (ctx, handle) => {
  handle('reminders:list', () => ctx.reminders.list());
  handle('reminders:create', (request) => ctx.reminders.create(request));
  handle('reminders:cancel', ({ id }) => {
    ctx.reminders.cancel(id);
    return { ok: true } as const;
  });
};
