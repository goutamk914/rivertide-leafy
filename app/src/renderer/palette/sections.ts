/**
 * Pure grouping of `palette:search` results into the sections the palette shows, plus the flat
 * order keyboard navigation walks. Always offers "Ask Leafy" for a non-empty query.
 */
import type { SearchKind, SearchResult } from '@shared/types';
import { headText } from '../lib/hooks/text';

export type SectionId = 'top' | 'apps' | 'commands' | 'files' | 'knowledge' | 'history' | 'documents' | 'ask' | 'web';

export const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  top: 'Top hit',
  apps: 'Apps',
  commands: 'Commands',
  files: 'Files',
  knowledge: 'Notes & facts',
  history: 'History',
  documents: 'Documents',
  ask: 'Ask Leafy',
  web: 'Web',
};

const SECTION_ORDER: readonly SectionId[] = ['top', 'apps', 'commands', 'files', 'knowledge', 'history', 'documents', 'ask', 'web'];

const KIND_SECTION: Readonly<Record<SearchKind, SectionId>> = {
  app: 'apps',
  command: 'commands',
  setting: 'commands',
  file: 'files',
  fact: 'knowledge',
  note: 'knowledge',
  reminder: 'knowledge',
  history: 'history',
  document: 'documents',
  ask: 'ask',
  web: 'web',
};

const SECTION_LIMIT: Readonly<Record<SectionId, number>> = {
  top: 1,
  apps: 5,
  commands: 5,
  files: 6,
  knowledge: 5,
  history: 4,
  documents: 4,
  ask: 1,
  web: 2,
};

/** Id of the "Ask Leafy" row the palette adds itself when main did not send one. */
export const LOCAL_ASK_ID = 'local:ask';

export interface PaletteSection {
  readonly id: SectionId;
  readonly title: string;
  readonly items: readonly SearchResult[];
  /** Index of the first item in the flat list. */
  readonly start: number;
}

export interface GroupedResults {
  readonly sections: readonly PaletteSection[];
  readonly flat: readonly SearchResult[];
}

export function sectionOf(kind: SearchKind): SectionId {
  return KIND_SECTION[kind];
}

export function localAskResult(query: string): SearchResult {
  return {
    id: LOCAL_ASK_ID,
    kind: 'ask',
    title: `“${headText(query, 80)}”`,
    subtitle: 'Leafy will answer, or do it for you',
    icon: 'icon:leaf',
    score: 0,
  };
}

const byScore = (a: SearchResult, b: SearchResult) => b.score - a.score;

function uniqueById(results: readonly SearchResult[]): readonly SearchResult[] {
  const byId = new Map<string, SearchResult>();
  for (const result of results) {
    if (!byId.has(result.id)) byId.set(result.id, result);
  }
  return [...byId.values()];
}

/** The best result that isn't "ask" or "web", when the query is non-empty. */
function pickTopHit(results: readonly SearchResult[]): SearchResult | null {
  const candidates = results.filter((r) => r.kind !== 'ask' && r.kind !== 'web');
  return candidates.length ? [...candidates].sort(byScore)[0] : null;
}

export function groupResults(results: readonly SearchResult[], query: string): GroupedResults {
  const trimmed = query.trim();
  const unique = uniqueById(results);
  const withAsk = trimmed && !unique.some((r) => r.kind === 'ask') ? [...unique, localAskResult(trimmed)] : unique;
  const top = trimmed ? pickTopHit(withAsk) : null;
  const rest = top ? withAsk.filter((r) => r.id !== top.id) : withAsk;

  const buckets = new Map<SectionId, SearchResult[]>(SECTION_ORDER.map((id) => [id, []]));
  if (top) buckets.set('top', [top]);
  for (const result of rest) buckets.get(sectionOf(result.kind))?.push(result);

  const sections: PaletteSection[] = [];
  let start = 0;
  for (const id of SECTION_ORDER) {
    const items = [...(buckets.get(id) ?? [])].sort(byScore).slice(0, SECTION_LIMIT[id]);
    if (items.length === 0) continue;
    sections.push({ id, title: SECTION_TITLES[id], items, start });
    start += items.length;
  }
  return { sections, flat: sections.flatMap((s) => s.items) };
}

/** Index of the first "Ask Leafy" row, or -1. */
export function askIndex(flat: readonly SearchResult[]): number {
  return flat.findIndex((r) => r.kind === 'ask');
}

export interface RowHint {
  readonly primary: string;
  readonly alt: string | null;
}

const PRIMARY_VERB: Readonly<Record<SearchKind, string>> = {
  app: 'Open',
  file: 'Open',
  command: 'Run',
  setting: 'Open',
  fact: 'View',
  note: 'Open',
  reminder: 'View',
  history: 'View',
  document: 'Open',
  web: 'Search',
  ask: 'Ask',
};

/** Right-aligned hint for a row: "Open" plus "Reveal" for things that live in Finder. */
export function rowHint(result: SearchResult): RowHint {
  return { primary: PRIMARY_VERB[result.kind], alt: result.kind === 'file' || result.kind === 'document' ? 'Reveal' : null };
}
