import { describe, expect, it } from 'vitest';
import {
  captureAccelerator, findConflict, hotkeyStatusLine, sameAccelerator, usesOptionSpace, type KeyLike,
} from '../../../../src/renderer/dashboard/pages/settings/model/accelerator';

const key = (overrides: Partial<KeyLike>): KeyLike => ({
  key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides,
});

describe('captureAccelerator', () => {
  it('builds a CommandOrControl accelerator from Command on macOS', () => {
    // Arrange
    const event = key({ metaKey: true, shiftKey: true });

    // Act
    const result = captureAccelerator(event, 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Shift+K' });
  });

  it('maps Control to CommandOrControl on Windows and Linux', () => {
    // Arrange
    const event = key({ ctrlKey: true, altKey: true, code: 'Digit5', key: '5' });

    // Act
    const result = captureAccelerator(event, 'win32');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Alt+5' });
  });

  it('keeps Control separate from Command on macOS', () => {
    // Arrange
    const event = key({ metaKey: true, ctrlKey: true, code: 'Space', key: ' ' });

    // Act
    const result = captureAccelerator(event, 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Control+Space' });
  });

  it('uses the physical key so Option does not turn letters into symbols', () => {
    // Arrange
    const event = key({ altKey: true, metaKey: true, key: '˚', code: 'KeyK' });

    // Act
    const result = captureAccelerator(event, 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+Alt+K' });
  });

  it.each([
    ['ArrowUp', 'Up'], ['F5', 'F5'], ['Slash', '/'], ['Numpad3', 'num3'], ['NumpadAdd', 'numadd'], ['Enter', 'Enter'],
  ])('names the %s key as %s', (code, name) => {
    // Arrange
    const event = key({ metaKey: true, code, key: 'x' });

    // Act
    const result = captureAccelerator(event, 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: `CommandOrControl+${name}` });
  });

  it('falls back to the key value when the code is missing', () => {
    // Arrange
    const event = key({ metaKey: true, code: '', key: 'j' });

    // Act
    const result = captureAccelerator(event, 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: 'CommandOrControl+J' });
  });

  it('cancels on Escape and clears on Backspace or Delete', () => {
    // Arrange + Act
    const escape = captureAccelerator(key({ key: 'Escape', code: 'Escape' }), 'darwin');
    const backspace = captureAccelerator(key({ key: 'Backspace', code: 'Backspace' }), 'darwin');
    const del = captureAccelerator(key({ key: 'Delete', code: 'Delete', metaKey: true }), 'darwin');

    // Assert
    expect(escape).toEqual({ kind: 'cancel' });
    expect(backspace).toEqual({ kind: 'clear' });
    expect(del).toEqual({ kind: 'clear' });
  });

  it('lets plain Tab and Shift+Tab move focus', () => {
    // Arrange + Act
    const tab = captureAccelerator(key({ key: 'Tab', code: 'Tab' }), 'darwin');
    const shiftTab = captureAccelerator(key({ key: 'Tab', code: 'Tab', shiftKey: true }), 'darwin');
    const cmdTab = captureAccelerator(key({ key: 'Tab', code: 'Tab', ctrlKey: true }), 'darwin');

    // Assert
    expect(tab).toEqual({ kind: 'pass' });
    expect(shiftTab).toEqual({ kind: 'pass' });
    expect(cmdTab).toEqual({ kind: 'ok', accelerator: 'Control+Tab' });
  });

  it('waits while only modifiers are held', () => {
    // Arrange
    const event = key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true, metaKey: true });

    // Act
    const result = captureAccelerator(event, 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'pending', modifiers: ['CommandOrControl', 'Shift'] });
  });

  it('requires at least one modifier', () => {
    // Arrange + Act
    const result = captureAccelerator(key({}), 'darwin');

    // Assert
    expect(result.kind).toBe('invalid');
    expect(result.kind === 'invalid' && result.message).toMatch(/Command, Control, Option or Shift/);
  });

  it('names Windows modifiers in the error on other platforms', () => {
    // Arrange + Act
    const result = captureAccelerator(key({}), 'linux');

    // Assert
    expect(result.kind === 'invalid' && result.message).toMatch(/Ctrl, Alt or Shift/);
  });

  it('rejects Shift with a typing key because it would block capitals', () => {
    // Arrange + Act
    const result = captureAccelerator(key({ shiftKey: true }), 'darwin');

    // Assert
    expect(result.kind).toBe('invalid');
  });

  it('allows Shift with a function key', () => {
    // Arrange + Act
    const result = captureAccelerator(key({ shiftKey: true, code: 'F9', key: 'F9' }), 'darwin');

    // Assert
    expect(result).toEqual({ kind: 'ok', accelerator: 'Shift+F9' });
  });

  it('rejects keys that cannot be part of a shortcut', () => {
    // Arrange + Act
    const result = captureAccelerator(key({ metaKey: true, code: 'IntlRo', key: 'Dead' }), 'darwin');

    // Assert
    expect(result.kind).toBe('invalid');
  });
});

describe('accelerator comparisons', () => {
  it('treats aliases and modifier order as the same shortcut', () => {
    // Arrange + Act + Assert
    expect(sameAccelerator('CmdOrCtrl+Shift+k', 'Shift+CommandOrControl+K')).toBe(true);
    expect(sameAccelerator('Option+Space', 'Alt+Space')).toBe(true);
    expect(sameAccelerator('CommandOrControl+K', 'CommandOrControl+L')).toBe(false);
    expect(sameAccelerator('', '')).toBe(false);
  });

  it('spots Option+Space', () => {
    // Arrange + Act + Assert
    expect(usesOptionSpace('Alt+Space')).toBe(true);
    expect(usesOptionSpace('Option+Space')).toBe(true);
    expect(usesOptionSpace('CommandOrControl+Alt+Space')).toBe(false);
  });

  it('finds another action that already uses the shortcut', () => {
    // Arrange
    const current = { palette: 'CommandOrControl+Shift+Space', command: 'CommandOrControl+Shift+L', dictate: '' };

    // Act
    const clash = findConflict('CmdOrCtrl+Shift+L', 'palette', current);
    const self = findConflict('CommandOrControl+Shift+Space', 'palette', current);
    const off = findConflict('', 'command', current);

    // Assert
    expect(clash).toBe('command');
    expect(self).toBeNull();
    expect(off).toBeNull();
  });
});

describe('hotkeyStatusLine', () => {
  const statuses = [
    { action: 'palette' as const, accelerator: 'CommandOrControl+Shift+Space', registered: true },
    { action: 'command' as const, accelerator: 'Alt+Space', registered: false },
  ];

  it('says Ready when main registered the shortcut', () => {
    // Arrange + Act
    const line = hotkeyStatusLine(statuses, 'palette', 'CommandOrControl+Shift+Space');

    // Assert
    expect(line).toEqual({ tone: 'ready', text: 'Ready' });
  });

  it('explains a conflict in plain words', () => {
    // Arrange + Act
    const line = hotkeyStatusLine(statuses, 'command', 'Alt+Space');

    // Assert
    expect(line.tone).toBe('conflict');
    expect(line.text).toBe('Another app is using this shortcut. Pick a different one.');
  });

  it('reports off for an empty shortcut and checking for a stale status', () => {
    // Arrange + Act
    const off = hotkeyStatusLine(statuses, 'dictate', '');
    const stale = hotkeyStatusLine(statuses, 'palette', 'CommandOrControl+K');
    const unknown = hotkeyStatusLine(undefined, 'palette', 'CommandOrControl+K');

    // Assert
    expect(off.tone).toBe('off');
    expect(stale.tone).toBe('checking');
    expect(unknown.tone).toBe('checking');
  });
});
