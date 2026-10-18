import { spawn, type SpawnOptions } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLineSplitter,
  NativeHelper,
  parseHelperMessage,
  type HelperCommand,
  type HelperExit,
  type HelperKeyEvent,
  type HelperLog,
  type HelperReady,
  type HelperUnavailable,
  type NativeHelperOptions,
} from '../../../src/main/os/helper';

const FAKE_HELPER = fileURLToPath(new URL('../../fixtures/fake-helper.mjs', import.meta.url));
const FAST_BACKOFF = { initialMs: 20, maxMs: 80, healthyResetMs: 60_000 };
const MISSING_BINARY = '/nonexistent/rivertide-helper';
const noop = (): void => {};

const createLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

/** Runs `command` (the fake helper script) with the current Node binary. */
const createNodeSpawn = () =>
  vi.fn((command: string, args: readonly string[], options: SpawnOptions) =>
    spawn(process.execPath, [command, ...args], options),
  );

const liveHelpers: NativeHelper[] = [];

function createHelper(overrides: Partial<NativeHelperOptions> = {}) {
  const logger = createLogger();
  const spawnImpl = createNodeSpawn();
  const helper = new NativeHelper({
    binaryPath: FAKE_HELPER,
    logger,
    spawnImpl: spawnImpl as unknown as typeof spawn,
    backoff: FAST_BACKOFF,
    ...overrides,
  });
  liveHelpers.push(helper);
  return { helper, logger, spawnImpl };
}

async function startReady(helper: NativeHelper): Promise<HelperReady> {
  const ready = once(helper, 'ready');
  helper.start();
  const [payload] = (await ready) as [HelperReady];
  return payload;
}

const crash = (helper: NativeHelper): void => {
  helper.request('__crash' as HelperCommand).catch(noop);
};

afterEach(() => {
  liveHelpers.splice(0).forEach((helper) => helper.stop());
  vi.useRealTimers();
});

describe('NativeHelper talking to the fake helper process', () => {
  it('emits ready with the protocol version and accessibility state', async () => {
    // Arrange
    const { helper } = createHelper();

    // Act
    const ready = await startReady(helper);

    // Assert
    expect(ready).toEqual({ version: 1, accessibility: false });
    expect(helper.isRunning).toBe(true);
  });

  it('resolves requests with the data from the matching result line', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);

    // Act
    const [pong, app, focused, access] = await Promise.all([
      helper.ping(),
      helper.frontmostApp(),
      helper.focusedText(),
      helper.checkAccess(),
    ]);

    // Assert
    expect(pong).toEqual({ pong: true });
    expect(app).toEqual({ name: 'Notes', bundleId: 'com.apple.Notes', pid: 4242 });
    expect(focused).toEqual({ role: 'AXTextArea', value: 'hello', selectedText: '' });
    expect(access).toEqual({ accessibility: false });
  });

  it('rejects with the helper message when the helper replies with an error', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);

    // Act
    const unknown = helper.request('nope' as HelperCommand);
    const paste = helper.paste('com.apple.Notes');

    // Assert
    await expect(unknown).rejects.toThrow('unknown command: nope');
    await expect(paste).rejects.toThrow('accessibility-missing');
  });

  it('rejects a request that gets no reply within the timeout', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);

    // Act
    const silent = helper.request('__silent' as HelperCommand, {}, 50);

    // Assert
    await expect(silent).rejects.toThrow(/timed out after 50 ms/);
    await expect(helper.ping()).resolves.toEqual({ pong: true });
  });

  it('rejects a typed request whose payload has the wrong shape', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);

    await helper.request('__breakShapes' as HelperCommand);

    // Act
    const app = helper.frontmostApp();

    // Assert
    await expect(app).rejects.toThrow('native helper sent an unexpected payload for "frontmostApp"');
  });

  it('emits fn key events with the modifier state', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);
    const key = once(helper, 'key');

    // Act
    await helper.request('__emitKey' as HelperCommand, { down: true });
    const [event] = (await key) as [HelperKeyEvent];

    // Assert
    expect(event).toEqual({
      key: 'fn',
      down: true,
      mods: { ctrl: true, shift: false, alt: false, cmd: false },
      t: 123456,
    });
  });

  it('reassembles a protocol line split across two stdout chunks', async () => {
    // Arrange
    const { helper, logger } = createHelper();
    await startReady(helper);
    const key = once(helper, 'key');

    // Act
    await helper.request('__split' as HelperCommand);
    const [event] = (await key) as [HelperKeyEvent];

    // Assert
    expect(event.down).toBe(true);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('decodes a multi-byte character split across stdout chunks', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);
    const log = once(helper, 'log');

    // Act
    await helper.request('__splitUnicode' as HelperCommand);
    const [entry] = (await log) as [HelperLog];

    // Assert
    expect(entry).toEqual({ level: 'info', message: 'globe \u{1F310} key' });
  });

  it('logs and skips malformed output lines, then keeps answering', async () => {
    // Arrange
    const { helper, logger } = createHelper();
    await startReady(helper);

    // Act
    await helper.request('__garbage' as HelperCommand);
    const pong = await helper.ping();

    // Assert
    expect(pong).toEqual({ pong: true });
    expect(logger.warn).toHaveBeenCalledWith('ignoring unparseable native helper output', {
      line: 'this is not json',
    });
    expect(logger.warn).toHaveBeenCalledWith('ignoring unparseable native helper output', {
      line: '{"type":"mystery"}',
    });
  });

  it('rejects pending requests when the helper exits', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);
    const pending = helper.request('__silent' as HelperCommand, {}, 5000);

    // Act
    crash(helper);

    // Assert
    await expect(pending).rejects.toThrow(/native helper exited \(code 1/);
  });

  it('restarts after a crash with exponential backoff', async () => {
    // Arrange
    const { helper, spawnImpl } = createHelper();
    await startReady(helper);

    // Act
    const firstExit = once(helper, 'exit');
    const firstRestart = once(helper, 'ready');
    crash(helper);
    const [exit1] = (await firstExit) as [HelperExit];
    await firstRestart;
    const secondExit = once(helper, 'exit');
    const secondRestart = once(helper, 'ready');
    crash(helper);
    const [exit2] = (await secondExit) as [HelperExit];
    await secondRestart;

    // Assert
    expect(exit1).toEqual({ code: 1, signal: null, restartInMs: 20 });
    expect(exit2).toEqual({ code: 1, signal: null, restartInMs: 40 });
    expect(spawnImpl).toHaveBeenCalledTimes(3);
    await expect(helper.ping()).resolves.toEqual({ pong: true });
  });

  it('emits unavailable without throwing when the binary does not exist', async () => {
    // Arrange
    const spawnImpl = vi.fn(spawn);
    const { helper, logger } = createHelper({
      binaryPath: MISSING_BINARY,
      spawnImpl: spawnImpl as unknown as typeof spawn,
    });
    const unavailable = once(helper, 'unavailable');

    // Act
    expect(() => helper.start()).not.toThrow();
    const [payload] = (await unavailable) as [HelperUnavailable];
    await delay(FAST_BACKOFF.initialMs * 5);

    // Assert
    expect(payload.code).toBe('ENOENT');
    expect(helper.isRunning).toBe(false);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('native helper unavailable', expect.objectContaining({ binaryPath: MISSING_BINARY }));
  });

  it('stop() rejects pending requests and prevents a restart', async () => {
    // Arrange
    const { helper, spawnImpl } = createHelper();
    await startReady(helper);
    const pending = helper.request('__silent' as HelperCommand, {}, 5000);
    const exit = once(helper, 'exit');

    // Act
    helper.stop();
    const outcome = await pending.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    const [exitEvent] = (await exit) as [HelperExit];
    await delay(FAST_BACKOFF.initialMs * 5);

    // Assert
    expect(outcome).toMatch(/native helper stopped/);
    expect(exitEvent.restartInMs).toBeNull();
    expect(helper.isRunning).toBe(false);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects requests while the helper is not running', async () => {
    // Arrange
    const { helper } = createHelper();

    // Act
    const result = helper.ping();

    // Assert
    await expect(result).rejects.toThrow(/not running/);
  });

  it('rejects an unknown media key before contacting the helper', async () => {
    // Arrange
    const { helper } = createHelper();
    await startReady(helper);

    // Act
    const result = helper.mediaKey('rewind' as never);

    // Assert
    await expect(result).rejects.toThrow('unknown media key: rewind');
  });
});

/** Minimal stand-in for a spawned child process, driven by the test. */
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  readonly kill = vi.fn(() => true);
}

function createFakeChildHelper() {
  const children: FakeChild[] = [];
  const spawnImpl = vi.fn(() => {
    const child = new FakeChild();
    children.push(child);
    return child;
  });
  const helper = new NativeHelper({
    binaryPath: '/fake/rivertide-helper',
    logger: createLogger(),
    spawnImpl: spawnImpl as unknown as typeof spawn,
  });
  liveHelpers.push(helper);
  const restartDelays: (number | null)[] = [];
  helper.on('exit', (event) => restartDelays.push(event.restartInMs));
  const latestChild = (): FakeChild | undefined => children[children.length - 1];
  const crashLatest = (): void => {
    latestChild()?.emit('exit', 1, null);
  };
  return { helper, spawnImpl, restartDelays, crashLatest, latestChild };
}

describe('NativeHelper restart backoff (fake child, fake timers)', () => {
  it('doubles the restart delay after each crash up to the 30 s cap', () => {
    // Arrange
    vi.useFakeTimers();
    const { helper, spawnImpl, restartDelays, crashLatest } = createFakeChildHelper();
    helper.start();

    // Act
    for (let crashes = 0; crashes < 7; crashes += 1) {
      crashLatest();
      vi.advanceTimersByTime(restartDelays[restartDelays.length - 1] ?? 0);
    }

    // Assert
    expect(restartDelays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
    expect(spawnImpl).toHaveBeenCalledTimes(8);
  });

  it('resets the backoff after 60 s of healthy uptime', () => {
    // Arrange
    vi.useFakeTimers();
    const { helper, restartDelays, crashLatest } = createFakeChildHelper();
    helper.start();
    crashLatest();
    vi.advanceTimersByTime(1000);
    crashLatest();
    vi.advanceTimersByTime(2000);

    // Act
    vi.advanceTimersByTime(60_000);
    crashLatest();

    // Assert
    expect(restartDelays).toEqual([1000, 2000, 1000]);
  });

  it('does not restart when the exit arrives after stop()', () => {
    // Arrange
    vi.useFakeTimers();
    const { helper, spawnImpl, restartDelays, crashLatest } = createFakeChildHelper();
    helper.start();

    // Act
    helper.stop();
    crashLatest();
    vi.advanceTimersByTime(60_000);

    // Assert
    expect(restartDelays).toEqual([null]);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps parsing output when a listener throws', async () => {
    // Arrange
    const { helper, latestChild } = createFakeChildHelper();
    helper.on('key', () => {
      throw new Error('listener bug');
    });
    helper.start();
    const log = once(helper, 'log');
    const stdout = latestChild()?.stdout;

    // Act
    stdout?.write('{"type":"key","key":"fn","down":true,"mods":{"ctrl":false,"shift":false,"alt":false,"cmd":false},"t":1}\n');
    stdout?.write('{"type":"log","level":"warn","message":"event tap re-enabled after timeout"}\n');
    const [entry] = (await log) as [HelperLog];

    // Assert
    expect(entry).toEqual({ level: 'warn', message: 'event tap re-enabled after timeout' });
  });
});

describe('parseHelperMessage', () => {
  it('parses every helper-to-app message from the protocol', () => {
    // Arrange
    const lines = [
      '{"type":"ready","version":1,"accessibility":true}',
      '{"type":"key","key":"fn","down":true,"mods":{"ctrl":false,"shift":false,"alt":false,"cmd":false},"t":123456}',
      '{"type":"result","id":"7","ok":true,"data":{}}',
      '{"type":"error","id":"7","message":"..."}',
      '{"type":"error","message":"malformed JSON line"}',
      '{"type":"log","level":"warn","message":"event tap re-enabled after timeout"}',
    ];

    // Act
    const parsed = lines.map(parseHelperMessage);

    // Assert
    expect(parsed.map((message) => message?.type)).toEqual(['ready', 'key', 'result', 'error', 'error', 'log']);
    expect(parsed[3]).toEqual({ type: 'error', id: '7', message: '...' });
    expect(parsed[4]).toEqual({ type: 'error', message: 'malformed JSON line' });
  });

  it.each([
    ['not json', 'oops'],
    ['an array', '[1,2]'],
    ['an unknown type', '{"type":"mystery"}'],
    ['a key event with missing mods', '{"type":"key","key":"fn","down":true,"t":1}'],
    ['a non-fn key', '{"type":"key","key":"a","down":true,"mods":{"ctrl":false,"shift":false,"alt":false,"cmd":false},"t":1}'],
    ['a result without an id', '{"type":"result","ok":true,"data":{}}'],
    ['a ready without version', '{"type":"ready","accessibility":true}'],
  ])('returns null for %s', (_label, line) => {
    // Act
    const parsed = parseHelperMessage(line);

    // Assert
    expect(parsed).toBeNull();
  });
});

describe('createLineSplitter', () => {
  it('emits complete lines and carries partial lines across chunks', () => {
    // Arrange
    const lines: string[] = [];
    const split = createLineSplitter((line) => lines.push(line), noop);

    // Act
    split('{"a":');
    split('1}\n{"b"');
    split(':2}\n');

    // Assert
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('drops a partial line that exceeds the size limit and reports it', () => {
    // Arrange
    const lines: string[] = [];
    const onOverflow = vi.fn();
    const split = createLineSplitter((line) => lines.push(line), onOverflow, 8);

    // Act
    split('0123456789');
    split('ok\n');

    // Assert
    expect(onOverflow).toHaveBeenCalledWith(10);
    expect(lines).toEqual(['ok']);
  });
});
