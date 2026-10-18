import { describe, expect, it } from 'vitest';
import type { DictionaryEntry } from '@shared/types';
import {
  NOTE_MAX, REPLACES_LIMIT, REPLACE_MAX, TERM_MAX, draftFromEntry, parseReplaces, validateDictionaryDraft,
} from '../../../../src/renderer/dashboard/pages/knowledge/dictionary-model';

describe('parseReplaces', () => {
  it('splits on commas and new lines, trims and collapses spaces', () => {
    // Arrange + Act
    const parts = parseReplaces(' ox ally platin ,oxally   platin\ndr alice ');

    // Assert
    expect(parts).toEqual(['ox ally platin', 'oxally platin', 'dr alice']);
  });

  it('drops blanks and case-insensitive duplicates, keeping the first spelling', () => {
    // Arrange + Act
    const parts = parseReplaces('Pria, , pria, PRIA, preya,');

    // Assert
    expect(parts).toEqual(['Pria', 'preya']);
  });

  it('returns nothing for an empty string', () => {
    // Arrange + Act + Assert
    expect(parseReplaces('')).toEqual([]);
  });
});

describe('draftFromEntry', () => {
  it('starts empty for a new word', () => {
    // Arrange + Act + Assert
    expect(draftFromEntry(null)).toEqual({ term: '', replaces: '', note: '' });
  });

  it('joins existing mishearings with commas', () => {
    // Arrange
    const entry: DictionaryEntry = {
      id: 'd1', term: 'Oxaliplatin', replaces: ['ox ally platin', 'oxally platin'], note: 'Chemo', source: 'manual', uses: 3, createdAt: '2026-10-01T00:00:00.000Z',
    };

    // Act
    const draft = draftFromEntry(entry);

    // Assert
    expect(draft).toEqual({ term: 'Oxaliplatin', replaces: 'ox ally platin, oxally platin', note: 'Chemo' });
  });
});

describe('validateDictionaryDraft', () => {
  it('accepts a word with no mishearings and no note', () => {
    // Arrange + Act + Assert
    expect(validateDictionaryDraft({ term: 'Priya', replaces: '', note: '' })).toEqual({});
  });

  it('asks for the word when it is blank', () => {
    // Arrange + Act
    const errors = validateDictionaryDraft({ term: '  ', replaces: '', note: '' });

    // Assert
    expect(errors.term).toMatch(/Add the word/);
  });

  it('limits the word, each mishearing, their count and the note', () => {
    // Arrange
    const tooMany = Array.from({ length: REPLACES_LIMIT + 2 }, (_, i) => `word ${i}`).join(', ');

    // Act
    const longTerm = validateDictionaryDraft({ term: 'a'.repeat(TERM_MAX + 1), replaces: '', note: '' });
    const longPart = validateDictionaryDraft({ term: 'ok', replaces: `fine, ${'b'.repeat(REPLACE_MAX + 1)}`, note: '' });
    const many = validateDictionaryDraft({ term: 'ok', replaces: tooMany, note: '' });
    const longNote = validateDictionaryDraft({ term: 'ok', replaces: '', note: 'c'.repeat(NOTE_MAX + 1) });

    // Assert
    expect(longTerm.term).toMatch(/80 characters/);
    expect(longPart.replaces).toMatch(/too long/);
    expect(many.replaces).toMatch(/Add up to 20 mishearings\. Remove 2 to save\./);
    expect(longNote.note).toMatch(/200 characters/);
  });
});
