import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentBridge } from '../../../src/main/voice/agent-bridge';
import { estimateSpeechMs, IDLE_SNAPSHOT, parseYesNo, speakable } from '../../../src/main/voice/feedback';
import { createVoiceService } from '../../../src/main/voice';
import type { CapturePayload } from '../../../src/main/services';
import type { PendingConfirmation, SpeechStats, VoiceSnapshot } from '../../../src/shared/types';
import { createFakeContext } from '../agent/fake-context';

const STATS: SpeechStats = { durationMs: 2000, speechMs: 1500, segments: 1, pauseCount: 0, longPauseCount: 0, meanPauseMs: 0, maxPauseMs: 0, speechLevelDb: -20 };
const confirmation: PendingConfirmation = { runId: 'run1', callId: 'c1', tool: 'quit_app', title: 'Quit Spotify', summary: 'Quit Spotify?' };

afterEach(() => vi.useRealTimers());

describe('parseYesNo', () => {
  it.each([['Yes.', true], ['yeah', true], ['Go ahead!', true], ['do it please', true], ['No.', false], ['cancel', false], ['never mind', false], ['nope', false]])(
    '"%s" → %s', (text, expected) => expect(parseYesNo(text)).toBe(expected),
  );

  it.each(['yes but first open notes', 'what?', 'play music'])('"%s" is not a yes/no', (text) => {
    expect(parseYesNo(text)).toBeNull();
  });
});

describe('speech helpers', () => {
  it('estimates speaking time within bounds and strips markdown and links', () => {
    expect(estimateSpeechMs('Hi.', 1)).toBe(1200);
    expect(estimateSpeechMs('word '.repeat(1000), 1)).toBe(30_000);
    expect(speakable('**Done** — see [the page](https://x.org) or https://y.org')).toBe('Done — see the page or the link');
  });
});

describe('agent bridge', () => {
  function bridge() {
    let current: VoiceSnapshot = { ...IDLE_SNAPSHOT, sessionId: 's1', phase: 'thinking' };
    const updates: { phase: string | null; patch: Partial<VoiceSnapshot> }[] = [];
    const confirm = vi.fn();
    const instance = createAgentBridge({
      update: (_sessionId, phase, patch) => { updates.push({ phase, patch }); current = { ...current, ...patch, ...(phase ? { phase } : {}) }; },
      current: () => current, restore: (snapshot) => { current = snapshot; }, leafy: vi.fn(), onConfirm: vi.fn(), confirm,
    });
    return { instance, updates, confirm, current: () => current };
  }

  it('binds only the expected voice run and maps its events to phases', () => {
    const { instance, updates } = bridge();
    instance.handle({ type: 'run-start', runId: 'palette-run', input: 'x', source: 'palette' });
    instance.handle({ type: 'tool-start', runId: 'palette-run', callId: 'c', tool: 'open_app', title: 'Open' });
    expect(updates).toEqual([]);
    instance.expectRun('s1');
    instance.handle({ type: 'run-start', runId: 'run1', input: 'quit spotify', source: 'voice' });
    instance.handle({ type: 'tool-confirm', runId: 'run1', confirmation });
    expect(instance.pending()).toEqual(confirmation);
    expect(instance.runFor('s1')).toBe('run1');
    instance.handle({ type: 'tool-end', runId: 'run1', callId: 'c1', ok: false, summary: 'Not done.' });
    expect(instance.pending()).toBeNull();
    instance.handle({ type: 'run-end', runId: 'run1', text: 'ok', ok: true });
    expect(instance.runFor('s1')).toBeNull();
    expect(updates.map((update) => update.phase)).toEqual(['confirming', null]);
  });

  it('answers and restores the confirming session', () => {
    const { instance, confirm, current } = bridge();
    expect(instance.answer(true, true)).toBe(false);
    instance.expectRun('s1');
    instance.handle({ type: 'run-start', runId: 'run1', input: 'x', source: 'voice' });
    instance.handle({ type: 'tool-confirm', runId: 'run1', confirmation });
    expect(instance.answer(false, true)).toBe(true);
    expect(confirm).toHaveBeenCalledWith('run1', 'c1', false);
    expect(current()).toMatchObject({ phase: 'thinking', pending: null, detail: 'Okay, I won’t.' });
    instance.forget('s1');
    expect(instance.pendingSession()).toBeNull();
  });
});

describe('voice service edges', () => {
  const payload = (requestId: string): CapturePayload => ({ requestId, reason: 'stopped', wav: new Uint8Array(32), stats: STATS });
  const startId = (fake: ReturnType<typeof createFakeContext>) => {
    const start = [...fake.engine].reverse().find((command) => command.type === 'start');
    return start?.type === 'start' ? start.requestId : '';
  };

  it('cancel during processing aborts STT and records nothing', async () => {
    const fake = createFakeContext();
    const stt = fake.ctx.stt as unknown as { transcribe: ReturnType<typeof vi.fn> };
    stt.transcribe.mockImplementation((_wav: Uint8Array, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const voice = createVoiceService(fake.ctx);
    voice.start('dictate', 'hotkey');
    voice.stop();
    const done = voice.onCapture(payload(startId(fake)));
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(voice.cancel().phase).toBe('idle');
    await done;

    expect(fake.history).toEqual([]);
    expect(fake.os.pasted).toEqual([]);
  });

  it('cancelling a command run cancels the agent and declines its pending confirmation', async () => {
    const fake = createFakeContext({ settings: { voice: { speakResponses: false } } });
    const stt = fake.ctx.stt as unknown as { transcribe: ReturnType<typeof vi.fn> };
    const agent = fake.ctx.agent as unknown as { run: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> };
    stt.transcribe.mockResolvedValue({ text: 'quit spotify', providerId: 'groq', latencyMs: 1, noSpeech: false });
    let finish: () => void = () => undefined;
    agent.run.mockImplementation(() => {
      fake.bus.emit('agent:event', { type: 'run-start', runId: 'run1', input: 'quit spotify', source: 'voice' });
      fake.bus.emit('agent:event', { type: 'tool-confirm', runId: 'run1', confirmation });
      return new Promise((resolve) => { finish = () => resolve({ runId: 'run1', reply: 'Okay, I stopped.', ok: false, actions: [] }); });
    });
    const voice = createVoiceService(fake.ctx);
    voice.start('command', 'fn');
    const done = voice.onCapture(payload(startId(fake)));
    await new Promise((resolve) => setTimeout(resolve, 5));

    voice.cancel();
    finish();
    await done;

    expect(agent.confirm).toHaveBeenCalledWith('run1', 'c1', false);
    expect(agent.cancel).toHaveBeenCalledWith('run1');
    expect(fake.bus.of('voice:snapshot').at(-1)?.phase).toBe('idle');
  });

  it('a hands-free confirmation starts listening for the answer', async () => {
    vi.useFakeTimers();
    const fake = createFakeContext();
    const stt = fake.ctx.stt as unknown as { transcribe: ReturnType<typeof vi.fn> };
    const agent = fake.ctx.agent as unknown as { run: ReturnType<typeof vi.fn> };
    stt.transcribe.mockResolvedValue({ text: 'lock the screen', providerId: 'groq', latencyMs: 1, noSpeech: false });
    agent.run.mockImplementation(() => {
      fake.bus.emit('agent:event', { type: 'run-start', runId: 'run1', input: 'lock', source: 'voice' });
      fake.bus.emit('agent:event', { type: 'tool-confirm', runId: 'run1', confirmation: { ...confirmation, tool: 'lock_screen', summary: 'Lock the screen now?' } });
      return new Promise(() => undefined);
    });
    const voice = createVoiceService(fake.ctx);
    voice.start('command', 'clap');
    void voice.onCapture(payload(startId(fake)));
    await vi.advanceTimersByTimeAsync(5000);

    expect(fake.engine).toContainEqual(expect.objectContaining({ type: 'speak', text: 'Lock the screen now? Say yes or no.' }));
    expect(fake.engine.filter((command) => command.type === 'start')).toHaveLength(2);
    expect(voice.snapshot()).toMatchObject({ phase: 'listening', pending: { callId: 'c1' } });
  });

  it('ignores claps and engine noise from other scopes', () => {
    const fake = createFakeContext();
    const voice = createVoiceService(fake.ctx);
    voice.onEngineError('tts', 'voice missing');
    expect(fake.bus.of('voice:snapshot')).toEqual([]);
    voice.start('dictate', 'hotkey');
    voice.onClap(0);
    expect(fake.engine.filter((command) => command.type === 'start')).toHaveLength(1);
  });
});
