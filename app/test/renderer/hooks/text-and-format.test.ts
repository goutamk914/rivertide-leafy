import { describe, expect, it } from 'vitest';
import { formatAccelerator, pasteShortcut } from '../../../src/renderer/lib/hooks/accelerator';
import { clamp, collapseWhitespace, estimateLines, firstWords, headText, tailText } from '../../../src/renderer/lib/hooks/text';

describe('text helpers', () => {
  it('collapses runs of whitespace', () => {
    expect(collapseWhitespace('  open\n\n my   calendar ')).toBe('open my calendar');
  });

  it('keeps short text whole and cuts long text on a word boundary', () => {
    expect(headText('Open Calendar', 40)).toBe('Open Calendar');
    expect(headText('Remind me to call the clinic about the scan results tomorrow', 30)).toBe('Remind me to call the clinic…');
  });

  it('cuts mid-word when there is no early space', () => {
    expect(headText('Supercalifragilisticexpialidocious', 10)).toBe('Supercali…');
  });

  it('shows the end of a growing transcript with a leading ellipsis', () => {
    expect(tailText('so I was thinking we could go to the park later today', 24)).toBe('…the park later today');
    expect(tailText('short', 24)).toBe('short');
  });

  it('takes the first words', () => {
    expect(firstWords('one two three four', 2)).toBe('one two…');
    expect(firstWords('one two', 5)).toBe('one two');
  });

  it('estimates wrapped lines including explicit newlines', () => {
    expect(estimateLines('a'.repeat(120), 50)).toBe(3);
    expect(estimateLines('first\nsecond', 50)).toBe(2);
    expect(estimateLines('', 50)).toBe(1);
  });

  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe('formatAccelerator', () => {
  it('uses Apple symbols in canonical order on macOS', () => {
    expect(formatAccelerator('CommandOrControl+Shift+Space', 'darwin')).toBe('⇧⌘Space');
    expect(formatAccelerator('Shift+Alt+Control+K', 'darwin')).toBe('⌃⌥⇧K');
    expect(formatAccelerator('CmdOrCtrl+Return', 'darwin')).toBe('⌘↵');
  });

  it('spells modifiers out on Windows and Linux', () => {
    expect(formatAccelerator('CommandOrControl+Shift+L', 'win32')).toBe('Ctrl+Shift+L');
    expect(formatAccelerator('Super+Up', 'linux')).toBe('Win+↑');
  });

  it('returns an empty string for an empty accelerator', () => {
    expect(formatAccelerator('', 'darwin')).toBe('');
  });

  it('names the paste shortcut per platform', () => {
    expect(pasteShortcut('darwin')).toBe('⌘V');
    expect(pasteShortcut('win32')).toBe('Ctrl+V');
  });
});
