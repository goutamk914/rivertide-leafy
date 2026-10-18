/**
 * In-memory BM25 search over document chunks, notes, facts and history (raw + output).
 * Each kind is rebuilt lazily after `invalidate(domain)`; scores within one search share the
 * corpus statistics of the kinds searched. One hit per item (its best chunk).
 */
import type { DataDomain, Id } from '../../shared/types';
import type { AppContext, SearchHit, SearchIndex } from '../services';
import { lazyLogger, errorMessage, truncate } from '../data/store';
import { corpusStats, rank, toBm25Doc, type Bm25Doc } from './bm25';
import { bestWindow, chunkText } from './passages';
import { tokenize } from './text';

type Kind = SearchHit['kind'];

export const SEARCH_KINDS: readonly Kind[] = ['document', 'note', 'fact', 'history'];
export const SNIPPET_CHARS = 200;
const DEFAULT_LIMIT = 10;
const HISTORY_INDEX_LIMIT = 5000;
const HISTORY_TITLE_CHARS = 60;

const KIND_BY_DOMAIN: Partial<Record<DataDomain, Kind>> = {
  documents: 'document',
  notes: 'note',
  knowledge: 'fact',
  history: 'history',
};

export interface IndexedText {
  readonly kind: Kind;
  readonly id: Id;
  readonly title: string;
  readonly text: string;
}

type IndexDoc = Bm25Doc<IndexedText>;

const toDoc = (entry: IndexedText, extra = ''): IndexDoc => toBm25Doc(entry, tokenize(`${entry.text}\n${extra}`));

function documentDocs(ctx: AppContext): IndexDoc[] {
  return ctx.documents.list().flatMap((meta) => {
    const loaded = ctx.documents.get(meta.id);
    if (!loaded) return [];
    return chunkText(loaded.text).map((chunk) =>
      toDoc({ kind: 'document', id: meta.id, title: meta.name, text: chunk }, meta.name));
  });
}

function noteDocs(ctx: AppContext): IndexDoc[] {
  return ctx.notes.list().map((note) => toDoc({ kind: 'note', id: note.id, title: note.title, text: `${note.title}\n${note.body}` }));
}

function factDocs(ctx: AppContext): IndexDoc[] {
  return ctx.knowledge.list().map((fact) =>
    toDoc({ kind: 'fact', id: fact.id, title: fact.label, text: `${fact.label}: ${fact.value}` }, fact.category));
}

function historyDocs(ctx: AppContext): IndexDoc[] {
  return ctx.history.recent(HISTORY_INDEX_LIMIT)
    .filter((item) => item.raw.trim() || item.output.trim())
    .map((item) => toDoc({
      kind: 'history',
      id: item.id,
      title: truncate(item.raw || item.output, HISTORY_TITLE_CHARS),
      text: [item.raw, item.output].filter((part) => part.trim()).join('\n'),
    }));
}

const BUILDERS: Record<Kind, (ctx: AppContext) => IndexDoc[]> = {
  document: documentDocs,
  note: noteDocs,
  fact: factDocs,
  history: historyDocs,
};

export function createSearchIndex(ctx: AppContext): SearchIndex {
  const log = lazyLogger(ctx, 'search');
  const docs = new Map<Kind, readonly IndexDoc[]>();
  const dirty = new Set<Kind>(SEARCH_KINDS);

  const ensure = (kind: Kind): readonly IndexDoc[] => {
    if (!dirty.has(kind) && docs.has(kind)) return docs.get(kind) ?? [];
    try {
      const built = BUILDERS[kind](ctx);
      docs.set(kind, built);
      dirty.delete(kind);
      return built;
    } catch (error) {
      log().error('Could not build the search index', { kind, error: errorMessage(error) });
      return docs.get(kind) ?? [];
    }
  };

  return {
    search(query, options) {
      const terms = tokenize(query);
      if (terms.length === 0) return [];
      const kinds = options?.kinds?.length ? options.kinds : SEARCH_KINDS;
      const lists = kinds.map(ensure);
      const stats = corpusStats(lists);
      const ranked = rank(lists.flat(), terms, stats);
      const termSet = new Set(terms);
      const seen = new Set<string>();
      const hits: SearchHit[] = [];
      const limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT);
      for (const { doc, score } of ranked) {
        const key = `${doc.meta.kind}:${doc.meta.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const { kind, id, title, text } = doc.meta;
        hits.push({ kind, id, title, snippet: bestWindow(text, termSet, SNIPPET_CHARS), score: Math.round(score * 1000) / 1000 });
        if (hits.length >= limit) break;
      }
      return hits;
    },

    invalidate(domain) {
      if (domain === undefined) {
        SEARCH_KINDS.forEach((kind) => dirty.add(kind));
        return;
      }
      const kind = KIND_BY_DOMAIN[domain];
      if (kind) dirty.add(kind);
    },
  };
}
