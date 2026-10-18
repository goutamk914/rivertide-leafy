import type { AppContext } from '../../services';
import { OK } from '../ok';
import type { Handle } from '../types';

/**
 * Messages from the hidden audio engine. `engine:capture` returns immediately: the voice pipeline
 * (STT → LLM → paste) runs on its own and must not hold the engine's invoke open.
 */
export function registerEngineHandlers(ctx: AppContext, handle: Handle): void {
  const log = ctx.logger.child('engine');

  handle('engine:ready', () => {
    ctx.windows.engine.markReady();
    return OK;
  });
  handle('engine:capture', (payload) => {
    ctx.voice.onCapture(payload).catch((error: unknown) => {
      log.error('voice pipeline failed for a capture', { requestId: payload.requestId, error });
    });
    return OK;
  });
  handle('engine:clap', ({ at }) => {
    ctx.voice.onClap(at);
    ctx.bus.emit('clap', { at });
    return OK;
  });
  handle('engine:voices', ({ voices }) => {
    log.info('speech voices available', { count: voices.length });
    return OK;
  });
  handle('engine:error', ({ scope, message }) => {
    log.warn('engine reported a problem', { scope, message });
    ctx.voice.onEngineError(scope, message);
    return OK;
  });
}
