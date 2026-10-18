import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceService, HIDE_AFTER_DONE_MS, HIDE_AFTER_ERROR_MS } from '../../../src/main/voice';
import { COPIED_NOTICE } from '../../../src/main/voice/pipeline';
import type { CapturePayload } from '../../../src/main/services';
import type { PendingConfirmation, SpeechStats } from '../../../src/shared/types';
import { createFakeContext, type FakeContext } from '../agent/fake-context';

const STATS: SpeechStats = { durationMs: 2000, speechMs: 1500, segments: 1, pauseCount: 0, longPauseCount: 0, meanPauseMs: 0, maxPauseMs: 0, speechLevelDb: -20 };
const payload = (requestId: string, reason: CapturePayload['reason'] = 'stopped'): CapturePayload => ({ requestId, reason, wav: reason === 'no-speech' ? null : new Uint8Array(32), stats: STATS });
const startId = (fake: FakeContext): string => {
  const start = [...fake.engine].reverse().find((command) => command.type === 'start');
  return start?.type === 'start' ? start.requestId : '';
};
const confirmation: PendingConfirmation = { runId: 'run1', callId: 'c1', tool: 'quit_app', title: 'Quit Spotify', summary: 'Quit Spotify?' };
const stt = (fake: FakeContext) => fake.ctx.stt as unknown as { transcribe: ReturnType<typeof vi.fn> };
const agentOf = (fake: FakeContext) => fake.ctx.agent as unknown as { run: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };

afterEach(() => vi.useRealTimers());

describe('island visibility', () => {
  it('a slow older session finishing late does not cancel the newer session’s hide (island never sticks)', async () => {
    vi.useFakeTimers();
    const fake = createFakeContext({ settings: { voice: { polish: { enabled: false } } } });
    let releaseA: () => void = () => undefined;
    stt(fake).transcribe
      .mockImplementationOnce(() => new Promise((resolve) => { releaseA = () => resolve({ text: 'first', providerId: 'groq', latencyMs: 1, noSpeech: false }); }))
      .mockResolvedValueOnce({ text: 'second', providerId: 'groq', latencyMs: 1, noSpeech: false });
    const voice = createVoiceService(fake.ctx);

    voice.start('dictate', 'hotkey');
    const a = startId(fake);
    voice.stop();
    const doneA = voice.onCapture(payload(a));
    voice.start('dictate', 'hotkey');
    const b = startId(fake);
    voice.stop();
    const doneB = voice.onCapture(payload(b));
    await vi.advanceTimersByTimeAsync(10);
    releaseA();
    await Promise.all([doneA, doneB]);
    await vi.advanceTimersByTimeAsync(HIDE_AFTER_DONE_MS + 10);

    expect(fake.os.pasted).toEqual(['first', 'second']);
    expect(voice.snapshot().phase).toBe('idle');
    expect(fake.ctx.windows.island.hide).toHaveBeenCalled();
  });

  it('a hands-free answer with no speech puts the pending question back instead of an error', async () => {
    vi.useFakeTimers();
    const fake = createFakeContext({ settings: { voice: { speakResponses: false } } });
    stt(fake).transcribe.mockResolvedValue({ text: 'quit spotify', providerId: 'groq', latencyMs: 1, noSpeech: false });
    agentOf(fake).run.mockImplementation(() => {
      fake.bus.emit('agent:event', { type: 'run-start', runId: 'run1', input: 'quit spotify', source: 'voice' });
      fake.bus.emit('agent:event', { type: 'tool-confirm', runId: 'run1', confirmation });
      return new Promise(() => undefined);
    });
    const voice = createVoiceService(fake.ctx);
    voice.start('command', 'clap');
    void voice.onCapture(payload(startId(fake)));
    await vi.advanceTimersByTimeAsync(1000); // auto-listen for the answer
    expect(voice.snapshot().phase).toBe('listening');

    await voice.onCapture(payload(startId(fake), 'no-speech'));
    expect(voice.snapshot()).toMatchObject({ phase: 'confirming', pending: { callId: 'c1' }, error: null });

    await vi.advanceTimersByTimeAsync(HIDE_AFTER_ERROR_MS * 3);
    expect(voice.snapshot().phase).toBe('confirming');
    expect(agentOf(fake).confirm).not.toHaveBeenCalled();
  });

  it('an island-button approval clears the pending confirmation', async () => {
    const fake = createFakeContext({ settings: { voice: { speakResponses: false } } });
    stt(fake).transcribe.mockResolvedValue({ text: 'quit spotify', providerId: 'groq', latencyMs: 1, noSpeech: false });
    agentOf(fake).run.mockImplementation(() => {
      fake.bus.emit('agent:event', { type: 'run-start', runId: 'run1', input: 'quit spotify', source: 'voice' });
      fake.bus.emit('agent:event', { type: 'tool-confirm', runId: 'run1', confirmation });
      fake.bus.emit('agent:event', { type: 'tool-start', runId: 'run1', callId: 'c1', tool: 'quit_app', title: 'Quit Spotify' });
      return new Promise(() => undefined);
    });
    const voice = createVoiceService(fake.ctx);
    voice.start('command', 'fn');
    void voice.onCapture(payload(startId(fake)));
    await new Promise((resolve) => setTimeout(resolve, 5));

    voice.start('command', 'hotkey');
    expect(voice.snapshot().pending).toBeNull();
  });
});

describe('where text goes', () => {
  it('copies (and says so) instead of pasting into Rivertide when dictating from the dashboard', async () => {
    const fake = createFakeContext({ settings: { voice: { polish: { enabled: false } } } });
    stt(fake).transcribe.mockResolvedValue({ text: 'note for later', providerId: 'groq', latencyMs: 1, noSpeech: false });
    const voice = createVoiceService(fake.ctx);
    voice.start('dictate', 'dashboard');
    await voice.onCapture(payload(startId(fake)));
    expect(fake.os.pasted).toEqual([]);
    expect(fake.os.copied).toEqual(['note for later']);
    expect(voice.snapshot()).toMatchObject({ phase: 'done', pasted: false, error: null, detail: COPIED_NOTICE });
  });

  it('treats Rivertide as the frontmost app the same way', async () => {
    const fake = createFakeContext({ settings: { voice: { polish: { enabled: false } } }, os: { frontmostApp: async () => ({ name: 'Rivertide', bundleId: 'org.codethecure.rivertide', pid: process.pid }) } });
    stt(fake).transcribe.mockResolvedValue({ text: 'hello', providerId: 'groq', latencyMs: 1, noSpeech: false });
    const voice = createVoiceService(fake.ctx);
    voice.start('dictate', 'hotkey');
    await voice.onCapture(payload(startId(fake)));
    expect(fake.os.pasted).toEqual([]);
    expect(fake.os.copied).toEqual(['hello']);
  });

  it('re-activates the captured app before typing', async () => {
    const order: string[] = [];
    const activateApp = vi.fn(async () => { order.push('activate'); return true; });
    const fake = createFakeContext({
      settings: { voice: { polish: { enabled: false }, output: 'type' } },
      os: Object.assign({ typeText: async () => { order.push('type'); return true; } }, { extras: { activateApp } }),
    });
    stt(fake).transcribe.mockResolvedValue({ text: 'typed words', providerId: 'groq', latencyMs: 1, noSpeech: false });
    const voice = createVoiceService(fake.ctx);
    voice.start('dictate', 'hotkey');
    await voice.onCapture(payload(startId(fake)));
    expect(activateApp).toHaveBeenCalledWith({ name: 'Mail', bundleId: 'com.apple.mail', pid: 42 });
    expect(order).toEqual(['activate', 'type']);
  });
});
