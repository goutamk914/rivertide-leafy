/**
 * Invented sample content for the browser mock. Every person, appointment and note here is
 * fictional; medicine names are generic examples, not anyone's record.
 */
import type { AgentActionSummary, FactCategory, VoiceMode } from '@shared/types';

export interface SampleUtterance {
  readonly mode: VoiceMode;
  readonly raw: string;
  readonly output: string;
  readonly app: { readonly name: string; readonly bundleId: string } | null;
  readonly actions?: readonly AgentActionSummary[];
}

const NOTES = { name: 'Notes', bundleId: 'com.apple.Notes' };
const MAIL = { name: 'Mail', bundleId: 'com.apple.mail' };
const MESSAGES = { name: 'Messages', bundleId: 'com.apple.MobileSMS' };
const SAFARI = { name: 'Safari', bundleId: 'com.apple.Safari' };
const PAGES = { name: 'Pages', bundleId: 'com.apple.iWork.Pages' };

export const SAMPLE_UTTERANCES: readonly SampleUtterance[] = [
  {
    mode: 'dictate',
    raw: 'um so I wanted to say thank you for for the soup yesterday it really helped I was I was pretty wiped out after the infusion',
    output: 'I wanted to say thank you for the soup yesterday. It really helped — I was pretty wiped out after the infusion.',
    app: MESSAGES,
  },
  {
    mode: 'dictate',
    raw: 'note to self ask Dr Ellis about the tingling in my fingers no wait in my fingers and toes and whether the dose should change',
    output: 'Note to self: ask Dr. Ellis about the tingling in my fingers and toes, and whether the dose should change.',
    app: NOTES,
  },
  {
    mode: 'dictate',
    raw: 'hi Jordan uh I need to move our Thursday call to Friday morning if that works I have a scan on Thursday',
    output: 'Hi Jordan,\n\nI need to move our Thursday call to Friday morning, if that works. I have a scan on Thursday.\n\nThanks,\nSam',
    app: MAIL,
  },
  {
    mode: 'dictate',
    raw: 'energy was low today maybe a four out of ten took a long nap after lunch and felt a bit better in the evening',
    output: 'Energy was low today, maybe a 4 out of 10. Took a long nap after lunch and felt a bit better in the evening.',
    app: NOTES,
  },
  {
    mode: 'dictate',
    raw: 'the the chapter starts with the river at dawn you know when the fog is still sitting on the water',
    output: 'The chapter starts with the river at dawn, when the fog is still sitting on the water.',
    app: PAGES,
  },
  {
    mode: 'ask',
    raw: 'what is the difference between a CBC and a CMP',
    output: 'A CBC (complete blood count) counts your blood cells — red cells, white cells and platelets. A CMP (comprehensive metabolic panel) checks blood chemistry such as kidney and liver function, sugar and electrolytes. Your care team can tell you what your own results mean.',
    app: SAFARI,
  },
  {
    mode: 'ask',
    raw: 'how do I say I need to reschedule politely',
    output: 'I’m sorry for the short notice — could we find another time that works for you?',
    app: MAIL,
  },
  {
    mode: 'command',
    raw: 'set a timer for twenty minutes for my tea',
    output: 'Timer set for 20 minutes: tea.',
    app: null,
    actions: [{ tool: 'set_timer', title: 'Set a 20-minute timer', ok: true }],
  },
  {
    mode: 'command',
    raw: 'remind me to take my evening meds at eight',
    output: 'I’ll remind you at 8:00 PM to take your evening medicines.',
    app: null,
    actions: [{ tool: 'create_reminder', title: 'Remind at 8:00 PM', ok: true }],
  },
  {
    mode: 'command',
    raw: 'open my calendar and turn the volume down a bit',
    output: 'Opened Calendar and lowered the volume to 40%.',
    app: null,
    actions: [
      { tool: 'open_app', title: 'Open Calendar', ok: true },
      { tool: 'set_volume', title: 'Set volume to 40%', ok: true },
    ],
  },
];

export interface SampleFact {
  readonly category: FactCategory;
  readonly label: string;
  readonly value: string;
  readonly pinned?: boolean;
}

export const SAMPLE_FACTS: readonly SampleFact[] = [
  { category: 'medication', label: 'Oxaliplatin', value: 'Infusion every two weeks, on Tuesdays.', pinned: true },
  { category: 'medication', label: 'Ondansetron', value: 'Anti-nausea tablet, as needed, up to three a day.' },
  { category: 'medication', label: 'Vitamin D', value: 'One capsule with breakfast.' },
  { category: 'symptom', label: 'Tingling fingers', value: 'Pins and needles in fingertips, worse in the cold.' },
  { category: 'symptom', label: 'Afternoon fatigue', value: 'Energy drops after lunch most days; a nap helps.' },
  { category: 'diagnosis', label: 'Colon cancer, stage II', value: 'Diagnosed in spring; surgery done, now on chemotherapy.' },
  { category: 'treatment', label: 'Chemotherapy cycle 6', value: 'Halfway through a 12-cycle plan.' },
  { category: 'appointment', label: 'CT scan', value: 'Thursday morning at the imaging centre. No food 4 hours before.' },
  { category: 'appointment', label: 'Oncology follow-up', value: 'Next Monday with Dr. Ellis to review the scan.' },
  { category: 'care-team', label: 'Dr. Rowan Ellis', value: 'Oncologist (fictional sample contact).', pinned: true },
  { category: 'care-team', label: 'Priya, infusion nurse', value: 'Best person to call about side effects between visits.' },
  { category: 'goal', label: 'Walk every day', value: 'A 15-minute walk after breakfast, even on slow days.' },
  { category: 'feeling', label: 'Worried about the scan', value: 'Feels anxious before scans; talking it through helps.' },
  { category: 'preference', label: 'Short emails', value: 'Prefers short, plain emails without exclamation marks.' },
  { category: 'person', label: 'Maya, sister', value: 'Drives to appointments on Tuesdays.' },
  { category: 'person', label: 'Jordan, manager', value: 'Flexible about meeting times; prefers Friday mornings.' },
  { category: 'other', label: 'Favourite tea', value: 'Ginger tea helps with nausea.' },
];

export const SAMPLE_DICTIONARY = [
  { term: 'Oxaliplatin', replaces: ['ox ally platin', 'oxally platin'], note: 'Chemotherapy medicine' },
  { term: 'Ondansetron', replaces: ['on dance a tron'], note: 'Anti-nausea' },
  { term: 'Dr. Ellis', replaces: ['doctor alice', 'dr alice'], note: 'Oncologist' },
  { term: 'Priya', replaces: ['pria', 'preya'], note: '' },
  { term: 'neuropathy', replaces: ['new roppathy'], note: '' },
] as const;

export const SAMPLE_DOCUMENTS = [
  {
    name: 'Chemo side effects handout.txt',
    kind: 'text' as const,
    text: 'Common side effects during chemotherapy\n\nTiredness: plan rest between activities. Short walks can help.\n\nNausea: take anti-nausea medicine as prescribed. Eat small meals.\n\nTingling in hands or feet: tell your care team. Avoid very cold drinks and surfaces for a few days after treatment.\n\nCall your care team straight away if you have a temperature of 38°C (100.4°F) or higher.\n\n(Sample document for the Rivertide preview. Not medical advice.)',
  },
  {
    name: 'Questions for Monday.md',
    kind: 'markdown' as const,
    text: '# Questions for Monday\n\n- What did the scan show?\n- Should the dose change because of the tingling?\n- Is it okay to travel next month?\n- Who do I call on weekends?',
  },
  {
    name: 'Appointment summary (sample).txt',
    kind: 'text' as const,
    text: 'Visit summary — fictional sample\n\nCycle 5 went well. Blood counts within the expected range. Continue the current plan. Next infusion in two weeks. CT scan booked before the next oncology visit.',
  },
] as const;

export const SAMPLE_NOTES = [
  { title: 'Questions for Dr. Ellis', body: 'Tingling in fingers and toes — dose change?\nCan I travel in November?\nWeekend contact number?', pinned: true, source: 'voice' as const },
  { title: 'Good days list', body: 'Walked to the park.\nFinished two chapters.\nLunch with Maya.', pinned: false, source: 'manual' as const },
  { title: 'Groceries', body: 'Ginger tea, crackers, soup, oranges.', pinned: false, source: 'agent' as const },
  { title: 'Book idea', body: 'The river at dawn. Fog on the water. A boat that never docks.', pinned: false, source: 'voice' as const },
] as const;

export const CHAT_STARTER_REPLY =
  'Here is what I found in what you have told me. This week you mentioned low energy in the afternoons on four days, and that a nap after lunch helped. On Tuesday, after the infusion, you said you were "pretty wiped out." Would you like me to add this to your questions for Monday?';
