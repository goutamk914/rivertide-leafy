'use client';

import { useRef, useState } from 'react';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { LeafySprite, type LeafyMood } from '@rivertide/leafy';
import { Keys } from '@/components/site/Keys';
import { LeafyPalette } from '@/components/leafy/LeafyPalette';

const MOODS: readonly { readonly mood: LeafyMood; readonly label: string }[] = [
  { mood: 'greeting', label: 'Hello' },
  { mood: 'listening', label: 'Listening' },
  { mood: 'thinking', label: 'Thinking' },
  { mood: 'working', label: 'Working' },
  { mood: 'success', label: 'Done' },
  { mood: 'sleeping', label: 'Resting' },
];

const COMMANDS = [
  'Open my calendar.',
  'Set a timer for 20 minutes.',
  'Remind me to take my meds at 8.',
  'Turn the volume down.',
  'What did I say about my appointment yesterday?',
];

/** Scroll window over which Leafy works through its moods, unless you pick one. */
const CYCLE_START = 0.12;
const CYCLE_SPAN = 0.62;

/**
 * Leafy, large and alive: its mood follows your scroll until you choose one. Next to it, things
 * you can say, and below, the palette it opens with ⌘⇧Space.
 */
export function MeetLeafy() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const [scrolled, setScrolled] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  useMotionValueEvent(scrollYProgress, 'change', (value) => {
    const step = Math.floor(((value - CYCLE_START) / CYCLE_SPAN) * MOODS.length);
    setScrolled(Math.min(MOODS.length - 1, Math.max(0, step)));
  });

  const index = picked ?? scrolled;
  const current = MOODS[index];

  return (
    <section ref={ref} className="rt-section" data-chapter="Meet Leafy" aria-labelledby="leafy-title">
      <div className="rt-container">
        <div className="meet">
          <div className="meet__stage rt-reveal">
            <div className="meet__leafy">
              <LeafySprite mood={current.mood} scale={8} label={`Leafy, ${current.label.toLowerCase()}`} />
            </div>
            <div role="group" aria-label="Show a mood" className="meet__moods">
              {MOODS.map((item, itemIndex) => (
                <button
                  key={item.mood}
                  type="button"
                  className="meet__mood"
                  aria-pressed={itemIndex === index}
                  onClick={() => setPicked(itemIndex)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="meet__copy">
            <h2 id="leafy-title" className="rt-h2 rt-reveal">
              Meet Leafy.<br /> <span className="rt-beat">It does the clicking.</span>
            </h2>
            <p className="rt-lede rt-reveal meet__lede">
              Leafy lives in the corner of your screen. Tell it what you need. It opens, finds, sets and reminds, then tells you
              what it did.
            </p>
            <ul className="meet__commands rt-reveal" aria-label="Things you can say">
              {COMMANDS.map((command) => (
                <li key={command}>“{command}”</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="meet__palette rt-reveal">
          <LeafyPalette />
          <p className="meet__caption">
            <Keys keys={['⌘', '⇧', 'Space']} /> opens Leafy anywhere: one search over your files, notes, history and everything
            Rivertide remembers.
          </p>
        </div>
      </div>
    </section>
  );
}
