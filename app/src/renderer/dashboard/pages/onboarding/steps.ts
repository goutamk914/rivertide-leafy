/** The onboarding flow's steps: order, titles and progress wording. Pure, so it is unit-tested. */

export const STEP_IDS = ['welcome', 'permissions', 'ai', 'try', 'leafy', 'done'] as const;

export type StepId = (typeof STEP_IDS)[number];

export const STEP_COUNT = STEP_IDS.length;

/** One or two beats; the second beat renders quieter (two-beat headline). Each title stays ≤ 7 words. */
export type StepTitle = readonly [string] | readonly [string, string];

export const STEP_TITLES: Readonly<Record<StepId, StepTitle>> = {
  welcome: ['You speak naturally.', 'Rivertide writes clearly.'],
  permissions: ['Let Rivertide hear and type'],
  ai: ['Choose your AI'],
  try: ['Try your first dictation'],
  leafy: ['Meet Leafy, your helper'],
  done: ['You’re all set'],
};

function isStepId(value: string | null | undefined): value is StepId {
  return typeof value === 'string' && (STEP_IDS as readonly string[]).includes(value);
}

/** The step named by `/onboarding/<section>`; anything unknown starts at the beginning. */
export function stepFromSection(section: string | null): StepId {
  return isStepId(section) ? section : 'welcome';
}

/** Route section mirroring a step (`null` keeps the first step at plain `/onboarding`). */
export function stepSection(step: StepId): string | null {
  return step === STEP_IDS[0] ? null : step;
}

/** 1-based position. */
export function stepNumber(step: StepId): number {
  return STEP_IDS.indexOf(step) + 1;
}

export function nextStep(step: StepId): StepId | null {
  return STEP_IDS[stepNumber(step)] ?? null;
}

export function previousStep(step: StepId): StepId | null {
  const index = stepNumber(step) - 2;
  return index >= 0 ? (STEP_IDS[index] ?? null) : null;
}

export function progressLabel(step: StepId): string {
  return `Step ${stepNumber(step)} of ${STEP_COUNT}`;
}

export function progressFraction(step: StepId): number {
  return stepNumber(step) / STEP_COUNT;
}
