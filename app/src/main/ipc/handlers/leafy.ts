import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

/** Leafy's window asks main to move it, toggle click-through, save its spot and open its menu. */
export function registerLeafyHandlers(ctx: AppContext, handle: Handle): void {
  handle('leafy:pointer', ({ interactive }) => {
    ctx.windows.leafy.setInteractive(interactive);
    return OK;
  });
  handle('leafy:moveTo', ({ x, y }) => {
    ctx.windows.leafy.moveTo(x, y);
    return OK;
  });
  handle('leafy:dragEnd', () => {
    ctx.windows.leafy.persistPosition();
    return OK;
  });
  handle('leafy:menu', () => {
    ctx.windows.leafy.popupMenu();
    return OK;
  });
  handle('leafy:position', () => ctx.windows.leafy.position());
}
