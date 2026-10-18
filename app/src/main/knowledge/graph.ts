/**
 * Knowledge graph: "You" → one node per category present → facts, plus fact↔fact links for
 * facts mentioned in the same dictation (co-mention) or sharing a significant term.
 * Terms shared by many facts are too common to mean anything and are ignored.
 */
import { FACT_CATEGORIES, type Fact, type FactCategory, type GraphLink, type GraphNode, type KnowledgeGraph } from '../../shared/types';
import { significantTerms } from './text';

export const SELF_NODE_ID = 'self';
export const MAX_TERM_SHARE = 8;

export const CATEGORY_LABELS: Readonly<Record<FactCategory, string>> = {
  symptom: 'Symptoms',
  medication: 'Medications',
  diagnosis: 'Diagnoses',
  treatment: 'Treatments',
  appointment: 'Appointments',
  'care-team': 'Care team',
  goal: 'Goals',
  feeling: 'Feelings',
  preference: 'Preferences',
  person: 'People',
  other: 'Other',
};

export const categoryNodeId = (category: FactCategory): string => `category:${category}`;

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

function coMentionPairs(facts: readonly Fact[]): Set<string> {
  const bySource = new Map<string, string[]>();
  for (const fact of facts) {
    if (!fact.sourceRef) continue;
    bySource.set(fact.sourceRef, [...(bySource.get(fact.sourceRef) ?? []), fact.id]);
  }
  const pairs = new Set<string>();
  for (const ids of bySource.values()) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.add(pairKey(ids[i], ids[j]));
    }
  }
  return pairs;
}

function sharedTermPairs(facts: readonly Fact[]): Set<string> {
  const byTerm = new Map<string, string[]>();
  for (const fact of facts) {
    for (const term of significantTerms(`${fact.label} ${fact.value}`)) {
      byTerm.set(term, [...(byTerm.get(term) ?? []), fact.id]);
    }
  }
  const pairs = new Set<string>();
  for (const ids of byTerm.values()) {
    if (ids.length < 2 || ids.length > MAX_TERM_SHARE) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.add(pairKey(ids[i], ids[j]));
    }
  }
  return pairs;
}

export function factLinks(facts: readonly Fact[]): GraphLink[] {
  const coMention = coMentionPairs(facts);
  const shared = sharedTermPairs(facts);
  const toLink = (key: string, kind: GraphLink['kind']): GraphLink => {
    const [source, target] = key.split('|');
    return { source, target, kind };
  };
  return [
    ...[...coMention].map((key) => toLink(key, 'co-mention')),
    ...[...shared].filter((key) => !coMention.has(key)).map((key) => toLink(key, 'shared-term')),
  ];
}

export function buildGraph(facts: readonly Fact[]): KnowledgeGraph {
  const categories = FACT_CATEGORIES.filter((category) => facts.some((fact) => fact.category === category));
  const between = factLinks(facts);
  const degree = new Map<string, number>();
  for (const link of between) {
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  const nodes: GraphNode[] = [
    { id: SELF_NODE_ID, label: 'You', kind: 'self', category: null, weight: facts.length },
    ...categories.map((category): GraphNode => ({
      id: categoryNodeId(category),
      label: CATEGORY_LABELS[category],
      kind: 'category',
      category,
      weight: facts.filter((fact) => fact.category === category).length,
    })),
    ...facts.map((fact): GraphNode => ({
      id: fact.id, label: fact.label, kind: 'fact', category: fact.category, weight: 1 + (degree.get(fact.id) ?? 0),
    })),
  ];
  const links: GraphLink[] = [
    ...categories.map((category): GraphLink => ({ source: SELF_NODE_ID, target: categoryNodeId(category), kind: 'category' })),
    ...facts.map((fact): GraphLink => ({ source: categoryNodeId(fact.category), target: fact.id, kind: 'category' })),
    ...between,
  ];
  return { nodes, links };
}
