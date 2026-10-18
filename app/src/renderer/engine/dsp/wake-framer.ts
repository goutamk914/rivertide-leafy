/**
 * Turns the microphone's native-rate blocks into the 80 ms, 16 kHz PCM16 frames the "Hey Leafy"
 * detector expects. The resampler keeps its state between blocks, so frames are seamless.
 */
import { WAKE_FRAME_SAMPLES } from '@shared/ipc';
import { Resampler } from './resampler';
import { TARGET_SAMPLE_RATE } from './tuning';
import { floatToPcm16 } from './wav';

export class WakeFramer {
  private readonly resampler: Resampler;
  private pending = new Float32Array(0);

  constructor(inputRate: number) {
    this.resampler = new Resampler(inputRate, TARGET_SAMPLE_RATE);
  }

  /** Adds a block; returns every complete frame (possibly none). */
  push(block: Float32Array): Int16Array[] {
    const resampled = this.resampler.push(block);
    const joined = new Float32Array(this.pending.length + resampled.length);
    joined.set(this.pending);
    joined.set(resampled, this.pending.length);
    const frames: Int16Array[] = [];
    let start = 0;
    for (; start + WAKE_FRAME_SAMPLES <= joined.length; start += WAKE_FRAME_SAMPLES) {
      frames.push(floatToPcm16(joined.subarray(start, start + WAKE_FRAME_SAMPLES)));
    }
    this.pending = joined.slice(start);
    return frames;
  }
}
