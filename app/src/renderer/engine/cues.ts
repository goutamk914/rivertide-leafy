/** Plays the cue notes with Web Audio: one oscillator per note, exponential envelopes, no assets. */
import type { AudioHub } from './audio-hub';
import type { CueName } from './commands';
import { CUE_ATTACK_MS, CUE_NOTES, CUE_SILENCE_GAIN, MAX_CUE_GAIN, cueDurationMs, type CueNote } from './cue-notes';

/** Small lead so notes are scheduled slightly in the future (no clipped first attack). */
const SCHEDULE_LEAD_S = 0.02;
const RELEASE_MARGIN_MS = 80;

function scheduleNote(context: AudioContext, destination: AudioNode, note: CueNote, startAt: number): void {
  const t0 = startAt + note.atMs / 1000;
  const peakAt = t0 + Math.min(CUE_ATTACK_MS, note.durationMs / 2) / 1000;
  const end = t0 + note.durationMs / 1000;
  const peak = Math.min(MAX_CUE_GAIN, Math.max(CUE_SILENCE_GAIN * 2, note.gain));

  const osc = new OscillatorNode(context, { type: 'sine', frequency: note.hz });
  if (note.toHz !== undefined) {
    osc.frequency.setValueAtTime(note.hz, t0); // anchor the glide at the note start
    osc.frequency.exponentialRampToValueAtTime(note.toHz, end);
  }
  const gain = new GainNode(context, { gain: CUE_SILENCE_GAIN });
  gain.gain.setValueAtTime(CUE_SILENCE_GAIN, t0);
  gain.gain.exponentialRampToValueAtTime(peak, peakAt);
  gain.gain.exponentialRampToValueAtTime(CUE_SILENCE_GAIN, end);
  osc.connect(gain);
  gain.connect(destination);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
  osc.start(t0);
  osc.stop(end + 0.02);
}

export class CuePlayer {
  private readonly hub: AudioHub;
  private counter = 0;

  constructor(hub: AudioHub) {
    this.hub = hub;
  }

  async play(name: CueName): Promise<void> {
    this.counter += 1;
    const holder = `cue:${this.counter}`;
    const context = await this.hub.acquire(holder);
    try {
      const startAt = context.currentTime + SCHEDULE_LEAD_S;
      for (const note of CUE_NOTES[name]) scheduleNote(context, context.destination, note, startAt);
    } finally {
      setTimeout(() => this.hub.release(holder), cueDurationMs(name) + RELEASE_MARGIN_MS);
    }
  }
}
