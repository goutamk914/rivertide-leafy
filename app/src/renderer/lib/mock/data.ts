/** Builds the in-memory state the browser mock serves. All content is invented (see samples.ts). */
import { DEFAULT_SETTINGS, LLM_PROVIDER_IDS, type SecretId, type Settings } from '@shared/settings';
import type { SecretStatus } from '@shared/ipc';
import type {
  ChatSession, DictionaryEntry, DocumentMeta, DynamicsSession, Fact, HistoryItem, Note, PermissionStatus, Reminder,
} from '@shared/types';
import { countWords } from '../format';
import { DAY, HOUR, MINUTE, between, createRng, isoAt, isoOnDay, mockId, pick, type Rng } from './random';
import {
  CHAT_STARTER_REPLY, SAMPLE_DICTIONARY, SAMPLE_DOCUMENTS, SAMPLE_FACTS, SAMPLE_NOTES, SAMPLE_UTTERANCES,
} from './samples';

export interface StoredDocument {
  readonly meta: DocumentMeta;
  readonly text: string;
}

export interface MockState {
  readonly settings: Settings;
  readonly secrets: SecretStatus;
  readonly permissions: PermissionStatus;
  readonly history: readonly HistoryItem[];
  readonly facts: readonly Fact[];
  readonly dictionary: readonly DictionaryEntry[];
  readonly documents: readonly StoredDocument[];
  readonly chats: readonly ChatSession[];
  readonly notes: readonly Note[];
  readonly reminders: readonly Reminder[];
  readonly dynamics: readonly DynamicsSession[];
}

const HISTORY_DAYS = 21;
const SEED = 20261015;

export function emptySecrets(): SecretStatus {
  const ids: SecretId[] = [...LLM_PROVIDER_IDS, 'stt-custom'];
  return Object.fromEntries(ids.map((id) => [id, { set: false }])) as SecretStatus;
}

function seedSettings(): Settings {
  return { ...DEFAULT_SETTINGS, onboarded: true, profile: { name: 'Sam' } };
}

function historyItem(rng: Rng, createdAt: string): HistoryItem {
  const sample = pick(rng, SAMPLE_UTTERANCES);
  const words = countWords(sample.raw);
  const durationMs = Math.round(words * between(rng, 380, 620));
  const sttMs = Math.round(between(rng, 280, 900));
  const llmMs = Math.round(between(rng, 500, 1800));
  return {
    id: mockId(Date.parse(createdAt)),
    createdAt,
    mode: sample.mode,
    source: sample.mode === 'command' ? pick(rng, ['fn', 'clap', 'leafy'] as const) : 'fn',
    status: 'ok',
    raw: sample.raw,
    output: sample.output,
    words,
    durationMs,
    app: sample.app,
    pasted: sample.mode !== 'command',
    error: null,
    timings: { sttMs, llmMs, totalMs: sttMs + llmMs + 120 },
    providers: { stt: 'groq · whisper-large-v3-turbo', llm: 'anthropic · claude-opus-5-5' },
    actions: sample.actions ?? [],
    audioPath: null,
  };
}

function seedHistory(rng: Rng, now: Date): HistoryItem[] {
  const items: HistoryItem[] = [];
  const todayOffsets = [18, 52, 95, 160, 230].map((m) => -m * MINUTE);
  for (const offset of todayOffsets) items.push(historyItem(rng, isoAt(now, offset)));
  for (let day = 1; day < HISTORY_DAYS; day += 1) {
    if (day === 9) continue; // a quiet day keeps the streak honest
    const count = 2 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i += 1) {
      items.push(historyItem(rng, isoOnDay(now, day, 8 + Math.floor(rng() * 13), Math.floor(rng() * 60))));
    }
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function seedDynamics(rng: Rng, history: readonly HistoryItem[]): DynamicsSession[] {
  return history.map((item, index) => {
    const dayFactor = Math.sin(index / 6) * 0.12;
    const speechMs = Math.round(item.durationMs * between(rng, 0.7, 0.85));
    const wpm = Math.round(118 * (1 - dayFactor) + between(rng, -10, 10));
    const pauseCount = Math.round(between(rng, 1, 6));
    const fillerCount = Math.round(between(rng, 0, 1.3));
    return {
      id: mockId(Date.parse(item.createdAt)),
      historyId: item.id,
      createdAt: item.createdAt,
      mode: item.mode,
      durationMs: item.durationMs,
      speechMs,
      words: item.words,
      wpm,
      pauseCount,
      longPauseCount: Math.round(pauseCount / 3),
      meanPauseMs: Math.round(between(rng, 450, 1400)),
      fillerCount,
      fillerRate: item.words ? Math.round((10_000 * fillerCount) / item.words) / 100 : 0, // per 100 words, as main computes it
      repetitionCount: Math.round(between(rng, 0, 2)),
      selfCorrectionCount: Math.round(between(rng, 0, 1.4)),
      typeTokenRatio: between(rng, 0.62, 0.86),
      editRatio: between(rng, 0.05, 0.3),
      hourOfDay: new Date(item.createdAt).getHours(),
    };
  });
}

function seedFacts(now: Date): Fact[] {
  return SAMPLE_FACTS.map((fact, i) => {
    const at = isoAt(now, -(i + 1) * 7 * HOUR);
    return {
      id: mockId(Date.parse(at)),
      category: fact.category,
      label: fact.label,
      value: fact.value,
      source: i % 3 === 0 ? 'manual' : 'dictation',
      sourceRef: null,
      pinned: Boolean(fact.pinned),
      createdAt: at,
      updatedAt: at,
    };
  });
}

function seedDocuments(now: Date): StoredDocument[] {
  return SAMPLE_DOCUMENTS.map((doc, i) => {
    const at = isoAt(now, -(i * 3 + 1) * DAY);
    return {
      meta: { id: mockId(Date.parse(at)), name: doc.name, kind: doc.kind, chars: doc.text.length, createdAt: at, sourcePath: null },
      text: doc.text,
    };
  });
}

function seedChats(now: Date): ChatSession[] {
  const at = isoAt(now, -26 * HOUR);
  const question = 'What did I tell you about my energy this week?';
  return [
    {
      id: mockId(Date.parse(at)),
      title: 'Energy this week',
      createdAt: at,
      updatedAt: isoAt(now, -25 * HOUR),
      messages: [
        { id: mockId(), role: 'user', content: question, createdAt: at, citations: [] },
        {
          id: mockId(),
          role: 'assistant',
          content: CHAT_STARTER_REPLY,
          createdAt: isoAt(now, -25 * HOUR),
          citations: [
            { kind: 'history', id: 'h-sample', title: 'Dictation in Notes', snippet: 'Energy was low today, maybe a 4 out of 10.' },
            { kind: 'fact', id: 'f-sample', title: 'Afternoon fatigue', snippet: 'Energy drops after lunch most days.' },
          ],
        },
      ],
    },
  ];
}

function seedNotes(now: Date): Note[] {
  return SAMPLE_NOTES.map((note, i) => {
    const at = isoAt(now, -(i * 30 + 3) * HOUR);
    return { id: mockId(Date.parse(at)), ...note, createdAt: at, updatedAt: at };
  });
}

function seedReminders(now: Date): Reminder[] {
  const make = (text: string, offset: number, status: Reminder['status'], kind: Reminder['kind'] = 'reminder'): Reminder => ({
    id: mockId(now.getTime() + offset),
    kind,
    text,
    dueAt: isoAt(now, offset),
    repeat: 'none',
    status,
    createdAt: isoAt(now, Math.min(offset, 0) - HOUR),
    firedAt: status === 'fired' ? isoAt(now, offset) : null,
  });
  return [
    make('Take evening medicines', 3 * HOUR, 'scheduled'),
    make('Call Priya about the tingling', 22 * HOUR, 'scheduled'),
    make('Tea', 14 * MINUTE, 'scheduled', 'timer'),
    make('Drink a glass of water', -2 * HOUR, 'fired'),
    make('Stretch', -27 * HOUR, 'fired'),
  ];
}

/** A fresh, fully populated state relative to `now`. */
export function seedState(now: Date = new Date()): MockState {
  const rng = createRng(SEED);
  const history = seedHistory(rng, now);
  const dictionary: DictionaryEntry[] = SAMPLE_DICTIONARY.map((entry, i) => ({
    id: mockId(now.getTime() - i),
    term: entry.term,
    replaces: [...entry.replaces],
    note: entry.note,
    source: i % 2 === 0 ? 'manual' : 'learned',
    uses: Math.round(between(rng, 1, 30)),
    createdAt: isoAt(now, -(i + 2) * DAY),
  }));
  return {
    settings: seedSettings(),
    secrets: { ...emptySecrets(), anthropic: { set: true }, groq: { set: true } },
    permissions: {
      microphone: 'granted',
      accessibility: true,
      screen: 'not-determined',
      helper: 'running',
      platform: 'darwin',
    },
    history,
    facts: seedFacts(now),
    dictionary,
    documents: seedDocuments(now),
    chats: seedChats(now),
    notes: seedNotes(now),
    reminders: seedReminders(now),
    dynamics: seedDynamics(rng, history),
  };
}

/** The state after "Wipe all data": empty domains, settings kept but onboarding reset. */
export function wipedState(current: MockState): MockState {
  return {
    ...current,
    settings: { ...current.settings, onboarded: false },
    history: [],
    facts: [],
    dictionary: [],
    documents: [],
    chats: [],
    notes: [],
    reminders: [],
    dynamics: [],
  };
}
