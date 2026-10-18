import type { AppContext } from '../../services';
import type { Handle } from '../types';

/** hotkeys:status — which global shortcuts actually registered (shown in Settings). */
export function registerHotkeysHandlers(ctx: AppContext, handle: Handle): void {
  handle('hotkeys:status', () => ctx.hotkeys.status());
}
