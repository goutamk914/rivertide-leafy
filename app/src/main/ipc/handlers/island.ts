import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

/** The island is click-through except while the pointer is over its interactive content. */
export function registerIslandHandlers(ctx: AppContext, handle: Handle): void {
  handle('island:pointer', ({ interactive }) => {
    ctx.windows.island.setInteractive(interactive);
    return OK;
  });
}
