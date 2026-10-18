/** `insights:*` channels. Requests arrive already validated by ipc/register.ts. */
import type { RegisterHandlers } from '../types';

export const registerInsightsHandlers: RegisterHandlers = (ctx, handle) => {
  handle('insights:usage', ({ days }) => ctx.insights.usage(days));
  handle('insights:dynamics', ({ days }) => ctx.insights.dynamics(days));
};
