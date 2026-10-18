/**
 * The IPC contract. Main validates every request against `invokeSchemas` / `sendSchemas`;
 * renderers get compile-time types from `InvokeRequest` / `InvokeResult` / `EventPayload`.
 * Adding a channel: add the name in ipc-channels.ts, a schema here, a result type here,
 * and a handler in src/main/ipc/handlers/<namespace>.ts.
 */
import { z } from 'zod';
import type { EventChannel, InvokeChannel, SendChannel } from './ipc-channels';
import { FACT_CATEGORIES } from './types';
import type {
  AgentEvent, AppInfo, AudioLevel, ChatEvent, ChatSession, ChatSummary, DataDomain, DictionaryEntry,
  DocumentMeta, DynamicsSummary, Fact, HistoryItem, HotkeyStatus, Id, KnowledgeGraph, LeafyCue, Note,
  PermissionStatus, Reminder, SearchResult, Toast, UsageSummary, VoiceSnapshot,
} from './types';
import { LLM_PROVIDER_IDS, type SecretId, type Settings, type SettingsPatch } from './settings';

const id = z.string().min(1).max(64);
const none = z.object({}).strict().optional();
const text = (max: number) => z.string().max(max);
const voiceMode = z.enum(['dictate', 'ask', 'command']);
const voiceSource = z.enum(['fn', 'hotkey', 'clap', 'wake', 'leafy', 'palette', 'tray', 'dashboard']);
const secretId = z.enum([...LLM_PROVIDER_IDS, 'stt-custom']);
const permissionKind = z.enum(['microphone', 'accessibility', 'input-monitoring', 'automation', 'screen']);
const route = z.string().regex(/^\/[a-z0-9/-]*$/i).max(80);

export const SpeechStatsSchema = z.object({
  durationMs: z.number().nonnegative(),
  speechMs: z.number().nonnegative(),
  segments: z.number().int().nonnegative(),
  pauseCount: z.number().int().nonnegative(),
  longPauseCount: z.number().int().nonnegative(),
  meanPauseMs: z.number().nonnegative(),
  maxPauseMs: z.number().nonnegative(),
  speechLevelDb: z.number(),
});

export const CaptureEndReason = z.enum(['stopped', 'endpoint', 'max-duration', 'no-speech', 'cancelled', 'error']);

export const invokeSchemas = {
  'app:info': none,
  'settings:get': none,
  // Deep shape is validated by applySettingsPatch (SettingsSchema) in main.
  'settings:update': z.object({ patch: z.record(z.string(), z.unknown()) }),
  'secrets:status': none,
  'secrets:set': z.object({ id: secretId, value: z.string().trim().min(1).max(500) }),
  'secrets:clear': z.object({ id: secretId }),
  'providers:test': z.object({ kind: z.enum(['llm', 'stt']), providerId: z.string().max(40) }),
  'permissions:status': none,
  'permissions:request': z.object({ kind: permissionKind }),
  'permissions:openSettings': z.object({ kind: permissionKind }),
  'hotkeys:status': none,
  'history:list': z.object({
    query: text(200).optional(),
    mode: voiceMode.optional(),
    limit: z.number().int().min(1).max(500).optional(),
    before: z.string().datetime().optional(),
  }),
  'history:get': z.object({ id }),
  'history:delete': z.object({ id }),
  'history:clear': z.object({ confirm: z.literal(true) }),
  'history:repaste': z.object({ id }),
  'knowledge:list': z.object({ query: text(200).optional(), category: z.enum(FACT_CATEGORIES).optional() }),
  'knowledge:upsert': z.object({
    fact: z.object({
      id: id.optional(),
      category: z.enum(FACT_CATEGORIES),
      label: z.string().trim().min(1).max(80),
      value: z.string().trim().min(1).max(1000),
      pinned: z.boolean().optional(),
    }),
  }),
  'knowledge:delete': z.object({ id }),
  'knowledge:graph': none,
  'dictionary:list': none,
  'dictionary:upsert': z.object({
    entry: z.object({
      id: id.optional(),
      term: z.string().trim().min(1).max(80),
      replaces: z.array(z.string().trim().min(1).max(80)).max(20),
      note: text(200).optional(),
    }),
  }),
  'dictionary:delete': z.object({ id }),
  'documents:list': none,
  'documents:pick': none,
  'documents:importText': z.object({ name: z.string().trim().min(1).max(160), text: z.string().min(1).max(2_000_000) }),
  'documents:get': z.object({ id }),
  'documents:delete': z.object({ id }),
  'chat:list': none,
  'chat:get': z.object({ id }),
  'chat:create': none,
  'chat:rename': z.object({ id, title: z.string().trim().min(1).max(120) }),
  'chat:delete': z.object({ id }),
  'chat:send': z.object({ sessionId: id, text: z.string().trim().min(1).max(20_000) }),
  'notes:list': z.object({ query: text(200).optional() }),
  'notes:upsert': z.object({
    note: z.object({ id: id.optional(), title: z.string().max(200), body: z.string().max(100_000), pinned: z.boolean().optional() }),
  }),
  'notes:delete': z.object({ id }),
  'reminders:list': none,
  'reminders:create': z.object({
    kind: z.enum(['reminder', 'timer']),
    text: z.string().trim().min(1).max(300),
    dueAt: z.string().datetime().optional(),
    inMinutes: z.number().min(0.1).max(60 * 24 * 365).optional(),
    repeat: z.enum(['none', 'daily']).optional(),
  }).refine((v) => v.dueAt !== undefined || v.inMinutes !== undefined, 'dueAt or inMinutes is required'),
  'reminders:cancel': z.object({ id }),
  'insights:usage': z.object({ days: z.number().int().min(1).max(365) }),
  'insights:dynamics': z.object({ days: z.number().int().min(1).max(365) }),
  'voice:snapshot': none,
  'voice:start': z.object({ mode: voiceMode, source: voiceSource }),
  'voice:stop': none,
  'voice:cancel': none,
  'agent:ask': z.object({ text: z.string().trim().min(1).max(4000), source: z.enum(['palette', 'leafy', 'dashboard']) }),
  'agent:confirm': z.object({ runId: id, callId: id, approved: z.boolean() }),
  'agent:cancel': z.object({ runId: id }),
  'palette:search': z.object({ query: text(300), limit: z.number().int().min(1).max(50).optional() }),
  // Execute by id only: actions are resolved in main from its own cache, never trusted from the renderer.
  'palette:execute': z.object({ id, alt: z.boolean().optional() }),
  'palette:hide': none,
  'palette:resize': z.object({ height: z.number().int().min(80).max(720) }),
  'leafy:pointer': z.object({ interactive: z.boolean() }),
  'leafy:moveTo': z.object({ x: z.number().int(), y: z.number().int() }),
  'leafy:dragEnd': none,
  'leafy:menu': none,
  'leafy:position': none,
  'island:pointer': z.object({ interactive: z.boolean() }),
  'window:open': z.object({ target: z.enum(['dashboard', 'palette']), route: route.optional(), mode: z.enum(['search', 'voice']).optional() }),
  'window:close': none,
  'window:minimize': none,
  'data:export': none,
  'data:wipe': z.object({ confirm: z.literal('DELETE') }),
  'system:openExternal': z.object({ url: z.string().url().max(2000).refine((u) => /^https?:\/\//.test(u), 'http(s) only') }),
  'engine:ready': none,
  'engine:capture': z.object({
    requestId: id,
    reason: CaptureEndReason,
    wav: z.instanceof(Uint8Array).nullable(),
    stats: SpeechStatsSchema,
    error: text(500).optional(),
  }),
  'engine:clap': z.object({ at: z.number() }),
  'engine:voices': z.object({ voices: z.array(z.object({ name: text(120), lang: text(20), isDefault: z.boolean() })).max(400) }),
  'engine:error': z.object({ scope: z.enum(['mic', 'clap', 'wake', 'tts', 'capture']), message: text(500) }),
} satisfies Record<InvokeChannel, z.ZodType>;

/** "Hey Leafy" listens to 80 ms frames of 16 kHz PCM16. */
export const WAKE_FRAME_SAMPLES = 1280;

export const sendSchemas = {
  'engine:level': z.object({ level: z.number().min(0).max(1), bands: z.array(z.number().min(0).max(1)).max(32) }),
  'engine:wake-audio': z.object({
    samples: z.custom<Int16Array>((s) => s instanceof Int16Array && s.length === WAKE_FRAME_SAMPLES, `exactly ${WAKE_FRAME_SAMPLES} PCM16 samples`),
    /** First frame after a pause (capture, speech, a reopened microphone): the detector starts over. */
    fresh: z.boolean(),
  }),
} satisfies Record<SendChannel, z.ZodType>;

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeSchemas)[C]>;
export type SendPayload<C extends SendChannel> = z.input<(typeof sendSchemas)[C]>;

export type SecretStatus = Record<SecretId, { readonly set: boolean }>;
export interface ProviderTestResult { readonly ok: boolean; readonly latencyMs: number | null; readonly message: string }
export interface Ok { readonly ok: true }

/** What each invoke channel resolves to. */
export interface InvokeResultMap {
  'app:info': AppInfo;
  'settings:get': Settings;
  'settings:update': Settings;
  'secrets:status': SecretStatus;
  'secrets:set': SecretStatus;
  'secrets:clear': SecretStatus;
  'providers:test': ProviderTestResult;
  'permissions:status': PermissionStatus;
  'permissions:request': PermissionStatus;
  'permissions:openSettings': Ok;
  'hotkeys:status': readonly HotkeyStatus[];
  'history:list': readonly HistoryItem[];
  'history:get': HistoryItem | null;
  'history:delete': Ok;
  'history:clear': Ok;
  'history:repaste': { readonly pasted: boolean };
  'knowledge:list': readonly Fact[];
  'knowledge:upsert': Fact;
  'knowledge:delete': Ok;
  'knowledge:graph': KnowledgeGraph;
  'dictionary:list': readonly DictionaryEntry[];
  'dictionary:upsert': DictionaryEntry;
  'dictionary:delete': Ok;
  'documents:list': readonly DocumentMeta[];
  'documents:pick': readonly DocumentMeta[];
  'documents:importText': DocumentMeta;
  'documents:get': { readonly meta: DocumentMeta; readonly text: string } | null;
  'documents:delete': Ok;
  'chat:list': readonly ChatSummary[];
  'chat:get': ChatSession | null;
  'chat:create': ChatSession;
  'chat:rename': ChatSummary;
  'chat:delete': Ok;
  'chat:send': { readonly userMessageId: Id; readonly assistantMessageId: Id };
  'notes:list': readonly Note[];
  'notes:upsert': Note;
  'notes:delete': Ok;
  'reminders:list': readonly Reminder[];
  'reminders:create': Reminder;
  'reminders:cancel': Ok;
  'insights:usage': UsageSummary;
  'insights:dynamics': DynamicsSummary;
  'voice:snapshot': VoiceSnapshot;
  'voice:start': VoiceSnapshot;
  'voice:stop': VoiceSnapshot;
  'voice:cancel': VoiceSnapshot;
  'agent:ask': { readonly runId: Id };
  'agent:confirm': Ok;
  'agent:cancel': Ok;
  'palette:search': readonly SearchResult[];
  'palette:execute': { readonly ok: boolean; readonly message: string | null };
  'palette:hide': Ok;
  'palette:resize': Ok;
  'leafy:pointer': Ok;
  'leafy:moveTo': Ok;
  'leafy:dragEnd': Ok;
  'leafy:menu': Ok;
  'leafy:position': { readonly x: number; readonly y: number; readonly corner: 'left' | 'right' };
  'island:pointer': Ok;
  'window:open': Ok;
  'window:close': Ok;
  'window:minimize': Ok;
  'data:export': { readonly path: string };
  'data:wipe': Ok;
  'system:openExternal': Ok;
  'engine:ready': Ok;
  'engine:capture': Ok;
  'engine:clap': Ok;
  'engine:voices': Ok;
  'engine:error': Ok;
}

export type InvokeResult<C extends InvokeChannel> = InvokeResultMap[C];

/** Commands main sends to the hidden engine window. */
export type EngineCommand =
  | {
      readonly type: 'start';
      readonly requestId: Id;
      readonly deviceId: string | null;
      /** Hands-free endpointing; push-to-talk sends `enabled: false`. */
      readonly endpointing: { readonly enabled: boolean; readonly endSilenceMs: number; readonly noSpeechTimeoutMs: number };
      readonly maxDurationMs: number;
    }
  | { readonly type: 'stop'; readonly requestId: Id }
  | { readonly type: 'cancel'; readonly requestId: Id }
  | { readonly type: 'clap'; readonly enabled: boolean; readonly sensitivity: 'low' | 'medium' | 'high' }
  /** Stream 16 kHz frames for "Hey Leafy" to main (`engine:wake-audio`) while enabled. */
  | { readonly type: 'wake'; readonly enabled: boolean; readonly deviceId: string | null }
  | { readonly type: 'activity'; readonly userActive: boolean }
  | { readonly type: 'speak'; readonly text: string; readonly voiceName: string | null; readonly rate: number }
  | { readonly type: 'stop-speaking' }
  | { readonly type: 'cue'; readonly name: 'start' | 'stop' | 'success' | 'error' | 'clap' | 'confirm' | 'reminder' };

/** Payloads main pushes to renderers. */
export interface EventPayloadMap {
  'settings:changed': Settings;
  'voice:snapshot': VoiceSnapshot;
  'audio:level': AudioLevel;
  'agent:event': AgentEvent;
  'chat:event': ChatEvent;
  'data:changed': { readonly domain: DataDomain };
  'leafy:cue': LeafyCue;
  'navigate': { readonly route: string };
  'palette:open': { readonly mode: 'search' | 'voice'; readonly query: string | null };
  'engine:command': EngineCommand;
  'toast': Toast;
}

export type EventPayload<C extends EventChannel> = EventPayloadMap[C];

/** The bridge the preload exposes as `window.rivertide`. */
export interface RivertideBridge {
  invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>>;
  send<C extends SendChannel>(channel: C, payload: SendPayload<C>): void;
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void;
  readonly platform: 'darwin' | 'win32' | 'linux';
}

export type { SettingsPatch };
