'use client';

import { useState } from 'react';
import { LeafySprite, type LeafyMood } from '@rivertide/leafy';

/** Every mood the app uses, with the moment it shows up in. */
const MOODS: readonly { readonly mood: LeafyMood; readonly label: string; readonly when: string }[] = [
  { mood: 'idle', label: 'Idle', when: 'Waiting in the corner of your screen.' },
  { mood: 'greeting', label: 'Hello', when: 'When you summon it.' },
  { mood: 'listening', label: 'Listening', when: 'While you hold fn or talk to it.' },
  { mood: 'thinking', label: 'Thinking', when: 'While it works out what you meant.' },
  { mood: 'working', label: 'Working', when: 'While it opens, finds or sets something.' },
  { mood: 'searching', label: 'Searching', when: 'Looking through your files and notes.' },
  { mood: 'speaking', label: 'Speaking', when: 'Answering out loud.' },
  { mood: 'writing', label: 'Writing', when: 'Typing the clean text for you.' },
  { mood: 'success', label: 'Done', when: 'When it finished what you asked.' },
  { mood: 'confirm', label: 'Asking', when: 'Before anything you cannot undo.' },
  { mood: 'error', label: 'Trouble', when: 'When something went wrong, with what to do next.' },
  { mood: 'clap', label: 'Clap', when: 'When it heard you clap twice.' },
  { mood: 'notify', label: 'Reminder', when: 'When a timer or reminder is due.' },
  { mood: 'celebrate', label: 'Celebrate', when: 'When you keep a streak going.' },
  { mood: 'sleeping', label: 'Resting', when: 'When there is nothing to do.' },
];

/** Big Leafy and a button for each mood. One-shot moods play once, then settle like they do in the app. */
export function MoodPlayground() {
  const [selected, setSelected] = useState<LeafyMood>('greeting');
  const [playing, setPlaying] = useState<LeafyMood>('greeting');
  const [round, setRound] = useState(0);
  const current = MOODS.find((item) => item.mood === selected) ?? MOODS[0];

  const choose = (mood: LeafyMood) => {
    setSelected(mood);
    setPlaying(mood);
    setRound((value) => value + 1);
  };

  return (
    <div className="playground rt-panel">
      <div className="playground__stage">
        <LeafySprite
          key={round}
          mood={playing}
          scale={9}
          label={`Leafy, ${current.label.toLowerCase()}`}
          onSettle={setPlaying}
        />
        <p className="playground__caption" aria-live="polite">
          <span className="playground__mood">{current.label}.</span> {current.when}
        </p>
      </div>
      <div role="group" aria-label="Play a mood" className="playground__moods">
        {MOODS.map((item) => (
          <button
            key={item.mood}
            type="button"
            className="playground__mood-button"
            aria-pressed={item.mood === selected}
            onClick={() => choose(item.mood)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
