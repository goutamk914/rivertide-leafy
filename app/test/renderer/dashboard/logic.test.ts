import { describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage, Reminder } from '../../../src/shared/types';
import { isCalm, resolveReduceMotion } from '../../../src/renderer/dashboard/app-context';
import { sparklinePath } from '../../../src/renderer/dashboard/components/Sparkline';
import { moodForPhase, phaseLabel } from '../../../src/renderer/dashboard/hooks/useVoice';
import { diffStats, MAX_DIFF_WORDS, sideOf, wordDiff } from '../../../src/renderer/dashboard/lib/diff';
import { applyChatEvent, type StreamState } from '../../../src/renderer/dashboard/pages/chat/useChat';
import { citationHref } from '../../../src/renderer/dashboard/pages/chat/ChatThread';
import { checkDroppedFile, kindLabel, MAX_IMPORT_BYTES, safeDocumentName } from '../../../src/renderer/dashboard/pages/documents/files';
import { fogSentence } from '../../../src/renderer/dashboard/pages/home/HomeCards';
import { TIPS, tipForDay } from '../../../src/renderer/dashboard/pages/home/HomePage';
import { splitReminders } from '../../../src/renderer/dashboard/pages/notes/RemindersPanel';
import { parseTime, resolveWhen, validateReminderText } from '../../../src/renderer/dashboard/pages/notes/when';
import { NAV_ITEMS, visibleNav } from '../../../src/renderer/dashboard/shell/nav';
import { byDataId, neighbourOf } from '../../../src/renderer/dashboard/lib/focus';
import { NEW_NOTE, sessionFor } from '../../../src/renderer/dashboard/pages/notes/useNoteSession';

describe('wordDiff', () => {
  it('marks removed fillers and added punctuation-insensitively', () => {
    // Arrange
    const raw = 'um so I wanted to to say thanks';
    const output = 'I wanted to say thanks.';

    // Act
    const parts = wordDiff(raw, output);

    // Assert
    expect(sideOf(parts, 'before').filter((p) => p.kind === 'removed').map((p) => p.text.trim())).toEqual(['um so', 'to']);
    expect(sideOf(parts, 'after').every((p) => p.kind === 'same')).toBe(true);
    expect(diffStats(parts)).toEqual({ removed: 3, added: 0, kept: 5 });
  });

  it('marks added words on the output side', () => {
    const parts = wordDiff('hi jordan', 'Hi Jordan, thanks');
    expect(sideOf(parts, 'after').map((p) => p.kind)).toEqual(['same', 'added']);
    expect(sideOf(parts, 'before').map((p) => p.kind)).toEqual(['same']);
  });

  it('shows the transcript’s own words on the raw side and the output’s on the written side', () => {
    // Arrange + Act
    const parts = wordDiff('hi jordan i need to move our call', 'Hi Jordan, I need to move our call.');

    // Assert
    expect(sideOf(parts, 'before').map((p) => p.text).join('')).toBe('hi jordan i need to move our call');
    expect(sideOf(parts, 'after').map((p) => p.text).join('')).toBe('Hi Jordan, I need to move our call.');
  });

  it('handles empty sides', () => {
    expect(wordDiff('', '')).toEqual([]);
    expect(wordDiff('', 'new text')).toEqual([{ kind: 'added', text: 'new text' }]);
    expect(wordDiff('old', '')).toEqual([{ kind: 'removed', text: 'old' }]);
  });

  it('falls back to a whole replacement for very long inputs', () => {
    const long = 'word '.repeat(MAX_DIFF_WORDS + 1);
    expect(wordDiff(long, 'short').map((p) => p.kind)).toEqual(['removed', 'added']);
  });
});

describe('chat stream reducer', () => {
  const waiting: StreamState = { messageId: null, content: '', status: 'waiting', error: null, question: 'Hi?', userMessageId: 'u1' };
  const message: ChatMessage = { id: 'a1', role: 'assistant', content: 'Hello.', createdAt: '2026-10-15T15:00:00.000Z', citations: [] };

  it('appends deltas and adopts the message id', () => {
    const delta: ChatEvent = { type: 'delta', sessionId: 's', messageId: 'a1', delta: 'Hel' };
    const next = applyChatEvent(waiting, delta).stream;
    expect(next).toMatchObject({ messageId: 'a1', content: 'Hel', status: 'streaming' });
    expect(applyChatEvent(next, { ...delta, delta: 'lo' }).stream?.content).toBe('Hello');
  });

  it('ignores deltas for a different message', () => {
    const stream = { ...waiting, messageId: 'a1' };
    expect(applyChatEvent(stream, { type: 'delta', sessionId: 's', messageId: 'zz', delta: 'x' }).stream).toBe(stream);
  });

  it('finishes with the final message even without a local stream', () => {
    expect(applyChatEvent(null, { type: 'done', sessionId: 's', message })).toEqual({ stream: null, finished: message });
    expect(applyChatEvent(null, { type: 'delta', sessionId: 's', messageId: 'a1', delta: 'x' }).stream).toBeNull();
  });

  it('keeps the question for retry on error', () => {
    const next = applyChatEvent(waiting, { type: 'error', sessionId: 's', messageId: 'a1', message: 'No connection.' }).stream;
    expect(next).toMatchObject({ status: 'error', error: 'No connection.', question: 'Hi?' });
  });

  it('links citations to the right page', () => {
    expect(citationHref({ kind: 'document', id: 'd', title: '', snippet: '' })).toBe('#/documents/d');
    expect(citationHref({ kind: 'note', id: 'n', title: '', snippet: '' })).toBe('#/notes/n');
    expect(citationHref({ kind: 'history', id: 'h', title: '', snippet: '' })).toBe('#/history/h');
    expect(citationHref({ kind: 'fact', id: 'f', title: '', snippet: '' })).toBe('#/knowledge/facts');
  });
});

describe('reminder timing', () => {
  const now = new Date(2026, 9, 15, 15, 0);

  it('parses 24-hour times', () => {
    expect(parseTime('08:30')).toEqual({ hours: 8, minutes: 30 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('nope')).toBeNull();
  });

  it('uses minutes from now', () => {
    expect(resolveWhen({ kind: 'in', minutes: 15 }, now)).toEqual({ ok: true, inMinutes: 15, rolledToTomorrow: false });
    expect(resolveWhen({ kind: 'in', minutes: 0 }, now).ok).toBe(false);
  });

  it('rolls a past time to tomorrow and says so', () => {
    const later = resolveWhen({ kind: 'at', time: '20:00' }, now);
    const earlier = resolveWhen({ kind: 'at', time: '09:00' }, now);
    expect(later.ok && new Date(later.dueAt ?? '').getDate()).toBe(15);
    expect(earlier.ok && earlier.rolledToTomorrow).toBe(true);
    expect(earlier.ok && new Date(earlier.dueAt ?? '').getDate()).toBe(16);
  });

  it('schedules tomorrow at the chosen time', () => {
    const result = resolveWhen({ kind: 'tomorrow', time: '09:15' }, now);
    expect(result.ok && new Date(result.dueAt ?? '').getHours()).toBe(9);
    expect(resolveWhen({ kind: 'tomorrow', time: '' }, now)).toEqual({ ok: false, error: 'Enter a time, like 8:30 PM.' });
  });

  it('validates reminder text', () => {
    expect(validateReminderText('  ')).toMatch(/Say what/);
    expect(validateReminderText('x'.repeat(301))).toMatch(/under 300/);
    expect(validateReminderText('Tea')).toBeNull();
  });

  it('splits upcoming and past reminders', () => {
    const make = (id: string, offsetMin: number, status: Reminder['status']): Reminder => ({
      id, kind: 'reminder', text: id, dueAt: new Date(now.getTime() + offsetMin * 60_000).toISOString(), repeat: 'none', status, createdAt: now.toISOString(), firedAt: null,
    });
    const { upcoming, past } = splitReminders([make('b', 60, 'scheduled'), make('a', 5, 'scheduled'), make('c', -5, 'fired'), make('d', 30, 'cancelled')], now);
    expect(upcoming.map((r) => r.id)).toEqual(['a', 'b']);
    expect(past.map((r) => r.id)).toEqual(['d', 'c']);
  });
});

describe('dropped documents', () => {
  it('accepts text files and explains the rest', () => {
    expect(checkDroppedFile('notes.md', 100)).toEqual({ ok: true });
    expect(checkDroppedFile('data', 100, 'text/plain')).toEqual({ ok: true });
    const pdf = checkDroppedFile('scan.pdf', 100);
    expect(!pdf.ok && pdf.reason).toMatch(/Import button/);
    const image = checkDroppedFile('photo.png', 100, 'image/png');
    expect(!image.ok && image.reason).toMatch(/isn’t a text file/);
    const big = checkDroppedFile('big.txt', MAX_IMPORT_BYTES + 1);
    expect(!big.ok && big.reason).toMatch(/too large/);
  });

  it('keeps names within the limit and the extension', () => {
    expect(safeDocumentName('  ')).toBe('Untitled.txt');
    const long = `${'a'.repeat(300)}.txt`;
    expect(safeDocumentName(long).length).toBeLessThanOrEqual(160);
    expect(safeDocumentName(long).endsWith('.txt')).toBe(true);
    expect(kindLabel('csv')).toBe('Spreadsheet (CSV)');
  });
});

describe('small helpers', () => {
  it('turns calm mode on only when asked or when foggy in auto', () => {
    expect(isCalm('on', null)).toBe(true);
    expect(isCalm('auto', 'foggy')).toBe(true);
    expect(isCalm('auto', 'a-little-foggy')).toBe(false);
    expect(isCalm('off', 'foggy')).toBe(false);
    expect([resolveReduceMotion('on'), resolveReduceMotion('off'), resolveReduceMotion('system')]).toEqual([true, false, undefined]);
  });

  it('trims the sidebar to four essentials in calm mode', () => {
    expect(visibleNav(false)).toBe(NAV_ITEMS);
    expect(visibleNav(true).map((n) => n.label)).toEqual(['Today', 'History', 'Chat', 'Settings']);
  });

  it('maps voice phases to Leafy moods and words', () => {
    expect(moodForPhase('listening')).toBe('listening');
    expect(moodForPhase('transcribing')).toBe('thinking');
    expect(moodForPhase(undefined)).toBe('idle');
    expect(phaseLabel('confirming')).toBe('Waiting for your yes');
    expect(phaseLabel(undefined)).toBe('Ready');
  });

  it('draws sparklines with gaps for missing days', () => {
    expect(sparklinePath([], 100, 30, 0, 100)).toBe('');
    const path = sparklinePath([0, null, 100, 50], 100, 30, 0, 100);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.startsWith('M4.0 26.0')).toBe(true);
  });

  it('keeps the same tip all day and rotates daily', () => {
    const a = tipForDay(new Date(2026, 9, 15, 8));
    expect(tipForDay(new Date(2026, 9, 15, 22))).toBe(a);
    expect(tipForDay(new Date(2026, 9, 16, 8))).not.toBe(a);
    expect(TIPS.length).toBeGreaterThan(3);
  });

  it('describes fog gently', () => {
    expect(fogSentence('steady')).toMatch(/steady/);
    expect(fogSentence('foggy')).toMatch(/Go easy on yourself/);
  });
});

describe('focus and note-session helpers', () => {
  it('picks the next item, else the previous one', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(neighbourOf(items, 'b')?.id).toBe('c');
    expect(neighbourOf(items, 'c')?.id).toBe('b');
    expect(neighbourOf([{ id: 'a' }], 'a')).toBeNull();
    expect(neighbourOf(items, 'zz')).toBeNull();
    expect(byDataId('data-x', 'abc')).toBe('[data-x="abc"]');
  });

  it('gives every new draft its own editor key', () => {
    const first = sessionFor(NEW_NOTE);
    const second = sessionFor(NEW_NOTE);
    expect(first.mode).toBe('new');
    expect(first.key).not.toBe(second.key);
    expect(sessionFor('n1')).toEqual({ mode: 'note', key: 'note-n1', noteId: 'n1' });
    expect(sessionFor(null).mode).toBe('first');
  });
});
