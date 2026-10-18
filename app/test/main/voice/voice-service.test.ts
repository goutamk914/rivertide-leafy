import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceService, HIDE_AFTER_DONE_MS } from '../../../src/main/voice';
import type { CapturePayload, VoiceService } from '../../../src/main/services';
import type { AgentEvent, SpeechStats, VoiceSnapshot } from '../../../src/shared/types';
import { createFakeContext, type FakeContext } from '../agent/fake-context';

const STATS: SpeechStats = { durationMs: 3000, speechMs: 2400, segments: 1, pauseCount: 0, longPauseCount: 0, meanPauseMs: 0, maxPauseMs: 0, speechLevelDb: -20 };
const capture = (requestId: string, reason: CapturePayload['reason'] = 'stopped'): CapturePayload => ({ requestId, reason, wav: new Uint8Array(64), stats: STATS });
const transcript = (text: string, latencyMs = 5) => ({ text, providerId: 'groq', latencyMs, noSpeech: false });

function setup(options: Parameters<typeof createFakeContext>[0] = {}) {
  const fake = createFakeContext(options);
  const voice = createVoiceService(fake.ctx);
  const services = fake.ctx as unknown as {
    stt: { transcribe: ReturnType<typeof vi.fn>; isConfigured: () => boolean };
    llm: { complete: ReturnType<typeof vi.fn>; isConfigured: (role: string) => boolean };
    agent: { run: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  };
  return { fake, voice, stt: services.stt, llm: services.llm, agent: services.agent };
}

const startRequestId = (fake: FakeContext): string => {
  const command = [...fake.engine].reverse().find((entry) => entry.type === 'start');
  if (command?.type !== 'start') throw new Error('no start command');
  return command.requestId;
};
const lastSnapshot = (fake: FakeContext): VoiceSnapshot => fake.bus.of('voice:snapshot').at(-1)!;

afterEach(() => {
  vi.useRealTimers();
});

describe('voice service — starting', () => {
  it('captures the frontmost app first, starts the engine and shows the island', () => {
    const frontmost = vi.fn(async () => ({ name: 'Mail', bundleId: 'com.apple.mail', pid: 1 }));
    const { fake, voice } = setup({ os: { frontmostApp: frontmost } });

    const snapshot = voice.start('command', 'hotkey');

    expect(frontmost).toHaveBeenCalledTimes(1);
    expect(fake.engine[0]).toMatchObject({ type: 'start', endpointing: { enabled: true, endSilenceMs: 2200, noSpeechTimeoutMs: 8000 }, maxDurationMs: 600_000 });
    expect(fake.engine[1]).toEqual({ type: 'cue', name: 'start' });
    expect(fake.ctx.windows.island.show).toHaveBeenCalled();
    expect(snapshot).toMatchObject({ phase: 'listening', mode: 'command', source: 'hotkey' });
  });

  it('is a no-op while already listening', () => {
    const { fake, voice } = setup();
    voice.start('dictate', 'hotkey');
    voice.start('command', 'leafy');
    expect(fake.engine.filter((entry) => entry.type === 'start')).toHaveLength(1);
  });

  it('ignores fn when the setting is off', () => {
    const { fake, voice } = setup({ settings: { hotkeys: { useFn: false } } });
    voice.handleFnKey({ down: true, t: 0, mods: { ctrl: false, shift: false, alt: false, cmd: false } });
    expect(fake.engine).toEqual([]);
  });

  it('cancel while listening tells the engine and resets the island', () => {
    const { fake, voice } = setup();
    voice.start('dictate', 'hotkey');
    const snapshot = voice.cancel();
    expect(fake.engine).toContainEqual({ type: 'cancel', requestId: startRequestId(fake) });
    expect(snapshot.phase).toBe('idle');
    expect(fake.ctx.windows.island.hide).toHaveBeenCalled();
  });
});

describe('voice service — dictation', () => {
  it('transcribes, polishes, pastes, saves history and hides the island', async () => {
    vi.useFakeTimers();
    const { fake, voice, stt, llm } = setup();
    stt.transcribe.mockResolvedValue(transcript('um so I need ox ally platin on monday no tuesday'));
    llm.complete.mockResolvedValue({ text: 'I need Oxaliplatin on Tuesday.', providerId: 'anthropic', model: 'claude-opus-5-5', latencyMs: 9 });

    voice.start('dictate', 'hotkey');
    voice.stop();
    await voice.onCapture(capture(startRequestId(fake)));

    expect(stt.transcribe.mock.calls[0][1].prompt).toContain('Oxaliplatin');
    expect(llm.complete.mock.calls[0][1].messages[0].content).toContain('Oxaliplatin on monday no tuesday');
    expect(fake.os.pasted).toEqual(['I need Oxaliplatin on Tuesday.']);
    expect(fake.history[0]).toMatchObject({ mode: 'dictate', status: 'ok', raw: 'um so I need Oxaliplatin on monday no tuesday', output: 'I need Oxaliplatin on Tuesday.', pasted: true, providers: { stt: 'groq', llm: 'anthropic' } });
    expect(fake.bus.of('voice:completed')).toHaveLength(1);
    expect(lastSnapshot(fake)).toMatchObject({ phase: 'done', pasted: true });

    await vi.advanceTimersByTimeAsync(HIDE_AFTER_DONE_MS);
    expect(lastSnapshot(fake).phase).toBe('idle');
  });

  it('pastes the raw transcript when polishing fails (never loses words)', async () => {
    const { fake, voice, stt, llm } = setup();
    stt.transcribe.mockResolvedValue(transcript('call the clinic tomorrow'));
    llm.complete.mockRejectedValue(new Error('network down'));

    voice.start('dictate', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));

    expect(fake.os.pasted).toEqual(['call the clinic tomorrow']);
    expect(fake.history[0]).toMatchObject({ status: 'ok', output: 'call the clinic tomorrow' });
  });

  it('pastes the raw transcript when the polish reads like an answer', async () => {
    const { fake, voice, stt, llm } = setup();
    stt.transcribe.mockResolvedValue(transcript('what is the capital of france'));
    llm.complete.mockResolvedValue({ text: 'Sure! The capital of France is Paris, a city known for…', providerId: 'anthropic', model: 'm', latencyMs: 1 });

    voice.start('dictate', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));

    expect(fake.os.pasted).toEqual(['what is the capital of france']);
  });

  it('skips the LLM when polish is turned off', async () => {
    const { fake, voice, stt, llm } = setup({ settings: { voice: { polish: { enabled: false } } } });
    stt.transcribe.mockResolvedValue(transcript('plain words'));

    voice.start('dictate', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));

    expect(llm.complete).not.toHaveBeenCalled();
    expect(fake.os.pasted).toEqual(['plain words']);
  });

  it('records an empty item and says so when nothing was heard', async () => {
    const { fake, voice, stt } = setup();
    stt.transcribe.mockResolvedValue({ text: '', providerId: 'groq', latencyMs: 3, noSpeech: true });

    voice.start('dictate', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));

    expect(fake.history[0]).toMatchObject({ status: 'empty', raw: '' });
    expect(lastSnapshot(fake)).toMatchObject({ phase: 'error', error: { code: 'no-speech' } });
    expect(fake.os.pasted).toEqual([]);
  });

  it('treats a no-speech capture from the engine the same way', async () => {
    const { fake, voice, stt } = setup();
    voice.start('command', 'clap');
    await voice.onCapture({ ...capture(startRequestId(fake), 'no-speech'), wav: null });
    expect(stt.transcribe).not.toHaveBeenCalled();
    expect(fake.history[0].status).toBe('empty');
  });

  it('drops Whisper silence hallucinations', async () => {
    const { fake, voice, stt } = setup();
    stt.transcribe.mockResolvedValue(transcript('Thank you.'));
    voice.start('dictate', 'hotkey');
    await voice.onCapture({ ...capture(startRequestId(fake)), stats: { ...STATS, speechMs: 200 } });
    expect(fake.os.pasted).toEqual([]);
    expect(fake.history[0].status).toBe('empty');
  });

  it('explains how to fix a missing speech key', async () => {
    const { fake, voice } = setup({ services: { stt: { isConfigured: () => false, transcribe: vi.fn(), test: vi.fn() } } });
    voice.start('dictate', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));
    expect(lastSnapshot(fake).error).toEqual({ code: 'stt-not-configured', message: 'Add a speech key in Settings → AI to start dictating.' });
  });

  it('applies outputs strictly in session order', async () => {
    const { fake, voice, stt } = setup({ settings: { voice: { polish: { enabled: false } } } });
    let releaseFirst: (value: unknown) => void = () => undefined;
    stt.transcribe
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(transcript('first')); }))
      .mockResolvedValueOnce(transcript('second'));

    voice.start('dictate', 'hotkey');
    const first = startRequestId(fake);
    voice.stop();
    voice.start('dictate', 'hotkey');
    const second = startRequestId(fake);
    voice.stop();
    const firstDone = voice.onCapture(capture(first));
    const secondDone = voice.onCapture(capture(second));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.os.pasted).toEqual([]);
    releaseFirst(undefined);
    await Promise.all([firstDone, secondDone]);

    expect(fake.os.pasted).toEqual(['first', 'second']);
  });

  it('leaves the text on the clipboard and says so when pasting fails', async () => {
    const { fake, voice, stt } = setup({ settings: { voice: { polish: { enabled: false } } }, os: { paste: async () => false } });
    stt.transcribe.mockResolvedValue(transcript('keep these words'));
    voice.start('dictate', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));
    expect(fake.os.copied).toEqual(['keep these words']);
    expect(lastSnapshot(fake)).toMatchObject({ phase: 'done', pasted: false, error: { code: 'paste-failed' } });
  });
});

describe('voice service — ask and command', () => {
  it('answers a question and pastes the answer', async () => {
    const { fake, voice, stt, llm } = setup();
    stt.transcribe.mockResolvedValue(transcript('how long does neuropathy last'));
    llm.complete.mockResolvedValue({ text: 'It varies. I’m not a doctor — ask your care team.', providerId: 'anthropic', model: 'm', latencyMs: 4 });

    voice.start('ask', 'hotkey');
    await voice.onCapture(capture(startRequestId(fake)));

    expect(llm.complete.mock.calls[0][0]).toBe('answer');
    expect(fake.os.pasted).toEqual(['It varies. I’m not a doctor — ask your care team.']);
    expect(fake.history[0]).toMatchObject({ mode: 'ask', output: 'It varies. I’m not a doctor — ask your care team.' });
  });

  it('runs a command through the agent and speaks the reply', async () => {
    vi.useFakeTimers();
    const { fake, voice, stt, agent } = setup();
    stt.transcribe.mockResolvedValue(transcript('open spotify'));
    agent.run.mockImplementation(async () => {
      fake.bus.emit('agent:event', { type: 'run-start', runId: 'run1', input: 'open spotify', source: 'voice' });
      fake.bus.emit('agent:event', { type: 'tool-start', runId: 'run1', callId: 'c1', tool: 'open_app', title: 'Open Spotify' });
      return { runId: 'run1', reply: 'Opened Spotify.', ok: true, actions: [{ tool: 'open_app', title: 'Open Spotify', ok: true }] };
    });

    voice.start('command', 'clap');
    await voice.onCapture(capture(startRequestId(fake)));

    const phases = fake.bus.of('voice:snapshot').map((snapshot) => snapshot.phase);
    expect(phases).toEqual(expect.arrayContaining(['listening', 'transcribing', 'thinking', 'acting', 'speaking']));
    expect(fake.engine).toContainEqual({ type: 'speak', text: 'Opened Spotify.', voiceName: null, rate: 0.95 });
    expect(fake.history[0]).toMatchObject({ mode: 'command', output: 'Opened Spotify.', actions: [{ tool: 'open_app', ok: true }] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(lastSnapshot(fake).phase).toBe('done');
  });

  it('answers a pending confirmation with a spoken "yes"', async () => {
    const { fake, voice, stt, agent } = setup({ settings: { voice: { speakResponses: false } } });
    let finish: (value: unknown) => void = () => undefined;
    agent.run.mockImplementationOnce(() => {
      fake.bus.emit('agent:event', { type: 'run-start', runId: 'run1', input: 'quit spotify', source: 'voice' });
      const confirmation = { runId: 'run1', callId: 'c1', tool: 'quit_app', title: 'Quit Spotify', summary: 'Quit Spotify?' };
      fake.bus.emit('agent:event', { type: 'tool-confirm', runId: 'run1', confirmation } satisfies AgentEvent);
      return new Promise((resolve) => { finish = () => resolve({ runId: 'run1', reply: 'Quit Spotify.', ok: true, actions: [] }); });
    });
    stt.transcribe.mockResolvedValueOnce(transcript('quit spotify')).mockResolvedValueOnce(transcript('Yes.'));

    voice.start('command', 'hotkey');
    const first = voice.onCapture(capture(startRequestId(fake)));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(lastSnapshot(fake)).toMatchObject({ phase: 'confirming', pending: { callId: 'c1' } });

    voice.start('command', 'hotkey');
    expect(lastSnapshot(fake).pending).toMatchObject({ callId: 'c1' });
    await voice.onCapture(capture(startRequestId(fake)));

    expect(agent.confirm).toHaveBeenCalledWith('run1', 'c1', true);
    expect(agent.run).toHaveBeenCalledTimes(1);
    expect(fake.history).toHaveLength(0);
    finish(undefined);
    await first;
    expect(fake.history[0]).toMatchObject({ mode: 'command', output: 'Quit Spotify.' });
  });
});

describe('voice service — engine events', () => {
  it('reports a denied microphone with a plain fix and a toast', () => {
    const { fake, voice } = setup();
    voice.start('dictate', 'hotkey');
    voice.onEngineError('mic', 'NotAllowedError: Permission denied');
    expect(lastSnapshot(fake).error).toEqual({ code: 'mic-denied', message: 'Rivertide can’t hear you yet — allow the microphone in System Settings.' });
    expect(fake.bus.of('toast')[0]).toMatchObject({ kind: 'error' });
  });

  it('a double clap starts a hands-free command when idle', () => {
    const { fake, voice } = setup();
    voice.onClap(Date.now());
    expect(lastSnapshot(fake)).toMatchObject({ phase: 'listening', mode: 'command', source: 'clap' });
    voice.onClap(Date.now());
    expect(fake.engine.filter((entry) => entry.type === 'start')).toHaveLength(1);
  });

  it('“Hey Leafy” starts one hands-free command when idle, like a clap', () => {
    // Arrange
    const { fake, voice } = setup();

    // Act
    voice.onWake(Date.now());
    voice.onWake(Date.now()); // a second detection while listening is ignored

    // Assert
    expect(lastSnapshot(fake)).toMatchObject({ phase: 'listening', mode: 'command', source: 'wake' });
    const starts = fake.engine.filter((entry) => entry.type === 'start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ endpointing: { enabled: true } });
  });

  it('“Hey Leafy” never interrupts a session that is already busy', () => {
    const { fake, voice } = setup();
    voice.start('dictate', 'hotkey');
    voice.onWake(Date.now());
    expect(lastSnapshot(fake)).toMatchObject({ mode: 'dictate', source: 'hotkey' });
  });

  it('a double clap can open the palette instead', () => {
    const { fake, voice } = setup({ settings: { clap: { action: 'palette' } } });
    voice.onClap(Date.now());
    expect(fake.ctx.windows.palette.show).toHaveBeenCalledWith('voice');
  });

  it('ignores captures for unknown requests', async () => {
    const { fake, voice }: { fake: FakeContext; voice: VoiceService } = setup();
    await voice.onCapture(capture('nope'));
    expect(fake.history).toEqual([]);
  });
});
