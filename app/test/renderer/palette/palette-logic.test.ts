import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { emptyRun, EMPTY_RUN_BOOK, recordAgentEvent } from '../../../src/renderer/lib/hooks/agentRun';
import { shortcutHints } from '../../../src/renderer/palette/EmptyState';
import { paletteMood, runMood } from '../../../src/renderer/palette/paletteMood';
import { isSafeDataImage, resolveResultIcon } from '../../../src/renderer/palette/resultIcon';
import { findVoiceRun } from '../../../src/renderer/palette/usePaletteAgent';
import { PALETTE_GUTTER, windowHeightFor } from '../../../src/renderer/palette/usePaletteResize';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('resolveResultIcon', () => {
  it('accepts base64 image data URLs', () => {
    expect(resolveResultIcon(PNG, 'app')).toEqual({ type: 'image', src: PNG });
  });

  it('rejects anything that is not a plain base64 image', () => {
    expect(isSafeDataImage('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeDataImage('data:image/png,<svg onload=alert(1)>')).toBe(false);
    expect(resolveResultIcon('https://example.com/x.png', 'file')).toEqual({ type: 'icon', name: 'file' });
  });

  it('maps icon:<lucide-name> and falls back to the kind icon', () => {
    expect(resolveResultIcon('icon:calendar', 'command')).toEqual({ type: 'icon', name: 'calendar' });
    expect(resolveResultIcon('icon:unknown-glyph', 'note')).toEqual({ type: 'icon', name: 'sticky-note' });
    expect(resolveResultIcon(null, 'web')).toEqual({ type: 'icon', name: 'globe' });
  });
});

describe('paletteMood', () => {
  it('reads while you type and rests when empty', () => {
    expect(paletteMood({ view: 'search', query: 'cal', phase: 'idle', run: null, waiting: false })).toBe('searching');
    expect(paletteMood({ view: 'search', query: ' ', phase: 'idle', run: null, waiting: false })).toBe('idle');
  });

  it('follows the run in Ask', () => {
    const running = emptyRun('r');
    expect(runMood(null, true)).toBe('thinking');
    expect(runMood(null, false)).toBe('idle');
    expect(runMood(running, false)).toBe('thinking');
    expect(runMood({ ...running, text: 'Hi' }, false)).toBe('speaking');
    expect(runMood({ ...running, steps: [{ callId: 'c', tool: 'search_files', title: 'Searching', status: 'running', summary: null }] }, false)).toBe('searching');
    expect(runMood({ ...running, confirmation: { runId: 'r', callId: 'c', tool: 't', title: 'T', summary: 'S' } }, false)).toBe('confirm');
    expect(runMood({ ...running, status: 'done' }, false)).toBe('success');
    expect(runMood({ ...running, status: 'failed' }, false)).toBe('error');
  });

  it('listens with the voice session', () => {
    expect(paletteMood({ view: 'voice', query: '', phase: 'listening', run: null, waiting: false })).toBe('listening');
    expect(paletteMood({ view: 'voice', query: '', phase: 'acting', run: null, waiting: false })).toBe('working');
    expect(paletteMood({ view: 'voice', query: '', phase: 'idle', run: null, waiting: false })).toBe('idle');
    expect(paletteMood({ view: 'ask', query: '', phase: 'idle', run: null, waiting: true })).toBe('thinking');
  });
});

describe('findVoiceRun', () => {
  it('finds the newest voice run that started after listening began', () => {
    const book = [
      { type: 'run-start', runId: 'old', input: 'a', source: 'voice' },
      { type: 'run-start', runId: 'p', input: 'b', source: 'palette' },
      { type: 'run-start', runId: 'new', input: 'c', source: 'voice' },
    ].reduce((b, e) => recordAgentEvent(b, e as Parameters<typeof recordAgentEvent>[1]), EMPTY_RUN_BOOK);

    expect(findVoiceRun(book, new Set(['old']))?.runId).toBe('new');
    expect(findVoiceRun(book, new Set(['old', 'p', 'new']))).toBeNull();
  });
});

describe('windowHeightFor', () => {
  it('adds the shadow gutter and clamps to what main accepts', () => {
    expect(windowHeightFor(300)).toBe(300 + PALETTE_GUTTER * 2);
    expect(windowHeightFor(10)).toBe(80);
    expect(windowHeightFor(2000)).toBe(720);
    expect(windowHeightFor(100.2)).toBe(Math.ceil(100.2 + PALETTE_GUTTER * 2));
  });
});

describe('shortcutHints', () => {
  it('shows fn shortcuts on a Mac that uses fn', () => {
    const hints = shortcutHints(DEFAULT_SETTINGS, 'darwin');

    expect(hints.map((h) => h.keys)).toEqual(['fn', '⌃ fn', '⇧ fn', '⇧⌘Space']);
  });

  it('shows hotkeys elsewhere and the clap only when it is on', () => {
    const settings = { ...DEFAULT_SETTINGS, clap: { ...DEFAULT_SETTINGS.clap, enabled: true } };

    const hints = shortcutHints(settings, 'win32');

    expect(hints.map((h) => h.label)).toEqual(['Dictate', 'Command', 'This palette', 'Call Leafy']);
    expect(hints[0].keys).toBe('Ctrl+Shift+D');
  });
});
