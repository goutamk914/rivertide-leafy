import { describe, expect, it, vi } from 'vitest';
import { registerAgentHandlers } from '../../../src/main/ipc/handlers/agent';
import { registerHotkeysHandlers } from '../../../src/main/ipc/handlers/hotkeys';
import { registerProvidersHandlers } from '../../../src/main/ipc/handlers/providers';
import { registerVoiceHandlers } from '../../../src/main/ipc/handlers/voice';
import type { Handle, HandleOptions, Handler } from '../../../src/main/ipc/types';
import type { InvokeChannel } from '../../../src/shared/ipc-channels';
import { createFakeContext } from './fake-context';

function capture() {
  const handlers = new Map<string, { handler: Handler<InvokeChannel>; options?: HandleOptions }>();
  const handle: Handle = (channel, handler, options) => { handlers.set(channel, { handler: handler as Handler<InvokeChannel>, options }); };
  const call = (channel: string, request: unknown) => handlers.get(channel)!.handler(request as never, { kind: 'dashboard', webContentsId: 1 });
  return { handle, handlers, call };
}

describe('voice/agent/providers/hotkeys IPC handlers', () => {
  it('routes voice and agent channels to the services', async () => {
    const fake = createFakeContext({
      services: {
        hotkeys: { status: () => [{ action: 'palette', accelerator: 'X', registered: true }] },
        llm: { test: vi.fn(async () => ({ ok: true, latencyMs: 5, message: 'llm' })) },
        stt: { test: vi.fn(async () => ({ ok: true, latencyMs: 6, message: 'stt' })) },
      },
    });
    (fake.ctx.agent.ask as ReturnType<typeof vi.fn>).mockReturnValue({ runId: 'r1' });
    const { handle, handlers, call } = capture();
    registerVoiceHandlers(fake.ctx, handle);
    registerAgentHandlers(fake.ctx, handle);
    registerProvidersHandlers(fake.ctx, handle);
    registerHotkeysHandlers(fake.ctx, handle);

    await call('voice:start', { mode: 'command', source: 'leafy' });
    await call('voice:stop', undefined);
    await call('voice:cancel', undefined);
    await call('voice:snapshot', undefined);
    expect(fake.ctx.voice.start).toHaveBeenCalledWith('command', 'leafy');
    expect(fake.ctx.voice.stop).toHaveBeenCalled();
    expect(fake.ctx.voice.cancel).toHaveBeenCalled();

    expect(await call('agent:ask', { text: 'hi', source: 'palette' })).toEqual({ runId: 'r1' });
    expect(await call('agent:confirm', { runId: 'r1', callId: 'c1', approved: true })).toEqual({ ok: true });
    expect(await call('agent:cancel', { runId: 'r1' })).toEqual({ ok: true });
    expect(fake.ctx.agent.confirm).toHaveBeenCalledWith('r1', 'c1', true);
    expect(fake.ctx.agent.cancel).toHaveBeenCalledWith('r1');

    expect(await call('providers:test', { kind: 'llm', providerId: 'anthropic' })).toMatchObject({ message: 'llm' });
    expect(await call('providers:test', { kind: 'stt', providerId: 'groq' })).toMatchObject({ message: 'stt' });
    expect(handlers.get('providers:test')?.options).toEqual({ allow: ['dashboard'] });
    expect(await call('hotkeys:status', undefined)).toEqual([{ action: 'palette', accelerator: 'X', registered: true }]);
  });
});
