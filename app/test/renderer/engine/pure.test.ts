import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCommand, rejectedStartId } from '@renderer/engine/commands';
import { CUE_NOTES, MAX_CUE_GAIN, cueDurationMs } from '@renderer/engine/cue-notes';
import { LevelThrottle, SyntheticLevelLoop } from '@renderer/engine/levels';
import { clampMessage, createReporter, describeError, toVoiceList, type EngineBridge } from '@renderer/engine/report';
import { splitForSpeech } from '@renderer/engine/sentences';
import { fakeReporter, settle } from './fakes';

describe('parseCommand', () => {
  it('accepts every contract command', () => {
    const commands = [
      { type: 'start', requestId: 'r1', deviceId: null, endpointing: { enabled: true, endSilenceMs: 2200, noSpeechTimeoutMs: 8000 }, maxDurationMs: 600_000 },
      { type: 'stop', requestId: 'r1' },
      { type: 'cancel', requestId: 'r1' },
      { type: 'clap', enabled: true, sensitivity: 'high' },
      { type: 'activity', userActive: false },
      { type: 'speak', text: 'Hello', voiceName: null, rate: 0.95 },
      { type: 'stop-speaking' },
      { type: 'cue', name: 'reminder' },
    ];
    commands.forEach((c) => expect(parseCommand(c)).toEqual({ ok: true, command: c }));
  });

  it('rejects malformed commands with a readable reason', () => {
    const bad = parseCommand({ type: 'start', requestId: '', deviceId: null, endpointing: {}, maxDurationMs: 5 });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.message).toMatch(/invalid engine command/);
    expect(parseCommand({ type: 'explode' }).ok).toBe(false);
    expect(parseCommand(null).ok).toBe(false);
  });
});

describe('splitForSpeech', () => {
  it('splits sentences and normalises whitespace', () => {
    expect(splitForSpeech('  Hello there.  How are\nyou?  Fine! ')).toEqual(['Hello there.', 'How are you?', 'Fine!']);
    expect(splitForSpeech('')).toEqual([]);
  });

  it('breaks long sentences at clauses, then words, then hard-cuts huge words', () => {
    const long = `${'word '.repeat(30).trim()}, ${'more '.repeat(10).trim()}`;
    const parts = splitForSpeech(long, 60);
    expect(parts.every((p) => p.length <= 60)).toBe(true);
    expect(parts.join(' ').replace(/,/g, '')).toBe(long.replace(/,/g, ''));
    expect(splitForSpeech('x'.repeat(130), 50)).toEqual(['x'.repeat(50), 'x'.repeat(50), 'x'.repeat(30)]);
  });
});

describe('cue notes', () => {
  it('stay gentle: peak gain ≤ 0.12 and short durations', () => {
    Object.entries(CUE_NOTES).forEach(([name, notes]) => {
      expect(notes.length).toBeGreaterThan(0);
      notes.forEach((n) => {
        expect(n.gain).toBeLessThanOrEqual(MAX_CUE_GAIN);
        expect(n.durationMs).toBeGreaterThanOrEqual(40);
      });
      expect(cueDurationMs(name as keyof typeof CUE_NOTES)).toBeLessThan(1000);
    });
  });

  it('start rises and stop falls', () => {
    expect(CUE_NOTES.start[1].hz).toBeGreaterThan(CUE_NOTES.start[0].hz);
    expect(CUE_NOTES.stop[1].hz).toBeLessThan(CUE_NOTES.stop[0].hz);
    expect(CUE_NOTES.reminder).toHaveLength(3);
  });
});

describe('levels', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('throttles emissions to the minimum interval', () => {
    const throttle = new LevelThrottle(34);
    expect([0, 10, 34, 50, 68].map((t) => throttle.shouldEmit(t))).toEqual([true, false, true, false, true]);
  });

  it('runs a synthetic envelope while speaking and settles to silence', () => {
    const report = fakeReporter();
    const loop = new SyntheticLevelLoop(report, () => Date.now());
    loop.start();
    loop.start();
    vi.advanceTimersByTime(1000);
    expect(loop.running).toBe(true);
    expect(report.levels.length).toBeGreaterThanOrEqual(28);
    expect(report.levels.length).toBeLessThanOrEqual(30);
    loop.stop();
    loop.stop();
    expect(report.levels[report.levels.length - 1].level).toBe(0);
  });
});

describe('report helpers', () => {
  it('describes and clamps messages', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('text')).toBe('text');
    expect(describeError(42)).toBe('Unknown error.');
    expect(clampMessage('x'.repeat(600))).toHaveLength(500);
    expect(clampMessage('  ')).toMatch(/audio engine/);
  });

  it('sanitises voices to the contract limits', () => {
    const raw = [
      { name: 'A'.repeat(200), lang: 'en-US-x-very-long-tag-here', default: true },
      { name: 'B', lang: 'en', default: false },
      { name: 'B', lang: 'en', default: false },
      { name: '', lang: 'en', default: false },
    ];
    const list = toVoiceList(raw);
    expect(list).toHaveLength(2);
    expect(list[0].name).toHaveLength(120);
    expect(list[0].lang).toHaveLength(20);
    expect(list[0].isDefault).toBe(true);
    expect(toVoiceList(Array.from({ length: 500 }, (_, i) => ({ name: `v${i}`, lang: 'en', default: false })))).toHaveLength(400);
  });
});

describe('createReporter', () => {
  function bridge(failCapture: boolean) {
    const calls: { channel: string; request: unknown }[] = [];
    const sent: unknown[] = [];
    const b: EngineBridge = {
      invoke: async (channel, request) => {
        calls.push({ channel, request });
        if (failCapture && channel === 'engine:capture' && (request as { wav: unknown }).wav !== null) throw new Error('too big');
        return { ok: true };
      },
      send: (_channel, payload) => {
        sent.push(payload);
      },
    };
    return { b, calls, sent };
  }

  it('sends errors, claps, voices, readiness and clamped levels', async () => {
    const { b, calls, sent } = bridge(false);
    const report = createReporter(b, () => undefined);
    report.error('mic', 'x'.repeat(700));
    report.clap(5);
    report.voices([{ name: 'A', lang: 'en', isDefault: true }]);
    await report.ready();
    report.level({ level: 2, bands: [Number.NaN, -1, 0.5] });
    await settle();
    expect(calls.map((c) => c.channel)).toEqual(['engine:error', 'engine:clap', 'engine:voices', 'engine:ready']);
    expect((calls[0].request as { message: string }).message).toHaveLength(500);
    expect(sent).toEqual([{ level: 1, bands: [0, 0, 0.5] }]);
  });

  it('retries a rejected capture without audio so main is never left waiting', async () => {
    const { b, calls } = bridge(true);
    const failures: string[] = [];
    const report = createReporter(b, (m) => failures.push(m));
    await report.capture({ requestId: 'r', reason: 'stopped', wav: new Uint8Array(44), stats: { durationMs: 1, speechMs: 1, segments: 1, pauseCount: 0, longPauseCount: 0, meanPauseMs: 0, maxPauseMs: 0, speechLevelDb: -20 } });
    expect(calls).toHaveLength(2);
    expect(calls[1].request).toMatchObject({ reason: 'error', wav: null });
    expect(failures).toHaveLength(1);
  });

  it('never throws when the bridge fails', async () => {
    const failures: string[] = [];
    const report = createReporter({
      invoke: async () => {
        throw new Error('gone');
      },
      send: () => {
        throw new Error('gone');
      },
    }, (m) => failures.push(m));
    report.error('tts', 'x');
    report.level({ level: 0, bands: [] });
    await report.ready();
    await settle();
    expect(failures.length).toBe(3);
  });
});

describe('rejectedStartId', () => {
  it('extracts a usable requestId only from rejected start commands', () => {
    expect(rejectedStartId({ type: 'start', requestId: 'r9', maxDurationMs: -1 })).toBe('r9');
    expect(rejectedStartId({ type: 'start', requestId: '' })).toBeNull();
    expect(rejectedStartId({ type: 'stop', requestId: 'r9' })).toBeNull();
    expect(rejectedStartId({ type: 'start' })).toBeNull();
    expect(rejectedStartId('start')).toBeNull();
  });
});
