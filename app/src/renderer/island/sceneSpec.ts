/**
 * Pure mapping from the voice snapshot to what the Dynamic Island shows: which shape, how big,
 * and which content. No React here, so every state is unit-testable; IslandScenes.tsx renders it.
 */
import type { IslandMode, IslandSize, IslandSizes } from '@rivertide/island';
import type { PendingConfirmation, VoiceErrorCode, VoiceMode, VoiceSnapshot } from '@shared/types';
import { pasteShortcut, type Platform } from '../lib/hooks/accelerator';
import { toolIconName, type IconName } from '../lib/hooks/iconNames';
import { clamp, estimateLines, headText, tailText } from '../lib/hooks/text';
import { MODE_LABEL, workingLabel } from '../lib/hooks/voiceCopy';

/** Desktop-sized capsule: a little larger than a phone's. */
export const ISLAND_SIZES: IslandSizes = {
  compact: { width: 180, height: 36 },
  stretched: { width: 320, height: 40 },
  large: { width: 420, height: 200 },
  bubble: 40,
  radius: 28,
};

const PILL_HEIGHT = 40;
const LISTENING_WIDTH = 320;
/** Room for the cancel button that slides in on hover. */
const CANCEL_ROOM = 36;
const ERROR_PILL_WIDTH = 380;
const CARD_WIDTH = 400;
const REPLY_WIDTH = 420;
const SHORT_RESULT_CHARS = 34;
const SHORT_ERROR_CHARS = 42;
const CARD_CHARS_PER_LINE = 50;
const REPLY_MAX_LINES = 4;
const LINE_HEIGHT = 21;
const LARGE_MAX_HEIGHT = 200;

export type IslandView =
  | { readonly kind: 'listening'; readonly mode: VoiceMode; readonly locked: boolean; readonly hovered: boolean }
  | { readonly kind: 'working'; readonly label: string; readonly preview: string }
  | { readonly kind: 'acting'; readonly detail: string; readonly icon: IconName }
  | { readonly kind: 'confirming'; readonly confirmation: PendingConfirmation }
  | { readonly kind: 'result'; readonly heading: string; readonly ok: boolean; readonly text: string; readonly layout: 'pill' | 'card' }
  | { readonly kind: 'reply'; readonly text: string; readonly speaking: boolean; readonly lines: number }
  | { readonly kind: 'error'; readonly message: string; readonly retry: boolean; readonly settings: boolean; readonly layout: 'pill' | 'card' };

export interface IslandSceneSpec {
  readonly id: string;
  readonly mode: IslandMode;
  readonly size: IslandSize;
  /** What assistive tech hears when the scene appears. */
  readonly label: string;
  readonly view: IslandView;
}

export interface IslandInput {
  readonly snapshot: VoiceSnapshot;
  /** Tool currently running (from `agent:event`), for the acting bubble's icon. */
  readonly tool: string | null;
  readonly hovered: boolean;
  readonly platform?: Platform;
}

/** Errors that need a setting changed rather than another try. */
const SETTINGS_ERRORS: ReadonlySet<VoiceErrorCode> = new Set(['mic-denied', 'stt-not-configured', 'llm-not-configured']);
const NO_RETRY_ERRORS: ReadonlySet<VoiceErrorCode> = new Set(['cancelled', 'paste-failed']);

/** Retry restarts hands-free capture, which only makes sense for Leafy commands (fn is held by hand). */
export function errorActions(code: VoiceErrorCode, mode: VoiceMode | null): { readonly retry: boolean; readonly settings: boolean } {
  const settings = SETTINGS_ERRORS.has(code);
  return { settings, retry: !settings && !NO_RETRY_ERRORS.has(code) && mode === 'command' };
}

/** Pill width that fits `text` at ~7.4 px per character plus chrome. */
export function pillWidthFor(text: string, chrome: number, min: number, max: number): number {
  return Math.round(clamp(chrome + text.length * 7.4, min, max));
}

function cardHeight(lines: number, chrome: number): number {
  return Math.round(clamp(chrome + lines * LINE_HEIGHT, 72, LARGE_MAX_HEIGHT));
}

const sceneId = (snapshot: VoiceSnapshot, kind: string) => `${snapshot.sessionId ?? 'session'}:${kind}`;

function listeningSpec(snapshot: VoiceSnapshot, hovered: boolean): IslandSceneSpec {
  const mode = snapshot.mode ?? 'dictate';
  return {
    id: sceneId(snapshot, 'listening'),
    mode: 'stretched',
    size: { width: LISTENING_WIDTH + (hovered ? CANCEL_ROOM : 0), height: PILL_HEIGHT },
    label: snapshot.locked ? `Listening, locked on (${MODE_LABEL[mode]})` : `Listening (${MODE_LABEL[mode]})`,
    view: { kind: 'listening', mode, locked: snapshot.locked, hovered },
  };
}

function workingSpec(snapshot: VoiceSnapshot): IslandSceneSpec {
  const label = workingLabel(snapshot);
  return {
    id: sceneId(snapshot, snapshot.phase),
    mode: 'stretched',
    size: ISLAND_SIZES.stretched,
    label: label.replace('…', ''),
    view: { kind: 'working', label, preview: snapshot.transcript ? tailText(snapshot.transcript, 30) : '' },
  };
}

function actingSpec(snapshot: VoiceSnapshot, tool: string | null): IslandSceneSpec {
  const detail = headText(snapshot.detail ?? 'Working on it', 40);
  return {
    id: sceneId(snapshot, 'acting'),
    mode: 'split',
    size: { width: pillWidthFor(detail, 64, 180, 320), height: PILL_HEIGHT },
    label: detail,
    view: { kind: 'acting', detail, icon: toolIconName(tool, snapshot.detail) },
  };
}

function confirmingSpec(snapshot: VoiceSnapshot, confirmation: PendingConfirmation): IslandSceneSpec {
  const lines = clamp(estimateLines(confirmation.summary, CARD_CHARS_PER_LINE), 1, 3);
  return {
    id: `${sceneId(snapshot, 'confirm')}:${confirmation.callId}`,
    mode: 'large',
    size: { width: CARD_WIDTH, height: cardHeight(lines, 128) },
    label: `Leafy asks: ${confirmation.title}. ${confirmation.summary}`,
    view: { kind: 'confirming', confirmation },
  };
}

function resultSpec(snapshot: VoiceSnapshot, platform: Platform): IslandSceneSpec {
  const text = snapshot.output || snapshot.transcript;
  const verb = snapshot.mode === 'ask' ? 'Answer' : '';
  const heading = snapshot.pasted ? (verb ? `${verb} pasted` : 'Pasted') : `Copied — press ${pasteShortcut(platform)} to paste`;
  const short = snapshot.pasted && text.length <= SHORT_RESULT_CHARS;
  return {
    id: sceneId(snapshot, 'done'),
    mode: short ? 'stretched' : 'large',
    size: short ? ISLAND_SIZES.stretched : { width: CARD_WIDTH, height: cardHeight(Math.min(2, estimateLines(text, CARD_CHARS_PER_LINE)), 62) },
    label: `${heading}. ${headText(text, 120)}`,
    view: { kind: 'result', heading, ok: snapshot.pasted, text, layout: short ? 'pill' : 'card' },
  };
}

function replySpec(snapshot: VoiceSnapshot): IslandSceneSpec {
  const text = snapshot.output.trim() || 'Done.';
  const lines = clamp(estimateLines(text, CARD_CHARS_PER_LINE + 4), 1, REPLY_MAX_LINES);
  const speaking = snapshot.phase === 'speaking';
  return {
    id: sceneId(snapshot, 'reply'),
    mode: 'large',
    size: { width: REPLY_WIDTH, height: cardHeight(lines, 64) },
    label: text,
    view: { kind: 'reply', text, speaking, lines },
  };
}

function errorSpec(snapshot: VoiceSnapshot): IslandSceneSpec {
  const error = snapshot.error ?? { code: 'unknown' as const, message: 'Something went wrong. Try again.' };
  const actions = errorActions(error.code, snapshot.mode);
  const pill = !actions.settings && error.message.length <= SHORT_ERROR_CHARS;
  const lines = clamp(estimateLines(error.message, CARD_CHARS_PER_LINE), 1, 3);
  return {
    id: sceneId(snapshot, 'error'),
    mode: pill ? 'stretched' : 'large',
    size: pill ? { width: ERROR_PILL_WIDTH, height: PILL_HEIGHT } : { width: CARD_WIDTH, height: cardHeight(lines, 96) },
    label: error.message,
    view: { kind: 'error', message: error.message, retry: actions.retry, settings: actions.settings, layout: pill ? 'pill' : 'card' },
  };
}

/** The scene for this moment, or null when the island should rest (idle, or a quiet cancel). */
export function buildIslandSpec({ snapshot, tool, hovered, platform = 'darwin' }: IslandInput): IslandSceneSpec | null {
  switch (snapshot.phase) {
    case 'listening':
      return listeningSpec(snapshot, hovered);
    case 'transcribing':
    case 'thinking':
      return workingSpec(snapshot);
    case 'acting':
      return actingSpec(snapshot, tool);
    case 'confirming':
      return snapshot.pending ? confirmingSpec(snapshot, snapshot.pending) : workingSpec(snapshot);
    case 'speaking':
      return replySpec(snapshot);
    case 'done':
      return snapshot.mode === 'command' ? replySpec(snapshot) : resultSpec(snapshot, platform);
    case 'error':
      return snapshot.error?.code === 'cancelled' ? null : errorSpec(snapshot);
    default:
      return null;
  }
}
