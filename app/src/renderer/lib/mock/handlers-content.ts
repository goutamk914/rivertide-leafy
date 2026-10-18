/** Mock handlers for the user's content: history, knowledge, dictionary, documents, notes, reminders, insights. */
import type { DataDomain, DocumentKind, Fact, GraphLink, GraphNode, KnowledgeGraph, Reminder } from '@shared/types';
import { dynamicsSummary, usageSummary } from './insights';
import { MINUTE, mockId } from './random';
import { OK, notFound, type MockContext, type MockHandlers } from './context';

const DEFAULT_HISTORY_LIMIT = 50;
const MIN_SHARED_TERM = 5;

type ContentChannels =
  | 'history:list' | 'history:get' | 'history:delete' | 'history:clear' | 'history:repaste'
  | 'knowledge:list' | 'knowledge:upsert' | 'knowledge:delete' | 'knowledge:graph'
  | 'dictionary:list' | 'dictionary:upsert' | 'dictionary:delete'
  | 'documents:list' | 'documents:pick' | 'documents:importText' | 'documents:get' | 'documents:delete'
  | 'notes:list' | 'notes:upsert' | 'notes:delete'
  | 'reminders:list' | 'reminders:create' | 'reminders:cancel'
  | 'insights:usage' | 'insights:dynamics';

const includes = (haystack: string, query: string | undefined) =>
  !query || haystack.toLowerCase().includes(query.trim().toLowerCase());

function sortFacts(facts: readonly Fact[]): Fact[] {
  return [...facts].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

function terms(fact: Fact): Set<string> {
  return new Set(`${fact.label} ${fact.value}`.toLowerCase().match(/[a-z]{5,}/g) ?? []);
}

export function buildGraph(facts: readonly Fact[]): KnowledgeGraph {
  const categories = [...new Set(facts.map((f) => f.category))];
  const nodes: GraphNode[] = [
    { id: 'self', label: 'You', kind: 'self', category: null, weight: facts.length },
    ...categories.map((c): GraphNode => ({ id: `cat:${c}`, label: c, kind: 'category', category: c, weight: facts.filter((f) => f.category === c).length })),
    ...facts.map((f): GraphNode => ({ id: f.id, label: f.label, kind: 'fact', category: f.category, weight: f.pinned ? 2 : 1 })),
  ];
  const links: GraphLink[] = [
    ...categories.map((c): GraphLink => ({ source: 'self', target: `cat:${c}`, kind: 'category' })),
    ...facts.map((f): GraphLink => ({ source: `cat:${f.category}`, target: f.id, kind: 'category' })),
  ];
  facts.forEach((a, i) => {
    const aTerms = terms(a);
    facts.slice(i + 1).forEach((b) => {
      if (a.category === b.category) return;
      const shared = [...terms(b)].some((t) => t.length >= MIN_SHARED_TERM && aTerms.has(t));
      if (shared) links.push({ source: a.id, target: b.id, kind: 'shared-term' });
    });
  });
  return { nodes, links };
}

function kindFromName(name: string): DocumentKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, DocumentKind> = { txt: 'text', md: 'markdown', markdown: 'markdown', csv: 'csv', html: 'html', htm: 'html', pdf: 'pdf', rtf: 'rtf', docx: 'docx' };
  return map[ext] ?? 'other';
}

export function contentHandlers(ctx: MockContext): Pick<MockHandlers, ContentChannels> {
  const changed = (domain: DataDomain) => ctx.emit('data:changed', { domain });
  const nowIso = () => ctx.now().toISOString();

  return {
    'history:list': ({ query, mode, limit, before }) =>
      ctx.get().history
        .filter((h) => (!mode || h.mode === mode) && (!before || h.createdAt < before) && includes(`${h.raw} ${h.output} ${h.app?.name ?? ''}`, query))
        .slice(0, limit ?? DEFAULT_HISTORY_LIMIT),
    'history:get': ({ id }) => ctx.get().history.find((h) => h.id === id) ?? null,
    'history:delete': ({ id }) => {
      ctx.set((s) => ({ ...s, history: s.history.filter((h) => h.id !== id) }));
      changed('history');
      return OK;
    },
    'history:clear': () => {
      ctx.set((s) => ({ ...s, history: [] }));
      changed('history');
      return OK;
    },
    'history:repaste': ({ id }) => {
      if (!ctx.get().history.some((h) => h.id === id)) throw notFound('history item');
      return { pasted: true };
    },

    'knowledge:list': ({ query, category }) =>
      sortFacts(ctx.get().facts.filter((f) => (!category || f.category === category) && includes(`${f.label} ${f.value}`, query))),
    'knowledge:upsert': ({ fact }) => {
      const existing = fact.id ? ctx.get().facts.find((f) => f.id === fact.id) : undefined;
      if (fact.id && !existing) throw notFound('fact');
      const saved: Fact = existing
        ? { ...existing, category: fact.category, label: fact.label, value: fact.value, pinned: fact.pinned ?? existing.pinned, updatedAt: nowIso() }
        : { id: mockId(), category: fact.category, label: fact.label, value: fact.value, source: 'manual', sourceRef: null, pinned: fact.pinned ?? false, createdAt: nowIso(), updatedAt: nowIso() };
      ctx.set((s) => ({ ...s, facts: existing ? s.facts.map((f) => (f.id === saved.id ? saved : f)) : [saved, ...s.facts] }));
      changed('knowledge');
      return saved;
    },
    'knowledge:delete': ({ id }) => {
      ctx.set((s) => ({ ...s, facts: s.facts.filter((f) => f.id !== id) }));
      changed('knowledge');
      return OK;
    },
    'knowledge:graph': () => buildGraph(ctx.get().facts),

    'dictionary:list': () => [...ctx.get().dictionary].sort((a, b) => a.term.localeCompare(b.term)),
    'dictionary:upsert': ({ entry }) => {
      const existing = entry.id ? ctx.get().dictionary.find((d) => d.id === entry.id) : undefined;
      if (entry.id && !existing) throw notFound('dictionary entry');
      const saved = existing
        ? { ...existing, term: entry.term, replaces: entry.replaces, note: entry.note ?? existing.note }
        : { id: mockId(), term: entry.term, replaces: entry.replaces, note: entry.note ?? '', source: 'manual' as const, uses: 0, createdAt: nowIso() };
      ctx.set((s) => ({ ...s, dictionary: existing ? s.dictionary.map((d) => (d.id === saved.id ? saved : d)) : [...s.dictionary, saved] }));
      changed('dictionary');
      return saved;
    },
    'dictionary:delete': ({ id }) => {
      ctx.set((s) => ({ ...s, dictionary: s.dictionary.filter((d) => d.id !== id) }));
      changed('dictionary');
      return OK;
    },

    'documents:list': () => ctx.get().documents.map((d) => d.meta).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    'documents:pick': () => {
      const text = 'This is a sample file the browser preview imports in place of the file picker.';
      const meta = { id: mockId(), name: 'Picked sample.txt', kind: 'text' as const, chars: text.length, createdAt: nowIso(), sourcePath: '~/Documents/Picked sample.txt' };
      ctx.set((s) => ({ ...s, documents: [{ meta, text }, ...s.documents] }));
      changed('documents');
      return [meta];
    },
    'documents:importText': ({ name, text }) => {
      const meta = { id: mockId(), name, kind: kindFromName(name), chars: text.length, createdAt: nowIso(), sourcePath: null };
      ctx.set((s) => ({ ...s, documents: [{ meta, text }, ...s.documents] }));
      changed('documents');
      return meta;
    },
    'documents:get': ({ id }) => ctx.get().documents.find((d) => d.meta.id === id) ?? null,
    'documents:delete': ({ id }) => {
      ctx.set((s) => ({ ...s, documents: s.documents.filter((d) => d.meta.id !== id) }));
      changed('documents');
      return OK;
    },

    'notes:list': ({ query }) =>
      [...ctx.get().notes]
        .filter((n) => includes(`${n.title} ${n.body}`, query))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
    'notes:upsert': ({ note }) => {
      const existing = note.id ? ctx.get().notes.find((n) => n.id === note.id) : undefined;
      if (note.id && !existing) throw notFound('note');
      const saved = existing
        ? { ...existing, title: note.title, body: note.body, pinned: note.pinned ?? existing.pinned, updatedAt: nowIso() }
        : { id: mockId(), title: note.title, body: note.body, pinned: note.pinned ?? false, source: 'manual' as const, createdAt: nowIso(), updatedAt: nowIso() };
      ctx.set((s) => ({ ...s, notes: existing ? s.notes.map((n) => (n.id === saved.id ? saved : n)) : [saved, ...s.notes] }));
      changed('notes');
      return saved;
    },
    'notes:delete': ({ id }) => {
      ctx.set((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
      changed('notes');
      return OK;
    },

    'reminders:list': () => [...ctx.get().reminders].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
    'reminders:create': ({ kind, text, dueAt, inMinutes, repeat }) => {
      const due = dueAt ?? new Date(ctx.now().getTime() + (inMinutes ?? 0) * MINUTE).toISOString();
      const reminder: Reminder = { id: mockId(), kind, text, dueAt: due, repeat: repeat ?? 'none', status: 'scheduled', createdAt: nowIso(), firedAt: null };
      ctx.set((s) => ({ ...s, reminders: [...s.reminders, reminder] }));
      changed('reminders');
      return reminder;
    },
    'reminders:cancel': ({ id }) => {
      ctx.set((s) => ({ ...s, reminders: s.reminders.map((r) => (r.id === id ? { ...r, status: 'cancelled' as const } : r)) }));
      changed('reminders');
      return OK;
    },

    'insights:usage': ({ days }) => usageSummary(ctx.get().history, days, ctx.now()),
    'insights:dynamics': ({ days }) => dynamicsSummary(ctx.get().dynamics, days, ctx.now()),
  };
}
