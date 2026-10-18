import { describe, expect, it, vi } from 'vitest';
import type { WorkerEvent, WorkerRequest } from '../../../src/main/wake/protocol';
import {
  createWakeWordService, GAVE_UP_MESSAGE, MAX_RESTARTS, MISSING_FILES_MESSAGE, RESTART_DELAY_MS, UNSUPPORTED_MESSAGE, type WakeChild,
} from '../../../src/main/wake/service';
import { createWorkerHost, MAX_PENDING_FRAMES, type LoadedModels } from '../../../src/main/wake/worker-host';
import { missingModelFiles, MODEL_FILES, wakeModelDir } from '../../../src/main/wake/model-files';
import type { EngineCommand } from '../../../src/shared/ipc';
import type { Toast } from '../../../src/shared/types';
import { fakeContext } from '../core/fakes';

class FakeChild implements WakeChild {
  readonly sent: WorkerRequest[] = [];
  killed = false;
  private messageListener: (message: unknown) => void = () => undefined;
  private exitListener: (code: number) => void = () => undefined;
  postMessage(message: WorkerRequest): void { this.sent.push(message); }
  kill(): void { this.killed = true; }
  onMessage(listener: (message: unknown) => void): void { this.messageListener = listener; }
  onExit(listener: (code: number) => void): void { this.exitListener = listener; }
  emit(event: WorkerEvent | Record<string, unknown>): void { this.messageListener(event); }
  exit(code = 1): void { this.exitListener(code); }
}

function harness(options: { missing?: readonly string[]; supported?: boolean } = {}) {
  const ctx = fakeContext();
  const children: FakeChild[] = [];
  const timers: (() => void)[] = [];
  let clock = 1_000;
  const service = createWakeWordService(ctx, {
    fork: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    modelDir: '/models',
    missingFiles: () => options.missing ?? [],
    isSupported: () => options.supported ?? true,
    now: () => clock,
    schedule: (task) => { timers.push(task); },
  });
  const toasts: Toast[] = [];
  ctx.bus.on('toast', (t) => toasts.push(t));
  const engineCommands = () => vi.mocked(ctx.windows.engine.send).mock.calls.map(([c]) => c as EngineCommand);
  const enable = (sensitivity: 'low' | 'medium' | 'high' = 'medium') => ctx.settings.update({ wakeWord: { enabled: true, sensitivity } });
  const disable = () => ctx.settings.update({ wakeWord: { enabled: false } });
  const tick = (ms: number) => { clock += ms; };
  const runTimers = () => timers.splice(0).forEach((t) => t());
  return { ctx, service, children, toasts, engineCommands, enable, disable, tick, runTimers };
}

describe('wake word service (main)', () => {
  it('does nothing while the setting is off (the default)', () => {
    const h = harness();
    h.service.start();
    expect(h.children).toHaveLength(0);
    expect(h.engineCommands()).toEqual([]);
  });

  it('starts the listener when turned on and opens the mic only once it is ready', () => {
    // Arrange
    const h = harness();
    h.service.start();

    // Act
    h.enable('high');

    // Assert
    expect(h.children).toHaveLength(1);
    expect(h.children[0]?.sent[0]).toEqual({ type: 'start', modelDir: '/models', sensitivity: 'high' });
    expect(h.engineCommands()).toEqual([]);
    h.children[0]?.emit({ type: 'ready' });
    expect(h.engineCommands()).toEqual([{ type: 'wake', enabled: true, deviceId: null }]);
  });

  it('drops audio until the listener is ready, then forwards it', () => {
    const h = harness();
    h.service.start();
    h.enable();
    const samples = new Int16Array(1280);
    h.service.pushAudio(samples, true);
    h.children[0]?.emit({ type: 'ready' });
    h.service.pushAudio(samples, false);
    expect(h.children[0]?.sent.filter((m) => m.type === 'audio')).toEqual([{ type: 'audio', samples, fresh: false }]);
  });

  it('summons Leafy only for confirmed detections', () => {
    const h = harness();
    h.service.start();
    h.enable();
    h.children[0]?.emit({ type: 'ready' });
    h.children[0]?.emit({ type: 'rejected', score: 0.9, margin: -20 });
    expect(h.ctx.voice.onWake).not.toHaveBeenCalled();
    h.children[0]?.emit({ type: 'detected', score: 0.9, margin: -2 });
    expect(h.ctx.voice.onWake).toHaveBeenCalledWith(1_000);
  });

  it('ignores malformed messages from the listener', () => {
    const h = harness();
    h.service.start();
    h.enable();
    h.children[0]?.emit({ type: 'detected', score: 7 });
    expect(h.ctx.voice.onWake).not.toHaveBeenCalled();
  });

  it('closes the mic and stops the process when turned off', () => {
    const h = harness();
    h.service.start();
    h.enable();
    h.children[0]?.emit({ type: 'ready' });
    h.disable();
    expect(h.children[0]?.killed).toBe(true);
    expect(h.engineCommands().at(-1)).toEqual({ type: 'wake', enabled: false, deviceId: null });
    h.children[0]?.emit({ type: 'detected', score: 0.9, margin: 0 }); // a late message from the dead process
    expect(h.ctx.voice.onWake).not.toHaveBeenCalled();
  });

  it('passes a sensitivity change to the running listener without restarting it', () => {
    const h = harness();
    h.service.start();
    h.enable('medium');
    h.enable('low');
    expect(h.children).toHaveLength(1);
    expect(h.children[0]?.sent.at(-1)).toEqual({ type: 'sensitivity', sensitivity: 'low' });
  });

  it('follows the microphone chosen in Settings', () => {
    const h = harness();
    h.service.start();
    h.enable();
    h.children[0]?.emit({ type: 'ready' });
    h.ctx.settings.update({ voice: { microphoneId: 'usb-mic' } });
    expect(h.engineCommands().at(-1)).toEqual({ type: 'wake', enabled: true, deviceId: 'usb-mic' });
  });

  it('explains plainly when model files are missing and does not start', () => {
    const h = harness({ missing: ['hey_leafy.onnx'] });
    h.service.start();
    h.enable();
    expect(h.children).toHaveLength(0);
    expect(h.toasts).toEqual([{ kind: 'error', message: MISSING_FILES_MESSAGE }]);
  });

  it('says plainly when this computer cannot run it (Intel Macs) and does not start', () => {
    const h = harness({ supported: false });
    h.service.start();
    h.enable();
    expect(h.children).toHaveLength(0);
    expect(h.toasts).toEqual([{ kind: 'error', message: UNSUPPORTED_MESSAGE }]);
  });

  it('stops and tells the user when the models cannot load', () => {
    const h = harness();
    h.service.start();
    h.enable();
    h.children[0]?.emit({ type: 'error', message: 'Bad file.', fatal: true });
    expect(h.children[0]?.killed).toBe(true);
    expect(h.toasts[0]?.message).toMatch(/Hey Leafy” stopped\. Bad file\./);
  });

  it('restarts after a crash, but gives up after repeated crashes', () => {
    // Arrange
    const h = harness();
    h.service.start();
    h.enable();

    // Act: crash MAX_RESTARTS times; each is restarted after RESTART_DELAY_MS
    for (let i = 0; i < MAX_RESTARTS; i += 1) {
      h.children.at(-1)?.exit(9);
      h.tick(RESTART_DELAY_MS);
      h.runTimers();
    }
    h.children.at(-1)?.exit(9);
    h.runTimers();

    // Assert
    expect(h.children).toHaveLength(MAX_RESTARTS + 1);
    expect(h.toasts.at(-1)?.message).toBe(GAVE_UP_MESSAGE);
  });

  it('does not restart a listener that exits after being turned off', () => {
    const h = harness();
    h.service.start();
    h.enable();
    const first = h.children[0];
    h.disable();
    first?.exit(0);
    h.runTimers();
    expect(h.children).toHaveLength(1);
  });

  it('stops everything on shutdown', () => {
    const h = harness();
    h.service.start();
    h.enable();
    h.service.stop();
    expect(h.children[0]?.killed).toBe(true);
    h.enable(); // settings changes after shutdown are ignored
    expect(h.children).toHaveLength(1);
  });
});

describe('wake word model files', () => {
  it('lives in resources/wake-word in development and Resources/wake-word when packaged', () => {
    expect(wakeModelDir('/app', false)).toBe('/app/resources/wake-word');
    expect(wakeModelDir('/Resources', true)).toBe('/Resources/wake-word');
  });

  it('lists the files that are missing', () => {
    const present = new Set([`/m/${MODEL_FILES.classifier}`]);
    expect(missingModelFiles('/m', (p) => present.has(p))).not.toContain(MODEL_FILES.classifier);
    expect(missingModelFiles('/m', () => true)).toEqual([]);
  });
});

// ── Inside the utility process ───────────────────────────────────────────────
function fakeModels(scores: readonly number[]): LoadedModels {
  let n = 0;
  return {
    features: {
      melspectrogram: async () => new Float32Array(8 * 32),
      embed: async () => new Float32Array(96),
      classify: async () => scores[n++] ?? 0,
    },
    moonshine: {
      encode: async () => 0,
      decode: async (_h, rows) => {
        const length = rows[0]?.length ?? 0;
        const vocab = 30_000;
        const data = new Float32Array(rows.length * length * vocab);
        for (let i = 0; i < rows.length * length; i += 1) data[i * vocab + 2] = 10; // always "end of text"
        return { data, batch: rows.length, length, vocab };
      },
    },
    vocab: new Array<string>(30_000).fill('x'),
  };
}

function hostHarness(load: (dir: string) => Promise<LoadedModels>) {
  const events: WorkerEvent[] = [];
  const host = createWorkerHost({ load, emit: (e) => events.push(e) });
  const audio = (fresh = false) => host.onMessage({ type: 'audio', samples: new Int16Array(1280), fresh });
  return { host, events, audio };
}

describe('wake worker host', () => {
  it('loads the models on start and reports ready', async () => {
    const load = vi.fn(async () => fakeModels([]));
    const h = hostHarness(load);
    h.host.onMessage({ type: 'start', modelDir: '/m', sensitivity: 'medium' });
    await h.host.idle();
    expect(load).toHaveBeenCalledWith('/m');
    expect(h.events).toEqual([{ type: 'ready' }]);
  });

  it('reports a fatal error when the models cannot load', async () => {
    const h = hostHarness(async () => { throw new Error('no such file'); });
    h.host.onMessage({ type: 'start', modelDir: '/m', sensitivity: 'medium' });
    await h.host.idle();
    expect(h.events[0]).toMatchObject({ type: 'error', fatal: true });
    expect((h.events[0] as { message: string }).message).toMatch(/no such file/);
  });

  it('rejects messages it does not understand without crashing', async () => {
    const h = hostHarness(async () => fakeModels([]));
    h.host.onMessage({ type: 'audio', samples: new Int16Array(10), fresh: false });
    h.host.onMessage('hello');
    await h.host.idle();
    expect(h.events.map((e) => e.type)).toEqual(['error', 'error']);
  });

  it('runs frames through the detector and reports the outcome', async () => {
    // Arrange: the 16th frame scores high; the fake speech model hears nothing, so it is rejected
    const scores = new Array<number>(20).fill(0);
    scores[0] = 0.99;
    const h = hostHarness(async () => fakeModels(scores));
    h.host.onMessage({ type: 'start', modelDir: '/m', sensitivity: 'medium' });

    // Act
    for (let i = 0; i < 16; i += 1) h.audio(i === 0);
    await h.host.idle();

    // Assert
    expect(h.events.map((e) => e.type)).toEqual(['ready', 'rejected']);
  });

  it('drops frames instead of queueing without limit when it falls behind', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const models = fakeModels([]);
    const melspectrogram = vi.fn(async () => {
      await gate;
      return new Float32Array(8 * 32);
    });
    const h = hostHarness(async () => ({ ...models, features: { ...models.features, melspectrogram } }));
    h.host.onMessage({ type: 'start', modelDir: '/m', sensitivity: 'medium' });
    await h.host.idle();
    for (let i = 0; i < MAX_PENDING_FRAMES + 25; i += 1) h.audio();
    release();
    await h.host.idle();
    expect(melspectrogram).toHaveBeenCalledTimes(MAX_PENDING_FRAMES);
    expect(h.events.filter((e) => e.type === 'error')).toEqual([]);
  });
});
