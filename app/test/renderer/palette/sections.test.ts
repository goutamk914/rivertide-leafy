import { describe, expect, it } from 'vitest';
import type { SearchResult } from '@shared/types';
import { askIndex, groupResults, LOCAL_ASK_ID, rowHint, sectionOf } from '../../../src/renderer/palette/sections';

const result = (id: string, kind: SearchResult['kind'], score: number, title = id): SearchResult => ({
  id,
  kind,
  title,
  subtitle: null,
  icon: null,
  score,
});

describe('groupResults', () => {
  it('returns nothing for an empty query and no results', () => {
    expect(groupResults([], '  ')).toEqual({ sections: [], flat: [] });
  });

  it('lifts the best non-ask result into Top hit and removes it from its section', () => {
    // Arrange
    const results = [result('cal', 'app', 0.9, 'Calendar'), result('calc', 'app', 0.5, 'Calculator'), result('f1', 'file', 0.95, 'calendar.pdf')];

    // Act
    const grouped = groupResults(results, 'cal');

    // Assert
    expect(grouped.sections.map((s) => s.id)).toEqual(['top', 'apps', 'ask']);
    expect(grouped.sections[0].items[0].id).toBe('f1');
    expect(grouped.sections[1].items.map((r) => r.id)).toEqual(['cal', 'calc']);
  });

  it('adds a local Ask Leafy row when main sent none', () => {
    const grouped = groupResults([result('cal', 'app', 0.9)], 'what is on today');
    const ask = grouped.flat[askIndex(grouped.flat)];

    expect(ask.id).toBe(LOCAL_ASK_ID);
    expect(ask.title).toBe('“what is on today”');
  });

  it('keeps main’s own Ask row instead of adding one', () => {
    const grouped = groupResults([result('ask-1', 'ask', 0)], 'hello');

    expect(grouped.flat.map((r) => r.id)).toEqual(['ask-1']);
  });

  it('orders sections, sorts by score, de-duplicates and caps each section', () => {
    const files = Array.from({ length: 9 }, (_, i) => result(`f${i}`, 'file', i / 10));
    const results = [result('w', 'web', 1), result('n', 'note', 0.2), result('h', 'history', 0.3), ...files, result('f8', 'file', 0)];

    const grouped = groupResults(results, 'f');

    expect(grouped.sections.map((s) => s.id)).toEqual(['top', 'files', 'knowledge', 'history', 'ask', 'web']);
    expect(grouped.sections[0].items[0].id).toBe('f8');
    expect(grouped.sections[1].items).toHaveLength(6);
    expect(grouped.sections[1].items[0].id).toBe('f7');
  });

  it('records each section’s offset in the flat list', () => {
    const grouped = groupResults([result('a', 'app', 0.9), result('b', 'app', 0.8), result('c', 'command', 0.1)], 'x');

    grouped.sections.forEach((section) => {
      expect(grouped.flat[section.start]).toBe(section.items[0]);
    });
  });
});

describe('sectionOf and rowHint', () => {
  it('maps kinds to sections', () => {
    expect(sectionOf('setting')).toBe('commands');
    expect(sectionOf('reminder')).toBe('knowledge');
    expect(sectionOf('document')).toBe('documents');
  });

  it('offers Reveal only for things in Finder', () => {
    expect(rowHint(result('a', 'app', 1))).toEqual({ primary: 'Open', alt: null });
    expect(rowHint(result('f', 'file', 1))).toEqual({ primary: 'Open', alt: 'Reveal' });
    expect(rowHint(result('c', 'command', 1)).primary).toBe('Run');
    expect(rowHint(result('q', 'ask', 1)).primary).toBe('Ask');
  });

  it('finds no Ask row in an empty list', () => {
    expect(askIndex([])).toBe(-1);
  });
});
