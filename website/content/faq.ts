/** Questions people ask before installing. Answers must stay true to the app. */

export interface Faq {
  readonly question: string;
  readonly answer: string;
}

export const FAQS: readonly Faq[] = [
  {
    question: 'What do I need to run it?',
    answer:
      'A Mac with macOS 13 Ventura or later. Windows and Linux builds exist but are experimental: the fn key and pasting work differently there, so expect rough edges.',
  },
  {
    question: 'What does it cost?',
    answer:
      'Rivertide is free and open source. If you use a cloud AI service, you pay that provider directly for what you use, which for everyday dictation is usually a few cents. Running everything on your Mac with Ollama and whisper.cpp costs nothing.',
  },
  {
    question: 'Is Rivertide medical software?',
    answer:
      'No. It is a writing and computer helper. It does not diagnose, treat or give medical advice, and the speech patterns it notices are a gentle signal for you, not a measurement for your doctor.',
  },
  {
    question: 'Does it listen all the time?',
    answer:
      'No. It listens while you hold fn, after you start a voice command, or while hands-free dictation is on. The only always-on listening is clap detection, which is off until you turn it on; that sound is processed on your Mac and never recorded or sent anywhere.',
  },
  {
    question: 'Which languages does it understand?',
    answer:
      'The speech models it uses understand many languages, and polishing keeps the language you spoke. The app itself is in English for now. Names and medicine words you use often can go in your personal dictionary so they are spelled right.',
  },
  {
    question: 'Who makes it?',
    answer:
      'Code the Cure, a nonprofit that builds free accessibility tools for people living with cancer. Rivertide was made for chemo brain and brain fog, and it is useful to anyone whose words come slower some days.',
  },
];
