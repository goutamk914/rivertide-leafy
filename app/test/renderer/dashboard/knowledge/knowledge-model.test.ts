import { describe, expect, it } from 'vitest';
import type { Fact, FactCategory } from '@shared/types';
import {
  CATEGORY_NAMES, CATEGORY_OPTIONS, FACT_LABEL_MAX, FACT_VALUE_MAX, draftFromFact, groupFacts, hasErrors,
  isFactCategory, tabFromSection, validateFactDraft,
} from '../../../../src/renderer/dashboard/pages/knowledge/knowledge-model';

function fact(id: string, category: FactCategory, pinned = false): Fact {
  return {
    id,
    category,
    label: `Label ${id}`,
    value: `Value ${id}`,
    source: 'manual',
    sourceRef: null,
    pinned,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
  };
}

describe('groupFacts', () => {
  it('groups by category in FACT_CATEGORIES order and drops empty categories', () => {
    // Arrange
    const facts = [fact('a', 'other'), fact('b', 'medication'), fact('c', 'symptom'), fact('d', 'medication')];

    // Act
    const groups = groupFacts(facts);

    // Assert
    expect(groups.map((g) => g.category)).toEqual(['symptom', 'medication', 'other']);
    expect(groups.map((g) => g.name)).toEqual(['Symptoms', 'Medicines', 'Other']);
    expect(groups[1]?.facts.map((f) => f.id)).toEqual(['b', 'd']);
  });

  it('puts pinned facts first within a group without reordering the rest', () => {
    // Arrange
    const facts = [fact('a', 'goal'), fact('b', 'goal', true), fact('c', 'goal')];

    // Act
    const [group] = groupFacts(facts);

    // Assert
    expect(group?.facts.map((f) => f.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns no groups for no facts', () => {
    // Arrange + Act + Assert
    expect(groupFacts([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    // Arrange
    const facts = [fact('a', 'goal'), fact('b', 'goal', true)];

    // Act
    groupFacts(facts);

    // Assert
    expect(facts.map((f) => f.id)).toEqual(['a', 'b']);
  });
});

describe('category names', () => {
  it('uses plain names for every category, in order', () => {
    // Arrange + Act
    const labels = CATEGORY_OPTIONS.map((o) => o.label);

    // Assert
    expect(labels).toEqual([
      'Symptoms', 'Medicines', 'Diagnosis', 'Treatment', 'Appointments', 'Care team', 'Goals', 'Feelings', 'Preferences', 'People', 'Other',
    ]);
    expect(CATEGORY_NAMES['care-team']).toBe('Care team');
  });

  it('recognises valid categories only', () => {
    // Arrange + Act + Assert
    expect(isFactCategory('care-team')).toBe(true);
    expect(isFactCategory('cars')).toBe(false);
    expect(isFactCategory(null)).toBe(false);
  });
});

describe('tabFromSection', () => {
  it('maps known sections to tabs and everything else to facts', () => {
    // Arrange + Act + Assert
    expect(tabFromSection('graph')).toBe('graph');
    expect(tabFromSection('dictionary')).toBe('dictionary');
    expect(tabFromSection('facts')).toBe('facts');
    expect(tabFromSection(null)).toBe('facts');
    expect(tabFromSection('nope')).toBe('facts');
  });
});

describe('fact drafts and validation', () => {
  it('starts a new draft empty in "other", unpinned', () => {
    // Arrange + Act
    const draft = draftFromFact(null);

    // Assert
    expect(draft).toEqual({ category: 'other', label: '', value: '', pinned: false });
  });

  it('copies an existing fact into the draft', () => {
    // Arrange
    const existing = fact('x', 'person', true);

    // Act
    const draft = draftFromFact(existing);

    // Assert
    expect(draft).toEqual({ category: 'person', label: 'Label x', value: 'Value x', pinned: true });
  });

  it('asks for a label and a value when they are blank or only spaces', () => {
    // Arrange
    const draft = { category: 'goal' as const, label: '   ', value: '', pinned: false };

    // Act
    const errors = validateFactDraft(draft);

    // Assert
    expect(errors.label).toMatch(/Add a short label/);
    expect(errors.value).toMatch(/Add what Leafy should remember/);
    expect(hasErrors(errors)).toBe(true);
  });

  it('enforces the contract length limits after trimming', () => {
    // Arrange
    const ok = { category: 'goal' as const, label: ` ${'a'.repeat(FACT_LABEL_MAX)} `, value: 'b'.repeat(FACT_VALUE_MAX), pinned: false };
    const long = { ...ok, label: 'a'.repeat(FACT_LABEL_MAX + 1), value: 'b'.repeat(FACT_VALUE_MAX + 1) };

    // Act
    const okErrors = validateFactDraft(ok);
    const longErrors = validateFactDraft(long);

    // Assert
    expect(okErrors).toEqual({});
    expect(hasErrors(okErrors)).toBe(false);
    expect(longErrors.label).toMatch(/80 characters/);
    expect(longErrors.value).toMatch(/1,000 characters/);
  });
});
