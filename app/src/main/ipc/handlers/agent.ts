import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

/** agent:* — typed requests from the palette, Leafy and dashboard; confirmations from the island. */
export function registerAgentHandlers(ctx: AppContext, handle: Handle): void {
  handle('agent:ask', ({ text, source }) => ctx.agent.ask(text, source));
  handle('agent:confirm', ({ runId, callId, approved }) => {
    ctx.agent.confirm(runId, callId, approved);
    return OK;
  });
  handle('agent:cancel', ({ runId }) => {
    ctx.agent.cancel(runId);
    return OK;
  });
}
