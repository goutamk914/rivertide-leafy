/**
 * Notes: pinned first, then most recently updated. Upserting an id that no longer exists
 * creates a fresh note so the user's words are never lost.
 */
import type { Note } from '../../shared/types';
import type { AppContext, NotesService } from '../services';
import { newId, nowIso } from './ids';
import { NoteSchema } from './schemas';
import { announceChange, lazyLogger, lazyStore, parseItems, truncate } from './store';

interface NotesFile { readonly version: 1; readonly notes: readonly Note[] }

const TITLE_FROM_BODY_MAX = 60;
const UNTITLED = 'Untitled note';

export function sortNotes(notes: readonly Note[]): readonly Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** Uses the given title, else the body's first line, else "Untitled note". */
export function noteTitle(title: string, body: string): string {
  const trimmed = title.trim();
  if (trimmed) return trimmed.slice(0, 200);
  const firstLine = body.split('\n').map((line) => line.trim()).find((line) => line.length > 0);
  return firstLine ? truncate(firstLine, TITLE_FROM_BODY_MAX) : UNTITLED;
}

export function createNotesService(ctx: AppContext): NotesService {
  const log = lazyLogger(ctx, 'notes');
  const store = lazyStore<NotesFile>(ctx, 'notes', { version: 1, notes: [] }, (raw) => ({
    version: 1,
    notes: parseItems(raw, 'notes', NoteSchema, log),
  }));

  const write = (notes: readonly Note[]): void => {
    store().write({ version: 1, notes });
    announceChange(ctx, 'notes');
  };

  return {
    list(query) {
      const needle = query?.trim().toLowerCase() ?? '';
      const notes = store().read().notes;
      const matches = needle
        ? notes.filter((note) => `${note.title}\n${note.body}`.toLowerCase().includes(needle))
        : notes;
      return sortNotes(matches);
    },

    upsert(input, source = 'manual') {
      const notes = store().read().notes;
      const now = nowIso();
      const existing = input.id ? notes.find((note) => note.id === input.id) : undefined;
      if (existing) {
        const updated: Note = {
          ...existing,
          title: noteTitle(input.title, input.body),
          body: input.body,
          pinned: input.pinned ?? existing.pinned,
          updatedAt: now,
        };
        write(notes.map((note) => (note.id === existing.id ? updated : note)));
        return updated;
      }
      const created: Note = {
        id: newId(),
        title: noteTitle(input.title, input.body),
        body: input.body,
        pinned: input.pinned ?? false,
        source,
        createdAt: now,
        updatedAt: now,
      };
      write([created, ...notes]);
      return created;
    },

    delete(id) {
      const notes = store().read().notes;
      const kept = notes.filter((note) => note.id !== id);
      if (kept.length !== notes.length) write(kept);
    },
  };
}
