import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {} }));

import { createCommandQueue } from '../../../src/main/windows/engine';
import type { EngineCommand } from '../../../src/shared/ipc';

const cue = (name: 'start' | 'stop'): EngineCommand => ({ type: 'cue', name });

describe('engine command queue', () => {
  it('holds commands until the engine is ready, then delivers them in order', () => {
    // Arrange
    const deliver = vi.fn();
    const queue = createCommandQueue(deliver);

    // Act
    queue.send(cue('start'));
    queue.send({ type: 'clap', enabled: true, sensitivity: 'medium' });
    const deliveredBeforeReady = deliver.mock.calls.length;
    queue.markReady();

    // Assert
    expect(deliveredBeforeReady).toBe(0);
    expect(deliver.mock.calls.map(([command]) => command.type)).toEqual(['cue', 'clap']);
    expect(queue.size()).toBe(0);
  });

  it('delivers immediately once ready and queues again after a reset (reload)', () => {
    // Arrange
    const deliver = vi.fn();
    const queue = createCommandQueue(deliver);
    queue.markReady();

    // Act
    queue.send(cue('start'));
    queue.reset();
    queue.send(cue('stop'));

    // Assert
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(queue.isReady()).toBe(false);
    expect(queue.size()).toBe(1);
  });

  it('drops the oldest commands beyond the limit', () => {
    // Arrange
    const deliver = vi.fn();
    const queue = createCommandQueue(deliver, 2);

    // Act
    queue.send({ type: 'activity', userActive: true });
    queue.send(cue('start'));
    queue.send(cue('stop'));
    queue.markReady();

    // Assert
    expect(deliver.mock.calls.map(([command]) => command.type)).toEqual(['cue', 'cue']);
  });
});
