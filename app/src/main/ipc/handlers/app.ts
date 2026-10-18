import type { AppContext } from '../../services';
import type { Handle } from '../types';

export function registerAppHandlers(ctx: AppContext, handle: Handle): void {
  handle('app:info', () => ({
    version: ctx.version,
    platform: ctx.platform,
    arch: process.arch,
    electron: process.versions.electron ?? 'unknown',
    userDataPath: ctx.paths.userData,
    isDev: ctx.isDev,
  }));
}
