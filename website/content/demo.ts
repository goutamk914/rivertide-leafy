/**
 * Example speech for the demos. Every word is something a tired person might really say; the
 * cleaned text is what Rivertide's polish step returns for it. Commas mark where the speaker paused.
 */

/** Hero: hold fn and this is what Rivertide hears, one word at a time. */
export const HERO_WORDS = [
  'I', 'need', 'to', 'call,', 'no', 'wait,', 'I', 'need', 'to', 'email,', 'um,', 'the', 'doctor', 'about',
  'um,', 'the', 'appointment', 'on', 'um,', 'Thursday,', 'actually', 'Friday.',
] as const;

export interface Checkpoint {
  /** Number of words heard when this cleaned version becomes available. */
  readonly heard: number;
  readonly cleaned: string;
  /** Indexes into HERO_WORDS that polishing removes (fillers, false starts, words taken back). */
  readonly dropped: readonly number[];
}

const FALSE_START = [0, 1, 2, 3, 4, 5];

/** Let go early and you still get a clean sentence for what you said so far. */
export const HERO_CHECKPOINTS: readonly Checkpoint[] = [
  { heard: 4, cleaned: 'I need to call.', dropped: [] },
  { heard: 10, cleaned: 'I need to email.', dropped: FALSE_START },
  { heard: 15, cleaned: 'I need to email the doctor.', dropped: [...FALSE_START, 10, 13, 14] },
  { heard: 20, cleaned: 'I need to email the doctor about the appointment on Thursday.', dropped: [...FALSE_START, 10, 14, 18] },
  { heard: 22, cleaned: 'I need to email the doctor about the appointment on Friday.', dropped: [...FALSE_START, 10, 14, 18, 19, 20] },
];

/** The most complete cleaned version for this many heard words, or null if nothing usable yet. */
export function checkpointFor(heard: number): Checkpoint | null {
  let best: Checkpoint | null = null;
  for (const checkpoint of HERO_CHECKPOINTS) {
    if (checkpoint.heard <= heard) best = checkpoint;
  }
  return best;
}

export interface SpokenWord {
  readonly text: string;
  /** Polishing removes it: a filler, a restart, or something the speaker took back. */
  readonly drop?: boolean;
}

const w = (text: string): SpokenWord => ({ text });
const d = (text: string): SpokenWord => ({ text, drop: true });

/** "Messy in, clear out": a longer transcript whose fillers fall away as you scroll. */
export const MESSY_WORDS: readonly SpokenWord[] = [
  d('So'), d('um,'), d('I'), d('wanted'), d('to,'), w('I'), w('wanted'), w('to'), w('ask'), w('whether'), d('the,'),
  w('the'), w('nurse'), w('can'), w('move'), w('my'), w('infusion'), w('to,'), d('uh,'), d('Tuesday'), d('morning?'),
  d('No,'), w('Wednesday'), w('morning.'), w('Because'), d('my,'), d('um,'), w('my'), w('daughter'), w('can'),
  w('drive'), w('me'), w('then.'),
];

export const MESSY_CLEAN =
  'I wanted to ask whether the nurse can move my infusion to Wednesday morning, because my daughter can drive me then.';
