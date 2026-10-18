import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_CHECK_DELAY_MS, UPDATE_CHECK_INTERVAL_MS, UPDATE_NOTIFICATION, startAutoUpdates, type UpdaterLike,
} from '../../../src/main/updater';
import { memoryLogger } from './fakes';

type Listener = (...args: never[]) => void;

function fakeUpdater(check: () => Promise<unknown> = async () => null) {
  const listeners = new Map<string, Listener>();
  const updater: UpdaterLike & { emit(event: string, ...args: unknown[]): void } = {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdatesAndNotify: vi.fn(check),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
      return updater;
    }) as UpdaterLike['on'],
    emit: (event, ...args) => (listeners.get(event) as ((...a: unknown[]) => void) | undefined)?.(...args),
  };
  return updater;
}

function setup(isPackaged = true, check?: () => Promise<unknown>) {
  const updater = fakeUpdater(check);
  const logger = memoryLogger();
  const loadUpdater = vi.fn(async () => updater);
  const stop = startAutoUpdates({ isPackaged, logger, loadUpdater });
  return { updater, logger, loadUpdater, stop };
}

describe('auto updates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never loads electron-updater in development', async () => {
    // Arrange
    const { loadUpdater, logger } = setup(false);

    // Act
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);

    // Assert
    expect(loadUpdater).not.toHaveBeenCalled();
    expect(logger.entries.map((entry) => entry.message)).toContain('updates are off for unpackaged builds');
  });

  it('checks once after startup settles, then on every interval', async () => {
    // Arrange
    const { updater } = setup();

    // Act
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS - 1);
    const beforeDelay = vi.mocked(updater.checkForUpdatesAndNotify).mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);

    // Assert
    expect(beforeDelay).toBe(0);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledWith(UPDATE_NOTIFICATION);
  });

  it('downloads in the background, installs on quit and writes to the Rivertide log', async () => {
    // Arrange
    const { updater, logger, loadUpdater } = setup();

    // Act
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS + UPDATE_CHECK_INTERVAL_MS);
    updater.logger?.info('Checking for update');

    // Assert
    expect(loadUpdater).toHaveBeenCalledTimes(1);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(logger.entries).toContainEqual(expect.objectContaining({ level: 'info', scope: 'electron-updater', message: 'Checking for update' }));
  });

  it('logs a failed check and still checks again later', async () => {
    // Arrange
    const { updater, logger, loadUpdater } = setup(true, async () => {
      throw new Error('offline');
    });

    // Act
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS + UPDATE_CHECK_INTERVAL_MS);

    // Assert
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(2);
    expect(loadUpdater).toHaveBeenCalledTimes(1);
    expect(updater.on).toHaveBeenCalledTimes(2);
    expect(logger.entries.filter((entry) => entry.message === 'update check failed')).toHaveLength(2);
  });

  it('logs updater errors (such as a signature mismatch) instead of crashing', async () => {
    // Arrange
    const { updater, logger } = setup();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);

    // Act
    updater.emit('error', new Error('Code signature did not pass validation'));
    updater.emit('update-downloaded', { version: '2.0.1' });

    // Assert
    expect(logger.entries).toContainEqual(expect.objectContaining({ level: 'warn', message: 'updater error' }));
    expect(logger.entries).toContainEqual(expect.objectContaining({ level: 'info', message: 'update downloaded', meta: { version: '2.0.1' } }));
  });

  it('logs when electron-updater cannot be loaded', async () => {
    // Arrange
    const logger = memoryLogger();
    const loadUpdater = vi.fn(async (): Promise<UpdaterLike> => {
      throw new Error('missing app-update.yml');
    });
    startAutoUpdates({ isPackaged: true, logger, loadUpdater });

    // Act
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);

    // Assert
    expect(logger.entries).toContainEqual(expect.objectContaining({ level: 'warn', message: 'update check failed' }));
  });

  it('stops checking once an update is downloaded, so the notification is not repeated', async () => {
    // Arrange
    const { updater } = setup();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS);

    // Act
    updater.emit('update-downloaded', { version: '2.0.1' });
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3);

    // Assert
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
  });

  it('stops checking once stopped', async () => {
    // Arrange
    const { updater, stop } = setup();

    // Act
    stop();
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_DELAY_MS + UPDATE_CHECK_INTERVAL_MS * 2);

    // Assert
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
  });
});
