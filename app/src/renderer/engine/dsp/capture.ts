/**
 * The DOM-free half of a capture: device-rate Float32 blocks in → 16 kHz resampling → VAD +
 * PCM16 accumulation → endpointing decisions → trimmed 16 kHz mono WAV + speech stats out.
 */
import type { SpeechStats } from '@shared/types';
import { Resampler } from './resampler';
import { TARGET_SAMPLE_RATE, TRIM } from './tuning';
import { Vad, type EndpointingConfig, type VadStopReason } from './vad';
import { concatInt16, encodeWavPcm16, floatToPcm16 } from './wav';

export interface CaptureConfig {
  readonly inputRate: number;
  readonly endpointing: EndpointingConfig;
  readonly maxDurationMs: number;
}

export interface CaptureOutcome {
  /** Null when no speech was detected at all. */
  readonly wav: Uint8Array<ArrayBuffer> | null;
  readonly stats: SpeechStats;
  readonly hasSpeech: boolean;
}

export const EMPTY_STATS: SpeechStats = {
  durationMs: 0,
  speechMs: 0,
  segments: 0,
  pauseCount: 0,
  longPauseCount: 0,
  meanPauseMs: 0,
  maxPauseMs: 0,
  speechLevelDb: -100,
};

/** Sample range to keep: first speech − pre-roll … last speech + post-roll. */
export function trimRange(
  segmentsMs: readonly { readonly startMs: number; readonly endMs: number }[],
  totalSamples: number,
  sampleRate: number,
  trim: typeof TRIM = TRIM,
): { readonly start: number; readonly end: number } | null {
  if (segmentsMs.length === 0) return null;
  const toSamples = (ms: number) => Math.round((ms * sampleRate) / 1000);
  const start = Math.max(0, toSamples(segmentsMs[0].startMs - trim.preRollMs));
  const end = Math.min(totalSamples, toSamples(segmentsMs[segmentsMs.length - 1].endMs + trim.postRollMs));
  return end > start ? { start, end } : null;
}

export class CapturePipeline {
  private readonly config: CaptureConfig;
  private readonly resampler: Resampler;
  private readonly vad: Vad;
  /** Owned accumulation buffer (appending by copy would be quadratic over a 10-minute capture). */
  private chunks: Int16Array[] = [];
  private finished = false;

  constructor(config: CaptureConfig) {
    this.config = config;
    this.resampler = new Resampler(config.inputRate, TARGET_SAMPLE_RATE);
    this.vad = new Vad(TARGET_SAMPLE_RATE);
  }

  get elapsedMs(): number {
    return this.vad.elapsedMs;
  }

  /** Adds device-rate audio; returns a reason when the capture should stop by itself. */
  push(samples: Float32Array): VadStopReason | null {
    if (this.finished) return null;
    this.append(this.resampler.push(samples));
    return this.vad.decide(this.config.endpointing, this.config.maxDurationMs);
  }

  /** Ends the capture. Safe to call once; later calls return an empty outcome. */
  finish(): CaptureOutcome {
    if (this.finished) return { wav: null, stats: EMPTY_STATS, hasSpeech: false };
    this.append(this.resampler.flush());
    this.finished = true;
    const summary = this.vad.finish();
    const pcm = concatInt16(this.chunks);
    this.chunks = [];
    const range = summary.hasSpeech ? trimRange(summary.segmentsMs, pcm.length, TARGET_SAMPLE_RATE) : null;
    const wav = range ? encodeWavPcm16(pcm.subarray(range.start, range.end), TARGET_SAMPLE_RATE) : null;
    return { wav, stats: summary.stats, hasSpeech: wav !== null };
  }

  private append(samples: Float32Array): void {
    if (samples.length === 0) return;
    this.vad.push(samples);
    this.chunks.push(floatToPcm16(samples));
  }
}
