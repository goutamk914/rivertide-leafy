/**
 * Memory tools over the person's own data: create_note, search_notes, remember_fact,
 * recall_facts, search_documents, search_history. Returned content is untrusted data.
 */
import { z } from 'zod';
import { FACT_CATEGORIES } from '../../../shared/types';
import { clip, defineTool, ok, plural } from './types';

const SNIPPET_CHARS = 500;
const RESULT_LIMIT = 5;
const TITLE_WORDS = 6;
const query = z.string().trim().min(1).max(200);

export const titleFromBody = (body: string): string => {
  const words = body.trim().split(/\s+/).slice(0, TITLE_WORDS).join(' ');
  return clip(words.replace(/[.,;:!?]+$/, ''), 60);
};

export const createNoteTool = defineTool({
  name: 'create_note',
  description: 'Save a note in Rivertide (Notes & reminders page). Use for "take a note", "note to self", "write this down".',
  risk: 'act',
  schema: z.object({
    title: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(20_000).describe('The note text in the person’s words.'),
  }),
  title: ({ title, body }) => `Note: ${clip(title || body, 40)}`,
  async run({ title, body }, context) {
    const note = context.app.notes.upsert({ title: title?.trim() || titleFromBody(body), body }, 'agent');
    return ok(`Saved a note: ${note.title}.`, { id: note.id });
  },
});

export const searchNotesTool = defineTool({
  name: 'search_notes',
  description: 'Search the person’s Rivertide notes.',
  risk: 'read',
  untrustedOutput: true,
  schema: z.object({ query }),
  title: ({ query: text }) => `Search notes for “${clip(text, 40)}”`,
  async run({ query: text }, context) {
    const notes = context.app.notes.list(text).slice(0, RESULT_LIMIT);
    if (notes.length === 0) return ok(`I didn’t find any notes about “${text}”.`, { notes: [] });
    return ok(`I found ${plural(notes.length, 'note')}. The first is “${notes[0].title}”.`, {
      notes: notes.map((note) => ({ id: note.id, title: note.title, body: clip(note.body, SNIPPET_CHARS), updatedAt: note.updatedAt })),
    });
  },
});

export const rememberFactTool = defineTool({
  name: 'remember_fact',
  description: 'Remember a fact about the person for later (medications, appointments, care team, preferences…). Only when they ask you to remember something.',
  risk: 'act',
  schema: z.object({
    category: z.enum(FACT_CATEGORIES),
    label: z.string().trim().min(1).max(80).describe('2–5 words, e.g. "Oncologist".'),
    value: z.string().trim().min(1).max(1000).describe('One or two sentences in the person’s terms.'),
  }),
  title: ({ label }) => `Remember ${clip(label, 40)}`,
  async run({ category, label, value }, context) {
    const fact = context.app.knowledge.upsert({ category, label, value }, 'agent');
    return ok('Got it — I’ll remember that.', { id: fact.id });
  },
});

export const recallFactsTool = defineTool({
  name: 'recall_facts',
  description: 'Look up facts the person saved about themselves (medications, appointments, people, preferences).',
  risk: 'read',
  untrustedOutput: true,
  schema: z.object({ query }),
  title: ({ query: text }) => `Recall “${clip(text, 40)}”`,
  async run({ query: text }, context) {
    const facts = context.app.knowledge.relevant(text, 8);
    if (facts.length === 0) return ok('I don’t have anything saved about that yet.', { facts: [] });
    return ok(`I found ${plural(facts.length, 'saved fact')}.`, {
      facts: facts.map((fact) => ({ category: fact.category, label: fact.label, value: clip(fact.value, SNIPPET_CHARS) })),
    });
  },
});

export const searchDocumentsTool = defineTool({
  name: 'search_documents',
  description: 'Search documents the person imported into Rivertide (care plans, letters, discharge notes).',
  risk: 'read',
  untrustedOutput: true,
  schema: z.object({ query }),
  title: ({ query: text }) => `Search documents for “${clip(text, 40)}”`,
  async run({ query: text }, context) {
    const hits = context.app.search.search(text, { kinds: ['document'], limit: RESULT_LIMIT });
    if (hits.length === 0) return ok(`I didn’t find anything about “${text}” in your documents.`, { results: [] });
    return ok(`I found ${plural(hits.length, 'match')} in your documents. The best is in “${hits[0].title}”.`, {
      results: hits.map((hit) => ({ id: hit.id, title: hit.title, snippet: clip(hit.snippet, SNIPPET_CHARS) })),
    });
  },
});

export const searchHistoryTool = defineTool({
  name: 'search_history',
  description: 'Search what the person dictated, asked or commanded before (their Rivertide history).',
  risk: 'read',
  untrustedOutput: true,
  schema: z.object({ query, limit: z.number().int().min(1).max(10).optional() }),
  title: ({ query: text }) => `Search history for “${clip(text, 40)}”`,
  async run({ query: text, limit }, context) {
    const items = context.app.history.list({ query: text, limit: limit ?? RESULT_LIMIT });
    if (items.length === 0) return ok(`I didn’t find “${text}” in your history.`, { items: [] });
    return ok(`I found ${plural(items.length, 'match')} in your history.`, {
      items: items.map((item) => ({ createdAt: item.createdAt, mode: item.mode, said: clip(item.raw, SNIPPET_CHARS), output: clip(item.output, SNIPPET_CHARS) })),
    });
  },
});
