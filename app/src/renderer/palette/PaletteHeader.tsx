import { useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { Mic } from 'lucide-react';
import { LeafySprite } from '@rivertide/leafy';
import type { LeafyMood } from '@rivertide/leafy/moods';
import { useAudioLevel } from '../lib/hooks/useAudioLevel';
import { Waveform } from '../lib/hooks/Waveform';
import type { PaletteView } from './navigation';

export interface PaletteHeaderProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly view: PaletteView;
  readonly value: string;
  readonly listening: boolean;
  readonly readOnly: boolean;
  readonly mood: LeafyMood;
  /** Changes on every palette:open, so the greeting can play again. */
  readonly moodKey: string;
  readonly activeDescendant: string | undefined;
  readonly expanded: boolean;
  readonly reducedMotion: boolean;
  readonly commandShortcut: string;
  readonly onChange: (value: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly onMic: () => void;
}

const PLACEHOLDER: Readonly<Record<PaletteView, string>> = {
  search: 'Search or ask Leafy…',
  ask: 'Ask a follow-up…',
  voice: 'Ask a follow-up…',
};

interface Settled {
  readonly key: string;
  readonly to: LeafyMood;
}

/**
 * One-shot moods (greeting, success, error) settle into their follow-up mood once played.
 * Any change of mood forgets the settled state, so the next success plays again.
 */
function useSettledMood(mood: LeafyMood, key: string) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [lastMood, setLastMood] = useState(mood);
  if (lastMood !== mood) {
    setLastMood(mood);
    setSettled(null);
  }
  const shown = settled && settled.key === key && lastMood === mood ? settled.to : mood;
  return { shown, onSettle: (next: LeafyMood) => setSettled({ key, to: next }) };
}

/** Keeps focus in the input when a button is clicked, so the keyboard keeps working. */
export const keepInputFocus = (event: MouseEvent<HTMLElement>) => event.preventDefault();

export function PaletteHeader(props: PaletteHeaderProps) {
  const { inputRef, view, value, listening, readOnly, mood, moodKey, reducedMotion } = props;
  const { shown, onSettle } = useSettledMood(mood, moodKey);
  const levelRef = useAudioLevel(listening);
  const placeholder = listening ? 'Listening…' : PLACEHOLDER[view];

  return (
    <header className="pl-header">
      <div className="pl-avatar">
        <LeafySprite mood={shown} scale={2} decorative reducedMotion={reducedMotion} onSettle={onSettle} />
      </div>
      <input
        ref={inputRef}
        className="pl-input"
        type="text"
        role="combobox"
        aria-label="Search or ask Leafy"
        aria-autocomplete="list"
        aria-expanded={props.expanded}
        aria-controls="pl-results"
        aria-activedescendant={props.activeDescendant}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        data-listening={listening}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={props.onKeyDown}
      />
      <button
        type="button"
        className="pl-mic"
        data-listening={listening}
        aria-label={listening ? 'Stop listening' : 'Talk to Leafy'}
        aria-pressed={listening}
        aria-keyshortcuts={listening ? undefined : props.commandShortcut}
        title={listening ? 'Stop listening' : `Talk to Leafy (${props.commandShortcut})`}
        onMouseDown={keepInputFocus}
        onClick={props.onMic}
      >
        {listening ? (
          <Waveform levelRef={levelRef} bars={7} barWidth={3} gap={2.5} height={22} reducedMotion={reducedMotion} />
        ) : (
          <Mic size={20} strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </header>
  );
}
