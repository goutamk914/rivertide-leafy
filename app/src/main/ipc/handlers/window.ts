import { BrowserWindow, webContents } from 'electron';
import type { AppContext, WindowKind } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

function hideKind(ctx: AppContext, kind: WindowKind): void {
  if (kind === 'dashboard') ctx.windows.dashboard.hide();
  else if (kind === 'palette') ctx.windows.palette.hide();
  else if (kind === 'island') ctx.windows.island.hide();
  else if (kind === 'leafy') ctx.windows.leafy.hide();
}

export function registerWindowHandlers(ctx: AppContext, handle: Handle): void {
  handle('window:open', ({ target, route, mode }) => {
    if (target === 'dashboard') ctx.windows.dashboard.show(route);
    else ctx.windows.palette.show(mode ?? 'search', null);
    return OK;
  });
  // "Close" never destroys a window (they reopen instantly); it hides the caller's own window.
  handle('window:close', (_request, sender) => {
    hideKind(ctx, sender.kind);
    return OK;
  });
  handle('window:minimize', (_request, sender) => {
    const contents = webContents.fromId(sender.webContentsId);
    const win = contents ? BrowserWindow.fromWebContents(contents) : null;
    if (sender.kind === 'dashboard' && win && win.isMinimizable()) win.minimize();
    else hideKind(ctx, sender.kind);
    return OK;
  });
}
