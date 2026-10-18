import type { AppContext } from '../../services';
import type { Handle } from '../types';

/** voice:* — the island, Leafy, palette and dashboard start/stop/cancel voice sessions. */
export function registerVoiceHandlers(ctx: AppContext, handle: Handle): void {
  handle('voice:snapshot', () => ctx.voice.snapshot());
  handle('voice:start', ({ mode, source }) => ctx.voice.start(mode, source));
  handle('voice:stop', () => ctx.voice.stop());
  handle('voice:cancel', () => ctx.voice.cancel());
}
