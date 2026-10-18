/**
 * zod schemas for every record the memory agent persists. Each mirrors a type in
 * shared/types.ts; the `z.ZodType<T>` annotations make the compiler keep them in sync.
 */
import { z } from 'zod';
import { FACT_CATEGORIES } from '../../shared/types';
import type {
  ChatSession, DictionaryEntry, DocumentMeta, DynamicsSession, Fact, HistoryItem, Note, Reminder,
} from '../../shared/types';

const id = z.string().min(1).max(64);
const iso = z.string().min(1).max(40);
const voiceMode = z.enum(['dictate', 'ask', 'command']);
const voiceSource = z.enum(['fn', 'hotkey', 'clap', 'wake', 'leafy', 'palette', 'tray', 'dashboard']);
const count = z.number().finite().nonnegative();
const nullableMs = z.number().finite().nonnegative().nullable();

export const HistoryItemSchema: z.ZodType<HistoryItem> = z.object({
  id,
  createdAt: iso,
  mode: voiceMode,
  source: voiceSource,
  status: z.enum(['ok', 'empty', 'error', 'cancelled']),
  raw: z.string(),
  output: z.string(),
  words: count,
  durationMs: count,
  app: z.object({ name: z.string(), bundleId: z.string() }).nullable(),
  pasted: z.boolean(),
  error: z.string().nullable(),
  timings: z.object({ sttMs: nullableMs, llmMs: nullableMs, totalMs: nullableMs }),
  providers: z.object({ stt: z.string().nullable(), llm: z.string().nullable() }),
  actions: z.array(z.object({ tool: z.string(), title: z.string(), ok: z.boolean() })),
  audioPath: z.string().nullable(),
});

export const FactSchema: z.ZodType<Fact> = z.object({
  id,
  category: z.enum(FACT_CATEGORIES),
  label: z.string().min(1).max(120),
  value: z.string().max(2000),
  source: z.enum(['dictation', 'chat', 'manual', 'onboarding', 'agent']),
  sourceRef: id.nullable(),
  pinned: z.boolean(),
  createdAt: iso,
  updatedAt: iso,
});

export const DictionaryEntrySchema: z.ZodType<DictionaryEntry> = z.object({
  id,
  term: z.string().min(1).max(80),
  replaces: z.array(z.string().min(1).max(80)).max(20),
  note: z.string().max(200),
  source: z.enum(['manual', 'learned']),
  uses: z.number().int().nonnegative(),
  createdAt: iso,
});

const CitationSchema = z.object({
  kind: z.enum(['document', 'fact', 'history', 'note']),
  id,
  title: z.string(),
  snippet: z.string(),
});

export const ChatSessionSchema: z.ZodType<ChatSession> = z.object({
  id,
  title: z.string().max(200),
  createdAt: iso,
  updatedAt: iso,
  messages: z.array(z.object({
    id,
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: iso,
    citations: z.array(CitationSchema),
  })),
});

export const DocumentMetaSchema: z.ZodType<DocumentMeta> = z.object({
  id,
  name: z.string().min(1).max(200),
  kind: z.enum(['text', 'markdown', 'pdf', 'html', 'rtf', 'docx', 'csv', 'other']),
  chars: z.number().int().nonnegative(),
  createdAt: iso,
  sourcePath: z.string().nullable(),
});

export const NoteSchema: z.ZodType<Note> = z.object({
  id,
  title: z.string().max(200),
  body: z.string().max(100_000),
  pinned: z.boolean(),
  source: z.enum(['voice', 'manual', 'agent']),
  createdAt: iso,
  updatedAt: iso,
});

export const ReminderSchema: z.ZodType<Reminder> = z.object({
  id,
  kind: z.enum(['reminder', 'timer']),
  text: z.string().min(1).max(300),
  // The scheduler does date math on dueAt, so it must parse.
  dueAt: iso.refine((value) => Number.isFinite(Date.parse(value)), 'dueAt must be a valid date'),
  repeat: z.enum(['none', 'daily']),
  status: z.enum(['scheduled', 'fired', 'cancelled', 'missed']),
  createdAt: iso,
  firedAt: iso.nullable(),
});

export const DynamicsSessionSchema: z.ZodType<DynamicsSession> = z.object({
  id,
  historyId: id,
  createdAt: iso,
  mode: voiceMode,
  durationMs: count,
  speechMs: count,
  words: count,
  wpm: count,
  pauseCount: count,
  longPauseCount: count,
  meanPauseMs: count,
  fillerCount: count,
  fillerRate: count,
  repetitionCount: count,
  selfCorrectionCount: count,
  typeTokenRatio: z.number().min(0).max(1),
  editRatio: z.number().min(0).max(1),
  hourOfDay: z.number().int().min(0).max(23),
});
