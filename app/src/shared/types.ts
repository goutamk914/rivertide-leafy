/**
 * Domain types shared by the main process and every renderer.
 * Pure type declarations only — no runtime code, no Node or DOM APIs.
 * Timestamps are ISO-8601 strings in UTC; ids come from `newId()` in ./ids.
 */
import type { LeafyMood } from '@rivertide/leafy/moods';

export type Id = string;
export type IsoDate = string;

// ── Voice ─────────────────────────────────────────────────────────────────────
export type VoiceMode = 'dictate' | 'ask' | 'command';
export type VoiceSource = 'fn' | 'hotkey' | 'clap' | 'wake' | 'leafy' | 'palette' | 'tray' | 'dashboard';
export type VoicePhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'acting'
  | 'confirming'
  | 'speaking'
  | 'done'
  | 'error';

export interface PendingConfirmation {
  readonly runId: Id;
  readonly callId: Id;
  readonly tool: string;
  /** Short imperative, e.g. "Quit Spotify". */
  readonly title: string;
  /** One sentence explaining exactly what will happen. */
  readonly summary: string;
}

export type VoiceErrorCode =
  | 'no-speech'
  | 'mic-denied'
  | 'mic-unavailable'
  | 'stt-failed'
  | 'stt-not-configured'
  | 'llm-failed'
  | 'llm-not-configured'
  | 'paste-failed'
  | 'agent-failed'
  | 'cancelled'
  | 'timeout'
  | 'unknown';

export interface VoiceError {
  readonly code: VoiceErrorCode;
  readonly message: string;
}

/** Everything the island, Leafy and dashboard need to render the current voice activity. */
export interface VoiceSnapshot {
  readonly sessionId: Id | null;
  readonly phase: VoicePhase;
  readonly mode: VoiceMode | null;
  readonly source: VoiceSource | null;
  /** Hands-free lock (double-press fn) is on. */
  readonly locked: boolean;
  readonly startedAt: IsoDate | null;
  /** What Rivertide heard (raw transcript). */
  readonly transcript: string;
  /** Polished text, answer, or agent reply. */
  readonly output: string;
  /** Short status line, e.g. "Opening Calendar". */
  readonly detail: string | null;
  readonly pending: PendingConfirmation | null;
  readonly pasted: boolean;
  readonly error: VoiceError | null;
}

export interface AudioLevel {
  /** 0..1 smoothed loudness. */
  readonly level: number;
  /** ~12 bands, 0..1, low → high frequency. */
  readonly bands: readonly number[];
}

/** Produced by the engine's VAD for every capture. */
export interface SpeechStats {
  readonly durationMs: number;
  readonly speechMs: number;
  readonly segments: number;
  readonly pauseCount: number;
  readonly longPauseCount: number;
  readonly meanPauseMs: number;
  readonly maxPauseMs: number;
  /** Mean RMS level of speech frames in dBFS (for loud/quiet hints). */
  readonly speechLevelDb: number;
}

export interface FrontmostApp {
  readonly name: string;
  readonly bundleId: string;
  readonly pid: number;
}

// ── History ───────────────────────────────────────────────────────────────────
export type HistoryStatus = 'ok' | 'empty' | 'error' | 'cancelled';

export interface AgentActionSummary {
  readonly tool: string;
  readonly title: string;
  readonly ok: boolean;
}

export interface HistoryItem {
  readonly id: Id;
  readonly createdAt: IsoDate;
  readonly mode: VoiceMode;
  readonly source: VoiceSource;
  readonly status: HistoryStatus;
  /** Raw speech-to-text output (the user's own words). */
  readonly raw: string;
  /** Polished text / answer / agent reply. */
  readonly output: string;
  readonly words: number;
  readonly durationMs: number;
  readonly app: Pick<FrontmostApp, 'name' | 'bundleId'> | null;
  readonly pasted: boolean;
  readonly error: string | null;
  readonly timings: { readonly sttMs: number | null; readonly llmMs: number | null; readonly totalMs: number | null };
  readonly providers: { readonly stt: string | null; readonly llm: string | null };
  readonly actions: readonly AgentActionSummary[];
  readonly audioPath: string | null;
}

// ── Knowledge ─────────────────────────────────────────────────────────────────
export const FACT_CATEGORIES = [
  'symptom',
  'medication',
  'diagnosis',
  'treatment',
  'appointment',
  'care-team',
  'goal',
  'feeling',
  'preference',
  'person',
  'other',
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
export type FactSource = 'dictation' | 'chat' | 'manual' | 'onboarding' | 'agent';

export interface Fact {
  readonly id: Id;
  readonly category: FactCategory;
  /** 2–5 words, e.g. "Oxaliplatin". */
  readonly label: string;
  /** One or two sentences in the user's terms. */
  readonly value: string;
  readonly source: FactSource;
  readonly sourceRef: Id | null;
  readonly pinned: boolean;
  readonly createdAt: IsoDate;
  readonly updatedAt: IsoDate;
}

export interface GraphNode {
  readonly id: Id;
  readonly label: string;
  readonly kind: 'self' | 'category' | 'fact';
  readonly category: FactCategory | null;
  readonly weight: number;
}

export interface GraphLink {
  readonly source: Id;
  readonly target: Id;
  readonly kind: 'category' | 'co-mention' | 'shared-term';
}

export interface KnowledgeGraph {
  readonly nodes: readonly GraphNode[];
  readonly links: readonly GraphLink[];
}

export interface DictionaryEntry {
  readonly id: Id;
  /** The correct spelling, e.g. "Oxaliplatin". */
  readonly term: string;
  /** Common mis-hearings it should replace, e.g. ["ox ally platin"]. */
  readonly replaces: readonly string[];
  readonly note: string;
  readonly source: 'manual' | 'learned';
  readonly uses: number;
  readonly createdAt: IsoDate;
}

// ── Chat & documents ─────────────────────────────────────────────────────────
export interface Citation {
  readonly kind: 'document' | 'fact' | 'history' | 'note';
  readonly id: Id;
  readonly title: string;
  readonly snippet: string;
}

export interface ChatMessage {
  readonly id: Id;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly createdAt: IsoDate;
  readonly citations: readonly Citation[];
}

export interface ChatSession {
  readonly id: Id;
  readonly title: string;
  readonly createdAt: IsoDate;
  readonly updatedAt: IsoDate;
  readonly messages: readonly ChatMessage[];
}

export interface ChatSummary {
  readonly id: Id;
  readonly title: string;
  readonly updatedAt: IsoDate;
  readonly preview: string;
  readonly messageCount: number;
}

export type ChatEvent =
  | { readonly type: 'delta'; readonly sessionId: Id; readonly messageId: Id; readonly delta: string }
  | { readonly type: 'done'; readonly sessionId: Id; readonly message: ChatMessage }
  | { readonly type: 'error'; readonly sessionId: Id; readonly messageId: Id; readonly message: string };

export type DocumentKind = 'text' | 'markdown' | 'pdf' | 'html' | 'rtf' | 'docx' | 'csv' | 'other';

export interface DocumentMeta {
  readonly id: Id;
  readonly name: string;
  readonly kind: DocumentKind;
  readonly chars: number;
  readonly createdAt: IsoDate;
  readonly sourcePath: string | null;
}

// ── Notes & reminders ────────────────────────────────────────────────────────
export interface Note {
  readonly id: Id;
  readonly title: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly source: 'voice' | 'manual' | 'agent';
  readonly createdAt: IsoDate;
  readonly updatedAt: IsoDate;
}

export interface Reminder {
  readonly id: Id;
  readonly kind: 'reminder' | 'timer';
  readonly text: string;
  readonly dueAt: IsoDate;
  readonly repeat: 'none' | 'daily';
  readonly status: 'scheduled' | 'fired' | 'cancelled' | 'missed';
  readonly createdAt: IsoDate;
  readonly firedAt: IsoDate | null;
}

// ── Insights ─────────────────────────────────────────────────────────────────
export interface DynamicsSession {
  readonly id: Id;
  readonly historyId: Id;
  readonly createdAt: IsoDate;
  readonly mode: VoiceMode;
  readonly durationMs: number;
  readonly speechMs: number;
  readonly words: number;
  readonly wpm: number;
  readonly pauseCount: number;
  readonly longPauseCount: number;
  readonly meanPauseMs: number;
  readonly fillerCount: number;
  readonly fillerRate: number;
  readonly repetitionCount: number;
  readonly selfCorrectionCount: number;
  readonly typeTokenRatio: number;
  readonly editRatio: number;
  readonly hourOfDay: number;
}

export type FogLabel = 'steady' | 'a-little-foggy' | 'foggy';

export interface FogReading {
  /** 0 (clear) .. 100 (very foggy), relative to the user's own baseline. */
  readonly fogIndex: number;
  readonly label: FogLabel;
  readonly contributors: readonly { readonly metric: keyof DynamicsSession; readonly direction: 'better' | 'worse'; readonly z: number }[];
}

export interface DynamicsSummary {
  readonly sessions: readonly DynamicsSession[];
  readonly baselineReady: boolean;
  readonly latest: FogReading | null;
  readonly daily: readonly { readonly date: string; readonly fogIndex: number | null; readonly wpm: number | null; readonly sessions: number }[];
  /** Plain-language observations, e.g. "You speak more slowly after 6 pm." */
  readonly insights: readonly string[];
}

export interface UsageSummary {
  readonly totals: { readonly sessions: number; readonly words: number; readonly dictations: number; readonly asks: number; readonly commands: number };
  readonly daily: readonly { readonly date: string; readonly words: number; readonly sessions: number }[];
  readonly streakDays: number;
  readonly topApps: readonly { readonly name: string; readonly count: number }[];
}

// ── Palette search ───────────────────────────────────────────────────────────
export type SearchKind = 'app' | 'file' | 'command' | 'fact' | 'history' | 'note' | 'document' | 'reminder' | 'web' | 'ask' | 'setting';

export interface SearchResult {
  readonly id: Id;
  readonly kind: SearchKind;
  readonly title: string;
  readonly subtitle: string | null;
  /** A `data:` image URL (app icons) or `icon:<lucide-name>`. */
  readonly icon: string | null;
  readonly score: number;
}

// ── Agent ────────────────────────────────────────────────────────────────────
export type AgentRunSource = 'voice' | 'palette' | 'leafy' | 'dashboard';

export type AgentEvent =
  | { readonly type: 'run-start'; readonly runId: Id; readonly input: string; readonly source: AgentRunSource }
  | { readonly type: 'text'; readonly runId: Id; readonly delta: string }
  | { readonly type: 'tool-start'; readonly runId: Id; readonly callId: Id; readonly tool: string; readonly title: string }
  | { readonly type: 'tool-confirm'; readonly runId: Id; readonly confirmation: PendingConfirmation }
  | { readonly type: 'tool-end'; readonly runId: Id; readonly callId: Id; readonly ok: boolean; readonly summary: string }
  | { readonly type: 'run-end'; readonly runId: Id; readonly text: string; readonly ok: boolean };

// ── Leafy & permissions ──────────────────────────────────────────────────────
export interface LeafyCue {
  readonly mood: LeafyMood;
  /** Short speech-bubble text. */
  readonly say: string | null;
  /** How long the bubble stays, ms (null = until the next cue). */
  readonly holdMs: number | null;
}

export type MediaPermission = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface PermissionStatus {
  readonly microphone: MediaPermission;
  readonly accessibility: boolean;
  readonly screen: MediaPermission;
  readonly helper: 'running' | 'unavailable' | 'stopped' | 'unsupported';
  readonly platform: 'darwin' | 'win32' | 'linux';
}

export interface HotkeyStatus {
  readonly action: 'palette' | 'command' | 'dictate';
  readonly accelerator: string;
  readonly registered: boolean;
}

export interface AppInfo {
  readonly version: string;
  readonly platform: 'darwin' | 'win32' | 'linux';
  readonly arch: string;
  readonly electron: string;
  readonly userDataPath: string;
  readonly isDev: boolean;
}

export type DataDomain = 'history' | 'knowledge' | 'dictionary' | 'documents' | 'chats' | 'notes' | 'reminders' | 'dynamics';

export interface Toast {
  readonly kind: 'info' | 'success' | 'error';
  readonly message: string;
}
