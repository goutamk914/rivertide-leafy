import { describe, expect, it } from 'vitest';
import {
  clampActive, commandForKey, confirmKey, handlesCommand, moveActive, resolveEscape, type KeyLike,
} from '../../../src/renderer/palette/navigation';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('commandForKey', () => {
  it('maps arrows, Enter, Tab and Esc', () => {
    expect(commandForKey(key('ArrowDown'))).toEqual({ type: 'move', delta: 1 });
    expect(commandForKey(key('ArrowUp'))).toEqual({ type: 'move', delta: -1 });
    expect(commandForKey(key('Enter'))).toEqual({ type: 'execute', alt: false });
    expect(commandForKey(key('Enter', { altKey: true }))).toEqual({ type: 'execute', alt: true });
    expect(commandForKey(key('Tab'))).toEqual({ type: 'jump-ask' });
    expect(commandForKey(key('Escape'))).toEqual({ type: 'escape' });
  });

  it('lets Shift+Tab and plain typing through', () => {
    expect(commandForKey(key('Tab', { shiftKey: true }))).toBeNull();
    expect(commandForKey(key('a'))).toBeNull();
    expect(commandForKey(key('1'))).toBeNull();
  });

  it('uses ⌘1–9 on macOS and Ctrl+1–9 elsewhere for quick picks', () => {
    expect(commandForKey(key('3', { metaKey: true }), true)).toEqual({ type: 'quick', index: 2, alt: false });
    expect(commandForKey(key('3', { ctrlKey: true }), true)).toBeNull();
    expect(commandForKey(key('9', { ctrlKey: true, altKey: true }), false)).toEqual({ type: 'quick', index: 8, alt: true });
    expect(commandForKey(key('0', { metaKey: true }), true)).toBeNull();
  });

  it('reads the physical digit so ⌥⌘3 still quick-picks on a Mac', () => {
    expect(commandForKey(key('£', { metaKey: true, altKey: true, code: 'Digit3' }), true)).toEqual({ type: 'quick', index: 2, alt: true });
  });

  it('supports Ctrl+N / Ctrl+P', () => {
    expect(commandForKey(key('n', { ctrlKey: true }))).toEqual({ type: 'move', delta: 1 });
    expect(commandForKey(key('p', { ctrlKey: true }))).toEqual({ type: 'move', delta: -1 });
  });

  it('ignores keys while an input method is composing', () => {
    expect(commandForKey(key('Enter', { isComposing: true }))).toBeNull();
  });
});

describe('handlesCommand', () => {
  const search = { view: 'search' as const, resultCount: 3, hasAskRow: true };

  it('lets Tab and arrows keep their default when the palette has nothing to do with them', () => {
    expect(handlesCommand({ type: 'jump-ask' }, { ...search, hasAskRow: false })).toBe(false);
    expect(handlesCommand({ type: 'jump-ask' }, { ...search, view: 'ask' })).toBe(false);
    expect(handlesCommand({ type: 'move', delta: 1 }, { ...search, view: 'voice' })).toBe(false);
    expect(handlesCommand({ type: 'move', delta: 1 }, { ...search, resultCount: 0 })).toBe(false);
    expect(handlesCommand({ type: 'quick', index: 0, alt: false }, { ...search, view: 'ask' })).toBe(false);
  });

  it('handles the keys it acts on', () => {
    expect(handlesCommand({ type: 'jump-ask' }, search)).toBe(true);
    expect(handlesCommand({ type: 'move', delta: -1 }, search)).toBe(true);
    expect(handlesCommand({ type: 'escape' }, { ...search, view: 'ask' })).toBe(true);
    expect(handlesCommand({ type: 'execute', alt: false }, { ...search, view: 'voice' })).toBe(true);
  });
});

describe('moveActive', () => {
  it('moves within bounds without wrapping', () => {
    expect(moveActive(0, -1, 5)).toBe(0);
    expect(moveActive(4, 1, 5)).toBe(4);
    expect(moveActive(2, 1, 5)).toBe(3);
    expect(moveActive(3, 1, 0)).toBe(0);
  });

  it('clamps a stale index when results shrink', () => {
    expect(clampActive(7, 3)).toBe(2);
  });
});

describe('resolveEscape', () => {
  it('peels back one layer at a time', () => {
    expect(resolveEscape({ view: 'ask', query: '', busy: true })).toBe('cancel-run');
    expect(resolveEscape({ view: 'ask', query: 'x', busy: false })).toBe('back-to-search');
    expect(resolveEscape({ view: 'voice', query: '', busy: true })).toBe('cancel-voice');
    expect(resolveEscape({ view: 'voice', query: '', busy: false })).toBe('back-to-search');
    expect(resolveEscape({ view: 'search', query: 'cal', busy: false })).toBe('clear');
    expect(resolveEscape({ view: 'search', query: '', busy: false })).toBe('hide');
  });
});

describe('confirmKey', () => {
  it('answers with Y / N only while the input is empty', () => {
    expect(confirmKey('y', true)).toBe(true);
    expect(confirmKey('N', true)).toBe(false);
    expect(confirmKey('y', false)).toBeNull();
    expect(confirmKey('x', true)).toBeNull();
  });
});
