import { useId, useRef, type KeyboardEvent } from 'react';
import { Circle, CircleCheck, Lock, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import { ICON_STROKE, cx } from '../../../ui/components';
import type { AiPreset } from './ai-presets';

interface PresetCard {
  readonly id: AiPreset;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  readonly needs: string;
}

const CARDS: readonly PresetCard[] = [
  {
    id: 'claude',
    icon: Sparkles,
    title: 'Claude',
    body: 'Most capable. Best for questions, chat and Leafy’s tasks.',
    needs: 'Needs a Claude key for thinking and a Groq key for fast speech-to-text.',
  },
  {
    id: 'fast',
    icon: Zap,
    title: 'Fast & free tier',
    body: 'Groq for both thinking and speech. Quick, and Groq has a free tier.',
    needs: 'Needs one Groq key.',
  },
  {
    id: 'private',
    icon: Lock,
    title: 'Private',
    body: 'Thinking runs on this computer with Ollama. Works best on a recent Mac.',
    needs: 'Speech stays on this computer with whisper, or uses a Groq key.',
  },
];

const ARROW_STEP: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export interface PresetCardsProps {
  readonly value: AiPreset;
  readonly onChange: (preset: AiPreset) => void;
}

/** Three big cards with radio semantics: one tab stop, arrow keys move the choice. */
export function PresetCards({ value, onChange }: PresetCardsProps) {
  const uid = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = ARROW_STEP[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const target = (index + delta + CARDS.length) % CARDS.length;
    const card = CARDS[target];
    if (!card) return;
    onChange(card.id);
    refs.current[target]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="AI setup" className="onb-presets">
      {CARDS.map((card, index) => {
        const checked = card.id === value;
        const Icon = card.icon;
        const Mark = checked ? CircleCheck : Circle;
        return (
          <button
            key={card.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-labelledby={`${uid}-${card.id}-title`}
            aria-describedby={`${uid}-${card.id}-body`}
            tabIndex={checked ? 0 : -1}
            className={cx('onb-preset', checked && 'onb-preset--checked')}
            onClick={() => onChange(card.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="onb-chip" aria-hidden>
              <Icon size={20} strokeWidth={ICON_STROKE} />
            </span>
            <span className="onb-preset__text">
              <span id={`${uid}-${card.id}-title`} className="onb-preset__title">{card.title}</span>
              <span id={`${uid}-${card.id}-body`} className="onb-preset__body">
                {card.body} <span className="onb-preset__needs">{card.needs}</span>
              </span>
            </span>
            <span className="onb-preset__mark" aria-hidden>
              <Mark size={20} strokeWidth={ICON_STROKE} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
