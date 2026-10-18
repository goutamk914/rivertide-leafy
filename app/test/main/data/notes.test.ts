import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSafeId, newId } from '../../../src/main/data/ids';
import { noteTitle } from '../../../src/main/data/notes';
import { countWords, truncate } from '../../../src/main/data/store';
import { createFakeContext } from './fake-context';

afterEach(() => {
  vi.useRealTimers();
});

describe('notes service', () => {
  it('lists pinned notes first, then the most recently updated', () => {
    // Arrange
    vi.useFakeTimers();
    const { ctx } = createFakeContext();
    vi.setSystemTime(new Date('2026-10-15T10:00:00.000Z'));
    const older = ctx.notes.upsert({ title: 'Older', body: 'a' });
    vi.setSystemTime(new Date('2026-10-15T11:00:00.000Z'));
    ctx.notes.upsert({ title: 'Newer', body: 'b' });
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    ctx.notes.upsert({ title: 'Pinned', body: 'c', pinned: true });

    // Act
    vi.setSystemTime(new Date('2026-10-15T13:00:00.000Z'));
    ctx.notes.upsert({ id: older.id, title: 'Older', body: 'edited' });
    const titles = ctx.notes.list().map((note) => note.title);

    // Assert
    expect(titles).toEqual(['Pinned', 'Older', 'Newer']);
  });

  it('filters by query over title and body, case-insensitively', () => {
    // Arrange
    const { ctx } = createFakeContext();
    ctx.notes.upsert({ title: 'Questions', body: 'Ask about NEUROPATHY' });
    ctx.notes.upsert({ title: 'Groceries', body: 'milk' });

    // Act
    const found = ctx.notes.list('neuropathy');

    // Assert
    expect(found.map((note) => note.title)).toEqual(['Questions']);
  });

  it('keeps the original source and pinned state on update', () => {
    // Arrange
    const { ctx } = createFakeContext();
    const created = ctx.notes.upsert({ title: 'Voice note', body: 'x', pinned: true }, 'voice');

    // Act
    const updated = ctx.notes.upsert({ id: created.id, title: 'Voice note', body: 'y' }, 'manual');

    // Assert
    expect(updated).toMatchObject({ id: created.id, source: 'voice', pinned: true, body: 'y' });
  });

  it('creates a fresh note when the id no longer exists, so text is never lost', () => {
    // Arrange
    const { ctx } = createFakeContext();

    // Act
    const note = ctx.notes.upsert({ id: 'gone1234', title: 'Rescued', body: 'my words' });

    // Assert
    expect(note.id).not.toBe('gone1234');
    expect(ctx.notes.list()).toHaveLength(1);
  });

  it('deletes notes and announces the change', () => {
    // Arrange
    const { ctx, of } = createFakeContext();
    const note = ctx.notes.upsert({ title: 'Bye', body: '' });

    // Act
    ctx.notes.delete(note.id);
    ctx.notes.delete('unknown');

    // Assert
    expect(ctx.notes.list()).toEqual([]);
    expect(of('data:changed')).toEqual([{ domain: 'notes' }, { domain: 'notes' }]);
  });

  it('titles untitled notes from the first line of the body', () => {
    expect(noteTitle('  ', '\n\n  Call Dr. Patel about the rash\nmore')).toBe('Call Dr. Patel about the rash');
    expect(noteTitle('', '')).toBe('Untitled note');
    expect(noteTitle('Mine', 'body')).toBe('Mine');
  });
});

describe('shared helpers', () => {
  it('generates safe, unique, time-ordered ids', () => {
    const now = Date.UTC(2026, 9, 15);
    const first = newId(now);
    const second = newId(now + 1000);
    expect(isSafeId(first)).toBe(true);
    expect(first.startsWith(now.toString(36))).toBe(true);
    expect(newId(now)).not.toBe(newId(now));
    expect(first < second).toBe(true);
    expect(isSafeId('../etc/passwd')).toBe(false);
  });

  it('truncates on a word boundary with an ellipsis', () => {
    expect(truncate('one two three four five', 12)).toBe('one two…');
    expect(truncate('short', 12)).toBe('short');
  });

  it('counts unicode words', () => {
    expect(countWords("I'm taking 5 mg — naïve café")).toBe(6);
  });
});
