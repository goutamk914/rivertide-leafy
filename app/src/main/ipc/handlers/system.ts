import { shell } from 'electron';
import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

export function registerSystemHandlers(_ctx: AppContext, handle: Handle): void {
  // The schema already restricts this to http(s) URLs.
  handle('system:openExternal', async ({ url }) => {
    await shell.openExternal(url);
    return OK;
  });
}
