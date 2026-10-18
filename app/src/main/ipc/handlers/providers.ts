import type { AppContext } from '../../services';
import type { Handle } from '../types';

/** providers:test — the Settings → AI "Test" buttons (a tiny real request; reports latency). */
export function registerProvidersHandlers(ctx: AppContext, handle: Handle): void {
  handle(
    'providers:test',
    ({ kind, providerId }) => (kind === 'llm' ? ctx.llm.test(providerId) : ctx.stt.test(providerId)),
    { allow: ['dashboard'] },
  );
}
