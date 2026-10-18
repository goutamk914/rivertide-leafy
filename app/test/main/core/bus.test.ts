import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../../../src/main/bus';

describe('event bus', () => {
  it('delivers payloads to every listener of that event only', () => {
    // Arrange
    const bus = createBus(() => undefined);
    const toast = vi.fn();
    const clap = vi.fn();
    bus.on('toast', toast);
    bus.on('clap', clap);

    // Act
    bus.emit('toast', { kind: 'info', message: 'hi' });

    // Assert
    expect(toast).toHaveBeenCalledWith({ kind: 'info', message: 'hi' });
    expect(clap).not.toHaveBeenCalled();
  });

  it('unsubscribe removes only that listener', () => {
    // Arrange
    const bus = createBus(() => undefined);
    const first = vi.fn();
    const second = vi.fn();
    const off = bus.on('clap', first);
    bus.on('clap', second);

    // Act
    off();
    bus.emit('clap', { at: 1 });

    // Assert
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('a throwing listener is reported and does not stop the others', () => {
    // Arrange
    const errors: unknown[] = [];
    const bus = createBus((_event, error) => errors.push(error));
    const after = vi.fn();
    bus.on('clap', () => {
      throw new Error('bad listener');
    });
    bus.on('clap', after);

    // Act
    bus.emit('clap', { at: 2 });

    // Assert
    expect(after).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(1);
  });

  it('reports rejected async listeners', async () => {
    // Arrange
    const onError = vi.fn();
    const bus = createBus(onError);
    bus.on('clap', async () => {
      throw new Error('async failure');
    });

    // Act
    bus.emit('clap', { at: 3 });
    await new Promise((resolve) => setImmediate(resolve));

    // Assert
    expect(onError).toHaveBeenCalledWith('clap', expect.any(Error));
  });

  it('a listener that unsubscribes during emit does not skip its neighbours', () => {
    // Arrange
    const bus = createBus(() => undefined);
    const calls: string[] = [];
    const off = bus.on('clap', () => {
      calls.push('a');
      off();
    });
    bus.on('clap', () => calls.push('b'));

    // Act
    bus.emit('clap', { at: 4 });
    bus.emit('clap', { at: 5 });

    // Assert
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});
