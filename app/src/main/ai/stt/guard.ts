/**
 * Transcription response parsing and the hallucination guard (pure).
 * Whisper-family models invent text on silence ("Thank you.", "Thanks for watching."); those are
 * discarded when the audio has little or no speech.
 */
import { z } from 'zod';

export const NO_SPEECH_PROB_LIMIT = 0.6;
/** "you" / "Thank you." on clips with less speech than this are treated as hallucinations. */
export const SHORT_SPEECH_MS = 600;

/** Silence markers and video-caption phrases: never real dictation. */
const ALWAYS_HALLUCINATED = new Set([
  'thanks for watching.', 'thanks for watching!', 'thanks for watching', 'thank you for watching.', 'thank you for watching',
  '[blank_audio]', '(blank audio)', '[silence]', '(silence)', '[music]', '(music)', '[no speech]', '[inaudible]',
  'subtitles by the amara.org community', 'please subscribe.', 'like and subscribe.', '.', '…', '...',
]);
/** Plausible words that Whisper also invents on near-silence: dropped only with very little speech. */
const SHORT_HALLUCINATED = new Set(['you', 'you.', 'thank you', 'thank you.', 'thanks.', 'thanks', 'okay.', 'bye.', 'bye', 'so', 'so.', 'uh', 'um']);

const SegmentSchema = z.object({ text: z.string(), no_speech_prob: z.number().optional() }).passthrough();
const TranscriptionSchema = z.object({
  text: z.string(),
  segments: z.array(SegmentSchema).optional(),
}).passthrough();

export interface ParsedTranscription {
  readonly text: string;
  readonly noSpeech: boolean;
}

const normalise = (text: string): string => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** True when the text is empty or a known silence hallucination. `speechMs` null = unknown (markers only). */
export function isHallucination(text: string, speechMs: number | null): boolean {
  const value = normalise(text);
  if (!value) return true;
  if (ALWAYS_HALLUCINATED.has(value)) return true;
  return SHORT_HALLUCINATED.has(value) && speechMs !== null && speechMs < SHORT_SPEECH_MS;
}

/**
 * Parses an OpenAI-compatible transcription (json or verbose_json). With segments, drops those
 * whose `no_speech_prob` exceeds the limit; `noSpeech` is set when nothing usable remains.
 */
export function parseTranscription(raw: unknown, speechMs: number | null): ParsedTranscription | null {
  const parsed = TranscriptionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const segments = parsed.data.segments;
  const text = segments
    ? segments.filter((segment) => (segment.no_speech_prob ?? 0) <= NO_SPEECH_PROB_LIMIT).map((segment) => segment.text).join('').trim()
    : parsed.data.text.trim();
  const noSpeech = !text || isHallucination(text, speechMs);
  return { text: noSpeech ? '' : text.replace(/\s+/g, ' ').trim(), noSpeech };
}

/** Cleans whisper.cpp stdout (no timestamps, one line per segment). */
export function parseWhisperCliOutput(stdout: string, speechMs: number | null): ParsedTranscription {
  const text = stdout.split('\n').map((line) => line.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const noSpeech = !text || isHallucination(text, speechMs);
  return { text: noSpeech ? '' : text, noSpeech };
}

/** Duration of a PCM WAV from its header (16-bit mono 16 kHz from the engine); null if unreadable. */
export function wavDurationMs(wav: Uint8Array): number | null {
  if (wav.byteLength < 44) return null;
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const riff = String.fromCharCode(wav[0], wav[1], wav[2], wav[3]);
  if (riff !== 'RIFF') return null;
  const byteRate = view.getUint32(28, true);
  if (byteRate === 0) return null;
  return Math.round(((wav.byteLength - 44) / byteRate) * 1000);
}

/** A tiny valid silent WAV (for provider tests). */
export function silentWav(durationMs = 500, sampleRate = 16_000): Uint8Array {
  const samples = Math.round((durationMs / 1000) * sampleRate);
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}
