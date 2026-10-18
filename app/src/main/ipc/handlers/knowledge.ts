/** `knowledge:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

export const registerKnowledgeHandlers: RegisterHandlers = (ctx, handle) => {
  handle('knowledge:list', (request) => ctx.knowledge.list(request));
  handle('knowledge:upsert', ({ fact }) => ctx.knowledge.upsert(fact, 'manual'));
  handle('knowledge:delete', ({ id }) => {
    ctx.knowledge.delete(id);
    return { ok: true } as const;
  });
  handle('knowledge:graph', () => ctx.knowledge.graph());
};
