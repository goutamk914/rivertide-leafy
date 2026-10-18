import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioHub, withTimeout } from '@renderer/engine/audio-hub';
import { CuePlayer } from '@renderer/engine/cues';
import { CUE_NOTES, MAX_CUE_GAIN } from '@renderer/engine/cue-notes';
import { ENGINE } from '@renderer/engine/dsp/tuning';
import { fakeStream, settle } from './fakes';

class FakeParam {
  value: number;
  events: [string, number, number][] = [];
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push(['exp', v, t]);
  }
}

class FakeNode {
  static created: FakeNode[] = [];
  readonly kind: string;
  readonly options: Record<string, unknown>;
  connected: unknown[] = [];
  disconnected = 0;
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  gain = new FakeParam(1);
  frequency = new FakeParam(440);
  port = { posted: [] as unknown[], onmessage: null as ((e: { data: unknown }) => void) | null, postMessage(m: unknown) { this.posted.push(m); } };
  constructor(kind: string, _ctx: unknown, nameOrOptions?: unknown, options?: Record<string, unknown>) {
    this.kind = kind;
    this.options = (typeof nameOrOptions === 'object' ? nameOrOptions : options) as Record<string, unknown> ?? {};
    FakeNode.created.push(this);
  }
  connect(target: unknown) {
    this.connected.push(target);
  }
  disconnect() {
    this.disconnected += 1;
  }
  start(t: number) {
    this.started = t;
  }
  stop(t: number) {
    this.stopped = t;
  }
}

const nodeClass = (kind: string) => class extends FakeNode {
  constructor(ctx: unknown, a?: unknown, b?: Record<string, unknown>) {
    super(kind, ctx, a, b);
  }
};

class FakeContext {
  static made = 0;
  /** The next context's resume() never settles (autoplay blocked). */
  static hangNext = false;
  state: string = 'suspended';
  readonly sampleRate = 48_000;
  currentTime = 1;
  readonly destination = { kind: 'destination' };
  resumeHangs = FakeContext.hangNext;
  private listeners: (() => void)[] = [];
  readonly audioWorklet = { addModule: vi.fn(async () => undefined) };
  constructor() {
    FakeContext.made += 1;
  }
  addEventListener(_type: string, fn: () => void) {
    this.listeners.push(fn);
  }
  setState(state: string) {
    this.state = state;
    this.listeners.forEach((l) => l());
  }
  resume = vi.fn(() => (this.resumeHangs ? new Promise<void>(() => undefined) : Promise.resolve(this.setState('running'))));
  suspend = vi.fn(async () => this.setState('suspended'));
  close = vi.fn(async () => this.setState('closed'));
}

describe('AudioHub', () => {
  let contexts: FakeContext[];
  let errors: string[];
  const hub = () => new AudioHub({
    workletUrl: 'app://worklets/capture-processor.js',
    onError: (m) => errors.push(m),
    createContext: () => {
      const c = new FakeContext();
      contexts.push(c);
      return c as unknown as AudioContext;
    },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    contexts = [];
    errors = [];
    FakeNode.created = [];
    for (const kind of ['MediaStreamAudioSourceNode', 'AudioWorkletNode', 'GainNode', 'OscillatorNode']) vi.stubGlobal(kind, nodeClass(kind));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens a tap: resumes the context, loads the worklet once, and wires a silent sink', async () => {
    // Arrange
    const h = hub();
    const batches: Float32Array[] = [];

    // Act
    const tap = await h.openTap(fakeStream().stream, 'capture:1', (s) => batches.push(s));
    await h.openTap(fakeStream().stream, 'clap', () => undefined);
    const worklet = FakeNode.created.find((n) => n.kind === 'AudioWorkletNode') as FakeNode;
    worklet.port.onmessage?.({ data: new Float32Array(4) });
    worklet.port.onmessage?.({ data: 'junk' });
    tap.flush();
    tap.dispose();
    tap.dispose();

    // Assert
    expect(contexts).toHaveLength(1);
    expect(contexts[0].state).toBe('running');
    expect(contexts[0].audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(tap.sampleRate).toBe(48_000);
    expect(batches).toHaveLength(1);
    const sink = FakeNode.created.find((n) => n.kind === 'GainNode') as FakeNode;
    expect(sink.options).toMatchObject({ gain: 0 });
    expect(sink.connected).toEqual([contexts[0].destination]);
    expect(worklet.port.posted).toEqual([{ type: 'flush' }, { type: 'stop' }]);
    expect(worklet.disconnected).toBe(1);
  });

  it('suspends after being idle and recreates a closed context', async () => {
    const h = hub();
    await h.acquire('cue:1');
    h.release('cue:1');
    await vi.advanceTimersByTimeAsync(ENGINE.contextIdleSuspendMs + 10);
    expect(contexts[0].suspend).toHaveBeenCalledTimes(1);
    contexts[0].setState('closed');
    await h.acquire('cue:2');
    expect(contexts).toHaveLength(2);
    await h.close();
    expect(contexts[1].close).toHaveBeenCalled();
  });

  it('resumes when the OS suspends audio while something still needs it', async () => {
    const h = hub();
    await h.acquire('clap');
    contexts[0].setState('suspended');
    await settle();
    expect(contexts[0].resume).toHaveBeenCalledTimes(2);
    expect(contexts[0].state).toBe('running');
  });

  it('fails clearly when audio cannot start (autoplay blocked) and releases the hold', async () => {
    const h = hub();
    FakeContext.hangNext = true;
    const pending = h.acquire('capture:1');
    FakeContext.hangNext = false;
    const assertion = expect(pending).rejects.toThrow(/could not start/);
    await vi.advanceTimersByTimeAsync(ENGINE.contextResumeTimeoutMs + 10);
    await assertion;
    // The failed hold was released, so the idle timer eventually tries to suspend.
    await vi.advanceTimersByTimeAsync(ENGINE.contextIdleSuspendMs + 10);
    expect(contexts[0].suspend).not.toHaveBeenCalled(); // never reached 'running', nothing to suspend
  });

  it('allows a retry when the worklet fails to load', async () => {
    const h = hub();
    await h.acquire('x');
    contexts[0].audioWorklet.addModule.mockRejectedValueOnce(new Error('404'));
    await expect(h.openTap(fakeStream().stream, 'capture:1', () => undefined)).rejects.toThrow(/worklet could not load/);
    await expect(h.openTap(fakeStream().stream, 'capture:2', () => undefined)).resolves.toBeDefined();
  });

  it('plays cues with gentle exponential envelopes and releases the context afterwards', async () => {
    const h = hub();
    const player = new CuePlayer(h);
    await player.play('confirm');
    const oscillators = FakeNode.created.filter((n) => n.kind === 'OscillatorNode');
    const gains = FakeNode.created.filter((n) => n.kind === 'GainNode');
    expect(oscillators).toHaveLength(CUE_NOTES.confirm.length);
    gains.forEach((g) => {
      const peaks = g.gain.events.filter(([type]) => type === 'exp').map(([, v]) => v);
      expect(Math.max(...peaks)).toBeLessThanOrEqual(MAX_CUE_GAIN);
      expect(peaks[peaks.length - 1]).toBeLessThan(0.001);
    });
    expect(oscillators[1].frequency.events.map(([type]) => type)).toEqual(['set', 'exp']);
    oscillators[0].onended?.();
    expect(oscillators[0].disconnected).toBe(1);
    await vi.advanceTimersByTimeAsync(1000 + ENGINE.contextIdleSuspendMs);
    expect(contexts[0].suspend).toHaveBeenCalled();
  });
});

describe('withTimeout', () => {
  it('passes through results and errors', async () => {
    await expect(withTimeout(Promise.resolve(1), 10, 'x')).resolves.toBe(1);
    await expect(withTimeout(Promise.reject(new Error('y')), 10, 'x')).rejects.toThrow('y');
  });
});
