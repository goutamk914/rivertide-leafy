/** The three ways to talk to Rivertide, with one honest example each. */

export type WayId = 'dictate' | 'ask' | 'leafy';

export interface Way {
  readonly id: WayId;
  readonly tab: string;
  readonly keys: readonly string[];
  /** Spoken alternative to the keys, if any. */
  readonly alternative?: string;
  readonly title: string;
  readonly body: string;
  readonly saidLabel: string;
  readonly said: string;
  readonly resultLabel: string;
  readonly result: string;
}

export const WAYS: readonly Way[] = [
  {
    id: 'dictate',
    tab: 'Dictate',
    keys: ['fn'],
    title: 'Hold fn, talk, let go.',
    body: 'The clean version lands wherever your cursor is: an email, a note, a form, a search box.',
    saidLabel: 'You say',
    said: 'Hi Priya, um, I’m running, I’m running about ten minutes late, sorry.',
    resultLabel: 'Typed in Messages',
    result: 'Hi Priya, I’m running about ten minutes late. Sorry.',
  },
  {
    id: 'ask',
    tab: 'Ask',
    keys: ['ctrl', 'fn'],
    title: 'Ask, and the answer is typed for you.',
    body: 'Hold ctrl and fn and ask for what you need. You never leave the app you are in.',
    saidLabel: 'You ask',
    said: 'Write a short note to Dana asking for Friday off for treatment.',
    resultLabel: 'Typed in Mail',
    result:
      'Hi Dana, I have a treatment appointment on Friday, so I would like to take the day off. I will make sure my work is covered before then. Thank you.',
  },
  {
    id: 'leafy',
    tab: 'Leafy',
    keys: ['shift', 'fn'],
    alternative: 'or clap twice',
    title: 'Say what you want done.',
    body: 'Leafy opens apps, sets timers, finds files, turns the volume down and reminds you later. It answers out loud, and asks first before anything you cannot undo.',
    saidLabel: 'You say',
    said: 'Set a timer for twenty minutes.',
    resultLabel: 'Leafy',
    result: 'Timer set for 20 minutes.',
  },
];
