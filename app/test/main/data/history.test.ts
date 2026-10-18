import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRetention, filterHistory, HISTORY_CAP } from '../../../src/main/data/history';
import { createFakeContext, makeHistoryItem } from './fake-context';

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 15, 12, minute)).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

describe('history repository', () => {
  it('lists newest first regardless of insertion order', () => {
    // Arrange
    const { ctx } = createFakeContext();
    ctx.history.add(makeHistoryItem({ id: 'old1', createdAt: at(1) }));
    ctx.history.add(makeHistoryItem({ id: 'new1', createdAt: at(5) }));
    ctx.history.add(makeHistoryItem({ id: 'mid1', createdAt: at(3) }));

    // Act
    const ids = ctx.history.list({}).map((item) => item.id);

    // Assert
    expect(ids).toEqual(['new1', 'mid1', 'old1']);
  });

  it('caps the history at 5000 items, dropping the oldest', () => {
    // Arrange
    const items = Array.from({ length: HISTORY_CAP + 3 }, (_, i) =>
      makeHistoryItem({ id: `seed${i}`, createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }));
    const { ctx } = createFakeContext({ seed: { history: { version: 1, items } } });

    // Act
    ctx.history.add(makeHistoryItem({ id: 'newest', createdAt: '2027-01-01T00:00:00.000Z' }));
    const all = ctx.history.recent(10_000);

    // Assert
    expect(all).toHaveLength(HISTORY_CAP);
    expect(all[0].id).toBe('newest');
    expect(all.some((item) => item.id === 'seed0')).toBe(false);
  });

  it('pages with a before cursor and respects the limit', () => {
    // Arrange
    const { ctx } = createFakeContext();
    for (let minute = 0; minute < 10; minute += 1) ctx.history.add(makeHistoryItem({ id: `p${minute}`, createdAt: at(minute) }));

    // Act
    const first = ctx.history.list({ limit: 4 });
    const second = ctx.history.list({ limit: 4, before: first[first.length - 1].createdAt });

    // Assert
    expect(first.map((item) => item.id)).toEqual(['p9', 'p8', 'p7', 'p6']);
    expect(second.map((item) => item.id)).toEqual(['p5', 'p4', 'p3', 'p2']);
  });

  it('filters by mode and case-insensitive text over raw and output', () => {
    // Arrange
    const { ctx } = createFakeContext();
    ctx.history.add(makeHistoryItem({ id: 'a1', mode: 'ask', raw: 'what is neutropenia', output: 'A low white count.' }));
    ctx.history.add(makeHistoryItem({ id: 'd1', mode: 'dictate', raw: 'note to self', output: 'Call the NURSE line.' }));

    // Act
    const byMode = ctx.history.list({ mode: 'ask' });
    const byOutput = ctx.history.list({ query: 'nurse' });

    // Assert
    expect(byMode.map((item) => item.id)).toEqual(['a1']);
    expect(byOutput.map((item) => item.id)).toEqual(['d1']);
  });

  it('applies retention on first access and removes expired items', () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    const items = [
      makeHistoryItem({ id: 'fresh', createdAt: '2026-10-14T12:00:00.000Z' }),
      makeHistoryItem({ id: 'stale', createdAt: '2026-09-01T12:00:00.000Z' }),
    ];
    const { ctx, of } = createFakeContext({ seed: { history: { version: 1, items } }, settings: { privacy: { retentionDays: 30 } } });

    // Act
    const ids = ctx.history.list({}).map((item) => item.id);

    // Assert
    expect(ids).toEqual(['fresh']);
    expect(of('data:changed')).toContainEqual({ domain: 'history' });
  });

  it('re-applies retention a day later', () => {
    // Arrange
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
    const { ctx } = createFakeContext({ settings: { privacy: { retentionDays: 1 } } });
    ctx.history.add(makeHistoryItem({ id: 'today', createdAt: '2026-10-15T11:00:00.000Z' }));

    // Act
    vi.setSystemTime(new Date('2026-10-17T12:00:00.000Z'));
    const ids = ctx.history.list({}).map((item) => item.id);

    // Assert
    expect(ids).toEqual([]);
  });

  it('keeps everything when retention is 0 (forever)', () => {
    expect(applyRetention([makeHistoryItem({ createdAt: '2000-01-01T00:00:00.000Z' })], 0, Date.now())).toHaveLength(1);
  });

  it('does not store new items while history is turned off', () => {
    // Arrange
    const { ctx } = createFakeContext({ settings: { privacy: { historyEnabled: false } } });

    // Act
    ctx.history.add(makeHistoryItem({ id: 'private' }));

    // Assert
    expect(ctx.history.get('private')).toBeNull();
  });

  it('updates immutably, keeps id and createdAt, and returns null for unknown ids', () => {
    // Arrange
    const { ctx } = createFakeContext();
    const original = makeHistoryItem({ id: 'u1', createdAt: at(1) });
    ctx.history.add(original);

    // Act
    const updated = ctx.history.update('u1', { output: 'Changed', pasted: false });
    const missing = ctx.history.update('nope', { output: 'x' });

    // Assert
    expect(updated).toMatchObject({ id: 'u1', createdAt: at(1), output: 'Changed', pasted: false });
    expect(original.output).not.toBe('Changed');
    expect(missing).toBeNull();
  });

  it('deletes, clears, and announces each change to the search index and renderers', () => {
    // Arrange
    const { ctx, of } = createFakeContext();
    const invalidate = vi.spyOn(ctx.search, 'invalidate');
    ctx.history.add(makeHistoryItem({ id: 'x1' }));
    ctx.history.add(makeHistoryItem({ id: 'x2', createdAt: at(30) }));

    // Act
    ctx.history.delete('x1');
    const afterDelete = ctx.history.recent(10).map((item) => item.id);
    ctx.history.clear();

    // Assert
    expect(afterDelete).toEqual(['x2']);
    expect(ctx.history.recent(10)).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith('history');
    expect(of('data:changed').length).toBeGreaterThanOrEqual(4);
  });

  it('drops invalid stored items but keeps valid ones', () => {
    // Arrange
    const items = [makeHistoryItem({ id: 'good' }), { id: 'bad', mode: 'shout' }];

    // Act
    const { ctx, logger } = createFakeContext({ seed: { history: { version: 1, items } } });
    const ids = ctx.history.recent(10).map((item) => item.id);

    // Assert
    expect(ids).toEqual(['good']);
    expect(logger.calls.warn.length).toBe(1);
  });

  it('falls back to an empty history when the stored file is not a collection', () => {
    const { ctx } = createFakeContext({ seed: { history: { items: 'nope' } } });
    expect(ctx.history.recent(10)).toEqual([]);
  });

  it('filterHistory defaults to 100 items', () => {
    const items = Array.from({ length: 150 }, () => makeHistoryItem());
    expect(filterHistory(items, {})).toHaveLength(100);
  });
});
