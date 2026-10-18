/**
 * Text-to-speech through the window's speechSynthesis. Speaks sentence chunks back to back,
 * reports whether it is speaking (clap detection and the synthetic waveform depend on it), and
 * recovers when the browser never fires `end` by polling `speaking`.
 */
import { ENGINE } from './dsp/tuning';
import { describeError, type Reporter } from './report';
import { splitForSpeech } from './sentences';

/** The parts of the Web Speech API the speaker uses (faked in tests). */
export interface SpeechPort {
  readonly synth: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices' | 'speaking' | 'pending'>;
  createUtterance(text: string): SpeechSynthesisUtterance;
}

const MIN_RATE = 0.5;
const MAX_RATE = 2;
/** Errors that just mean "we interrupted it ourselves". */
const BENIGN_ERRORS = new Set(['canceled', 'interrupted']);
const IDLE_POLLS_BEFORE_DONE = 2;

export function findVoice(voices: readonly SpeechSynthesisVoice[], name: string | null): SpeechSynthesisVoice | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  return voices.find((v) => v.name === name) ?? voices.find((v) => v.name.toLowerCase() === lower) ?? null;
}

export class Speaker {
  private readonly port: SpeechPort;
  private readonly report: Reporter;
  private readonly onSpeakingChange: (speaking: boolean) => void;
  private generation = 0;
  private speaking = false;
  private poll: ReturnType<typeof setInterval> | null = null;
  private idlePolls = 0;

  constructor(port: SpeechPort, report: Reporter, onSpeakingChange: (speaking: boolean) => void) {
    this.port = port;
    this.report = report;
    this.onSpeakingChange = onSpeakingChange;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  speak(text: string, voiceName: string | null, rate: number): void {
    this.stop();
    const parts = splitForSpeech(text);
    if (parts.length === 0) return;
    const generation = this.generation;
    const voice = findVoice(this.port.synth.getVoices(), voiceName);
    const clampedRate = Math.min(MAX_RATE, Math.max(MIN_RATE, Number.isFinite(rate) ? rate : 1));
    this.setSpeaking(true);
    parts.forEach((part, index) => {
      const utterance = this.port.createUtterance(part);
      if (voice) utterance.voice = voice;
      utterance.rate = clampedRate;
      if (index === parts.length - 1) utterance.onend = () => this.finish(generation);
      utterance.onerror = (event) => this.onUtteranceError(generation, event.error);
      this.port.synth.speak(utterance);
    });
    this.startPolling(generation);
  }

  /** Stops speaking now (idempotent). */
  stop(): void {
    this.generation += 1;
    this.stopPolling();
    if (this.speaking || this.port.synth.speaking || this.port.synth.pending) {
      try {
        this.port.synth.cancel();
      } catch (error) {
        this.report.error('tts', `Speech could not be stopped: ${describeError(error)}`);
      }
    }
    this.setSpeaking(false);
  }

  private onUtteranceError(generation: number, code: string): void {
    if (generation !== this.generation) return;
    if (!BENIGN_ERRORS.has(code)) this.report.error('tts', `Leafy couldn't speak that answer (${code}). The text is still on screen.`);
    this.stop();
  }

  private finish(generation: number): void {
    if (generation !== this.generation) return;
    this.stopPolling();
    this.setSpeaking(false);
  }

  private startPolling(generation: number): void {
    this.idlePolls = 0;
    this.poll = setInterval(() => {
      const busy = this.port.synth.speaking || this.port.synth.pending;
      this.idlePolls = busy ? 0 : this.idlePolls + 1;
      if (this.idlePolls >= IDLE_POLLS_BEFORE_DONE) this.finish(generation);
    }, ENGINE.ttsPollMs);
  }

  private stopPolling(): void {
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }

  private setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    this.onSpeakingChange(speaking);
  }
}
