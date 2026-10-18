import type { PoseName } from './poses';

/** What Leafy is doing. Every surface (pet, palette, island, website) speaks in moods, never raw poses. */
export type LeafyMood =
  | 'idle'
  | 'greeting'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'searching'
  | 'speaking'
  | 'writing'
  | 'success'
  | 'error'
  | 'confirm'
  | 'clap'
  | 'notify'
  | 'caring'
  | 'celebrate'
  | 'sleeping'
  | 'yawning'
  | 'dragging'
  | 'dropped';

export interface AnimationStep {
  readonly pose: PoseName;
  readonly ms: number;
  /** Body lift in grid pixels for this step (negative = up). */
  readonly offsetY?: number;
}

export interface LeafyAnimation {
  readonly steps: readonly AnimationStep[];
  readonly loop: boolean;
  /** Mood to fall back to when a one-shot animation finishes. */
  readonly then?: LeafyMood;
  /** Gentle 1px breathing bob layered on top of the steps. */
  readonly breathe?: boolean;
  /** Periodic blinks layered on top of the steps. */
  readonly blink?: boolean;
}

const step = (pose: PoseName, ms: number, offsetY = 0): AnimationStep => ({ pose, ms, offsetY });

export const ANIMATIONS: Readonly<Record<LeafyMood, LeafyAnimation>> = {
  idle: { steps: [step('neutral', 4200), step('smile', 2400), step('neutral', 3600), step('happy', 1400)], loop: true, breathe: true, blink: true },
  greeting: { steps: [step('wave-hi', 650), step('happy', 250), step('wave-hi', 650), step('hello-speech', 1500)], loop: false, then: 'idle', blink: true },
  listening: { steps: [step('smile', 520, -1), step('smile', 520, 0), step('neutral', 520, -1), step('neutral', 520, 0)], loop: true },
  thinking: { steps: [step('think-dots', 850), step('think-hmm', 850), step('think-question', 850), step('think-dots', 850), step('think-idea', 650)], loop: true, blink: true },
  working: { steps: [step('typing', 420), step('typing-happy', 420)], loop: true },
  searching: { steps: [step('reading', 900), step('reading-wow', 700)], loop: true },
  speaking: { steps: [step('happy', 210), step('laugh', 210), step('smile', 210), step('laugh', 210)], loop: true },
  writing: { steps: [step('writing-notes', 1300), step('smile', 700)], loop: false, then: 'idle' },
  success: { steps: [step('task-done', 900), step('thumbs-up', 1000)], loop: false, then: 'idle' },
  error: { steps: [step('error', 1400), step('confused', 1100)], loop: false, then: 'idle' },
  confirm: { steps: [step('think-question', 1200), step('think-answer', 1200)], loop: true, blink: true },
  clap: { steps: [step('clap', 220, -1), step('neutral', 140), step('clap', 220, -1), step('excited', 900)], loop: false, then: 'listening' },
  notify: { steps: [step('notification', 700, -1), step('notification', 700, 0), step('hello-speech', 1400)], loop: false, then: 'idle' },
  caring: { steps: [step('holding-heart', 1800)], loop: false, then: 'idle', breathe: true },
  celebrate: { steps: [step('confetti', 800), step('party-hat', 900), step('star-struck', 700)], loop: false, then: 'idle' },
  sleeping: { steps: [step('sleepy', 2200), step('snore-bubble', 2200)], loop: true, breathe: true },
  yawning: { steps: [step('yawn', 1300), step('stretch', 1300)], loop: false, then: 'idle' },
  dragging: { steps: [step('surprised', 400, -1), step('surprised', 400, 0)], loop: true },
  dropped: { steps: [step('dizzy', 700), step('relieved', 900)], loop: false, then: 'idle' },
};

export const BREATH_PERIOD_MS = 2400;
export const BREATH_LIFT_MS = 1100;
export const BLINK_PERIOD_MS = 3900;
export const BLINK_MS = 130;

export interface FrameState {
  readonly pose: PoseName;
  readonly offsetY: number;
  readonly blink: boolean;
  /** True once a one-shot animation has played its final step. */
  readonly done: boolean;
}

export function animationDuration(animation: LeafyAnimation): number {
  return animation.steps.reduce((total, s) => total + s.ms, 0);
}

/**
 * Pure frame lookup: which pose, lift and blink state Leafy shows `elapsedMs` after a mood started.
 * With `reducedMotion`, Leafy holds each pose without bobbing or blinking.
 */
export function frameAt(mood: LeafyMood, elapsedMs: number, options: { reducedMotion?: boolean } = {}): FrameState {
  const animation = ANIMATIONS[mood];
  const total = animationDuration(animation);
  const elapsed = Math.max(0, elapsedMs);
  const done = !animation.loop && elapsed >= total;
  const t = animation.loop ? elapsed % total : Math.min(elapsed, total - 1);

  let cursor = 0;
  let current = animation.steps[animation.steps.length - 1];
  for (const s of animation.steps) {
    if (t < cursor + s.ms) {
      current = s;
      break;
    }
    cursor += s.ms;
  }

  if (options.reducedMotion) {
    return { pose: current.pose, offsetY: 0, blink: false, done };
  }

  const breathLift = animation.breathe && elapsed % BREATH_PERIOD_MS < BREATH_LIFT_MS ? -1 : 0;
  const blink = Boolean(animation.blink) && elapsed % BLINK_PERIOD_MS > BLINK_PERIOD_MS - BLINK_MS;
  return { pose: current.pose, offsetY: (current.offsetY ?? 0) + breathLift, blink, done };
}

/** The mood a one-shot animation settles into, or the mood itself when it loops. */
export function settledMood(mood: LeafyMood): LeafyMood {
  const animation = ANIMATIONS[mood];
  return animation.loop ? mood : animation.then ?? 'idle';
}
