/**
 * Everything the engine tells main goes through here: typed, size-limited to the contract's
 * schemas, and never throwing (a failed report falls back to the console as a last resort).
 */
import type { InvokeChannel, SendChannel } from '@shared/ipc-channels';
import type { InvokeRequest, SendPayload } from '@shared/ipc';
import type { AudioLevel } from '@shared/types';

export type ErrorScope = 'mic' | 'clap' | 'wake' | 'tts' | 'capture';
export type CapturePayload = InvokeRequest<'engine:capture'>;
export type CaptureReason = CapturePayload['reason'];

export interface VoiceInfo {
  readonly name: string;
  readonly lang: string;
  readonly isDefault: boolean;
}

/** The two bridge calls the engine needs (satisfied by lib/ipc.ts, faked in tests). */
export interface EngineBridge {
  invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<unknown>;
  send<C extends SendChannel>(channel: C, payload: SendPayload<C>): void;
}

export interface Reporter {
  ready(): Promise<void>;
  capture(payload: CapturePayload): Promise<void>;
  clap(at: number): void;
  voices(list: readonly VoiceInfo[]): void;
  error(scope: ErrorScope, message: string): void;
  level(level: AudioLevel): void;
  /** One 80 ms frame of 16 kHz PCM16 for "Hey Leafy" (`fresh` = first frame after a pause). */
  wakeAudio(samples: Int16Array, fresh: boolean): void;
}

const MAX_MESSAGE = 500;
const MAX_VOICES = 400;
const MAX_VOICE_NAME = 120;
const MAX_VOICE_LANG = 20;
const MAX_BANDS = 32;

export function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'Unknown error.';
}

export function clampMessage(message: string): string {
  const trimmed = message.trim() || 'Something went wrong in the audio engine.';
  return trimmed.length > MAX_MESSAGE ? `${trimmed.slice(0, MAX_MESSAGE - 1)}…` : trimmed;
}

/** Sanitises speechSynthesis voices to the `engine:voices` schema (dedupes, truncates, caps). */
export function toVoiceList(voices: readonly { name: string; lang: string; default: boolean }[]): VoiceInfo[] {
  const seen = new Set<string>();
  return voices
    .map((v) => ({ name: String(v.name).slice(0, MAX_VOICE_NAME), lang: String(v.lang).slice(0, MAX_VOICE_LANG), isDefault: v.default === true }))
    .filter((v) => {
      const key = `${v.name}\u0000${v.lang}`;
      if (!v.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_VOICES);
}

function clampLevel(level: AudioLevel): SendPayload<'engine:level'> {
  const unit = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return { level: unit(level.level), bands: level.bands.slice(0, MAX_BANDS).map(unit) };
}

export function createReporter(bridge: EngineBridge, lastResort: (message: string, error: unknown) => void = defaultLastResort): Reporter {
  const fire = (label: string, promise: Promise<unknown>): Promise<void> =>
    promise.then(() => undefined, (error: unknown) => lastResort(`engine: ${label} report failed`, error));

  const reportError = (scope: ErrorScope, message: string): void => {
    void fire('error', bridge.invoke('engine:error', { scope, message: clampMessage(message) }));
  };

  const capture = async (payload: CapturePayload): Promise<void> => {
    const safe = payload.error === undefined ? payload : { ...payload, error: clampMessage(payload.error) };
    try {
      await bridge.invoke('engine:capture', safe);
    } catch (error) {
      // Never leave main waiting on a request: retry once without the audio.
      lastResort('engine: capture report failed, retrying without audio', error);
      const fallback = { ...safe, reason: 'error' as const, wav: null, error: 'The recording could not be handed over. Please try again.' };
      await fire('capture fallback', bridge.invoke('engine:capture', fallback));
    }
  };

  return {
    ready: () => fire('ready', bridge.invoke('engine:ready', undefined)),
    capture,
    clap: (at) => void fire('clap', bridge.invoke('engine:clap', { at })),
    voices: (list) => void fire('voices', bridge.invoke('engine:voices', { voices: [...list] })),
    error: reportError,
    level: (level) => {
      try {
        bridge.send('engine:level', clampLevel(level));
      } catch (error) {
        lastResort('engine: level send failed', error);
      }
    },
    wakeAudio: (samples, fresh) => {
      try {
        bridge.send('engine:wake-audio', { samples, fresh });
      } catch (error) {
        lastResort('engine: wake audio send failed', error);
      }
    },
  };
}

function defaultLastResort(message: string, error: unknown): void {
  // The bridge itself failed, so there is no other channel left to report on.
  console.error(message, error);
}
