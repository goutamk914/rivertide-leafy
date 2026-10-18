/**
 * Every tunable number of the audio engine lives here, so the integrator can adjust behaviour
 * after listening on a real microphone without hunting through the DSP code.
 * Times are milliseconds, levels dBFS (RMS, full-scale square = 0 dBFS), differences dB.
 */

/** Sample rate of the WAV handed to speech-to-text. */
export const TARGET_SAMPLE_RATE = 16_000;

/** Windowed-sinc (Kaiser) polyphase resampler used before the VAD and WAV encoder. */
export const RESAMPLER = {
  /** Passband edge as a fraction of the lower Nyquist rate (6.8 kHz when writing 16 kHz). */
  passbandRatio: 0.85,
  /** Stopband edge as a fraction of the lower Nyquist rate (7.8 kHz when writing 16 kHz). */
  stopbandRatio: 0.975,
  /** Stopband attenuation the Kaiser design aims for. */
  attenuationDb: 80,
  /** Fractional-delay phases kept in the coefficient table (odd rates are quantised to this). */
  maxPhases: 1024,
} as const;

/** Energy + zero-crossing voice activity detector (runs on 16 kHz audio). */
export const VAD = {
  frameMs: 20,
  /** A frame is speech when its energy is this far above the adaptive noise floor. */
  speechMarginDb: 9,
  /** Never call anything quieter than this speech, whatever the floor says. */
  absoluteMinSpeechDb: -55,
  /** Unvoiced sounds (s, f, sh) keep an ongoing segment alive at a lower margin when noisy (high ZCR). */
  unvoicedMarginDb: 6,
  unvoicedZcrMin: 0.25,
  unvoicedAbsoluteMinDb: -65,
  /** Stay "in speech" this long after the last speech frame. */
  hangoverMs: 200,
  /** Shorter bursts (clicks, bumps) are not speech. */
  minSpeechMs: 60,
  /** Gaps shorter than this are part of the same segment; longer ones are pauses. */
  minPauseMs: 250,
  longPauseMs: 2000,
  /** Noise floor = running minimum over this window, allowed to rise only this fast. */
  floorWindowMs: 1000,
  floorRiseDbPerSecond: 8,
  floorMinDb: -80,
  /** The first frame seeds the floor, capped here so speech at t=0 is still detected. */
  initialFloorCeilingDb: -50,
  /** Reported level for "no speech at all" and the energy of digital silence. */
  silenceDb: -100,
} as const;

/** Leading/trailing silence trimmed from the WAV; the margins keep first and last syllables. */
export const TRIM = {
  preRollMs: 500,
  postRollMs: 600,
} as const;

/** Level meter for the island waveform. */
export const LEVEL = {
  /** Perceptual scale: this RMS maps to 0 … */
  minDb: -60,
  /** … and this to 1. */
  maxDb: -10,
  /** smoothed = smoothing·prev + (1 − smoothing)·current. */
  smoothing: 0.75,
  /** Envelope holds peaks and decays by this factor per update. */
  peakDecay: 0.9,
  bandCount: 12,
  bandMinHz: 80,
  bandMaxHz: 8000,
  fftSize: 2048,
  /** Per-band scale (relative to a full-scale sine in one bin). */
  bandMinDb: -80,
  bandMaxDb: -30,
  /** Speech spectra fall ~3 dB/octave; lift highs so the bars look even. */
  bandTiltDbPerOctave: 3,
  bandTiltPivotHz: 500,
  /** engine:level is sent at most this often. */
  maxRateHz: 30,
} as const;

export type ClapSensitivity = 'low' | 'medium' | 'high';

/** Double-clap detector, ARCHITECTURE.md §3.12. */
export const CLAP = {
  fftSize: 512,
  hop: 256,
  bandLowHz: 2000,
  bandHighHz: 8000,
  fluxLowHz: 1000,
  fluxHighHz: 10_000,
  /** Noise floor: running percentile of band energy, frozen during events. */
  floorPercentile: 0.2,
  floorWindowMs: 3000,
  floorMinDb: -70,
  /** Candidates are ignored until this much floor history exists. */
  floorWarmupMs: 500,
  /** Detection pauses while the room is louder than this. */
  maxFloorDb: -35,
  /** Required prominence E − F per sensitivity. */
  thresholdDb: { low: 18, medium: 15, high: 12 } satisfies Record<ClapSensitivity, number>,
  /** E − E_prev, where E_prev is the quietest of the previous `onsetLookbackHops` hops. */
  minRiseDb: 8,
  /** A bin counts toward the flux ratio when it rose at least this much. */
  binRiseDb: 8,
  /**
   * Hops E_prev and the per-bin flux reference look back over (their minimum is used).
   * 1 = the previous hop, exactly as specified. 2 catches claps whose attack straddles two hops a
   * little more consistently near threshold (measured on synthetic claps); try it if real claps
   * are missed.
   */
  onsetLookbackHops: 1,
  minFluxRatio: 0.5,
  minFlatness: 0.25,
  peakSearchHops: 3,
  minDecayDb: 12,
  decayWindowMs: 80,
  minCrest: 5,
  crestWindowMs: 50,
  /** The crest window starts this long before the loudest sample. */
  crestPreMs: 10,
  refractoryMs: 100,
  pairMinMs: 150,
  pairMaxMs: 750,
  pairMaxPeakDiffDb: 8,
  /** Between the claps the band energy must dip to within this of the floor. */
  betweenNearFloorDb: 6,
  isolationBeforeMs: 400,
  isolationAfterMs: 350,
  cooldownMs: 1500,
} as const;

/** Runtime behaviour of the engine window (not DSP). */
export const ENGINE = {
  /** The worklet posts blocks of about this many milliseconds. */
  workletBatchMs: 20,
  /** Keep the capture stream warm this long after a capture so the next start is instant. */
  streamReleaseMs: 5000,
  /** After `stop`, wait this long for the worklet's last partial block. */
  flushWaitMs: 60,
  /** Wall-clock safety net on top of the audio-clock max duration. */
  maxDurationGraceMs: 2000,
  /** getUserMedia can wait on a permission prompt; give up after this. */
  micOpenTimeoutMs: 20_000,
  /** AudioContext.resume() can hang when autoplay is blocked. */
  contextResumeTimeoutMs: 3000,
  /** Suspend the AudioContext after this long with nothing using it. */
  contextIdleSuspendMs: 4000,
  /** speechSynthesis sometimes never fires `end`; poll its `speaking` flag. */
  ttsPollMs: 500,
  /** Chrome cuts long utterances; speak at most this many characters at once. */
  ttsMaxChunkChars: 220,
} as const;
