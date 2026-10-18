/**
 * Pure helpers for the Facts tab: human category names, grouping, and the add/edit form rules.
 * Limits mirror the `knowledge:upsert` schema in the IPC contract.
 */
import { FACT_CATEGORIES, type Fact, type FactCategory, type FactSource } from '@shared/types';

export const KNOWLEDGE_TABS = ['facts', 'graph', 'dictionary'] as const;
export type KnowledgeTab = (typeof KNOWLEDGE_TABS)[number];

/** `/knowledge/<section>` → tab; anything unknown (or no section) opens Facts. */
export function tabFromSection(section: string | null | undefined): KnowledgeTab {
  return KNOWLEDGE_TABS.find((tab) => tab === section) ?? 'facts';
}

export const FACT_LABEL_MAX = 80;
export const FACT_VALUE_MAX = 1000;

export const CATEGORY_NAMES: Readonly<Record<FactCategory, string>> = {
  symptom: 'Symptoms',
  medication: 'Medicines',
  diagnosis: 'Diagnosis',
  treatment: 'Treatment',
  appointment: 'Appointments',
  'care-team': 'Care team',
  goal: 'Goals',
  feeling: 'Feelings',
  preference: 'Preferences',
  person: 'People',
  other: 'Other',
};

export const SOURCE_NAMES: Readonly<Record<FactSource, string>> = {
  dictation: 'Heard in dictation',
  chat: 'From a chat',
  manual: 'Added by you',
  onboarding: 'From setup',
  agent: 'Saved by Leafy',
};

export const CATEGORY_OPTIONS = FACT_CATEGORIES.map((value) => ({ value, label: CATEGORY_NAMES[value] }));

export function isFactCategory(value: string | null | undefined): value is FactCategory {
  return (FACT_CATEGORIES as readonly string[]).includes(value ?? '');
}

export interface FactGroup {
  readonly category: FactCategory;
  readonly name: string;
  readonly facts: readonly Fact[];
}

/** Groups facts by category in FACT_CATEGORIES order, pinned first within each group, empty groups dropped. */
export function groupFacts(facts: readonly Fact[]): FactGroup[] {
  return FACT_CATEGORIES.map((category) => ({
    category,
    name: CATEGORY_NAMES[category],
    facts: facts.filter((fact) => fact.category === category).sort((a, b) => Number(b.pinned) - Number(a.pinned)),
  })).filter((group) => group.facts.length > 0);
}

export interface FactDraft {
  readonly category: FactCategory;
  readonly label: string;
  readonly value: string;
  readonly pinned: boolean;
}

export type FactField = 'label' | 'value';
export type FactErrors = Partial<Record<FactField, string>>;

export function draftFromFact(fact: Fact | null): FactDraft {
  if (!fact) return { category: 'other', label: '', value: '', pinned: false };
  return { category: fact.category, label: fact.label, value: fact.value, pinned: fact.pinned };
}

function lengthError(text: string, max: number, empty: string, tooLong: string): string | undefined {
  const length = text.trim().length;
  if (length === 0) return empty;
  if (length > max) return tooLong;
  return undefined;
}

/** Inline error messages for the fact form; an empty object means it can be saved. */
export function validateFactDraft(draft: FactDraft): FactErrors {
  const label = lengthError(draft.label, FACT_LABEL_MAX, 'Add a short label, like “Oxaliplatin”.', `Keep the label to ${FACT_LABEL_MAX} characters or fewer.`);
  const value = lengthError(draft.value, FACT_VALUE_MAX, 'Add what Leafy should remember.', 'Keep this to 1,000 characters or fewer.');
  return { ...(label ? { label } : {}), ...(value ? { value } : {}) };
}

export function hasErrors(errors: Readonly<Record<string, string | undefined>>): boolean {
  return Object.values(errors).some(Boolean);
}
