import { useState } from 'react';
import { ArrowRight, MessageCircleQuestionMark, Mic, Sprout, type LucideIcon } from 'lucide-react';
import { Button, Field, ICON_STROKE, TextInput } from '../../../ui/components';
import { useSettings, useUpdateSettings } from '../../state/settings-store';
import { InlineError, StepFooter, StepHeader, useStepNav } from './step-frame';
import { StepLeafy } from './StepLeafy';
import { useAsyncAction } from './use-async-action';

const NAME_MAX = 80;

interface Point {
  readonly icon: LucideIcon;
  readonly text: string;
}

const POINTS: readonly Point[] = [
  { icon: Mic, text: 'Hold fn and talk. Clear text appears where your cursor is.' },
  { icon: MessageCircleQuestionMark, text: 'Ask a question out loud and get a short answer.' },
  { icon: Sprout, text: 'Leafy can do small things for you, like set a reminder.' },
];

export function WelcomeStep() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const { goNext } = useStepNav();
  const [name, setName] = useState(settings.profile.name);
  const save = useAsyncAction();

  const onContinue = async () => {
    if (save.pending) return;
    const trimmed = name.trim();
    if (trimmed !== settings.profile.name) {
      const saved = await save.run(async () => {
        if (!(await update({ profile: { name: trimmed } }))) throw new Error('The save didn’t go through.');
        return true;
      }, () => 'Rivertide couldn’t save your name. Try again in a moment.');
      if (!saved || !save.isMounted()) return;
    }
    goNext();
  };

  return (
    <>
      <StepHeader leading={<StepLeafy mood="greeting" label="Leafy waving hello" />} />
      <ul className="onb-points">
        {POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="onb-points__item">
            <span className="onb-chip" aria-hidden>
              <Icon size={18} strokeWidth={ICON_STROKE} />
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ul>
      <Field label="What should Rivertide call you?" optional help="Leafy uses it to greet you. You can change it later.">
        <TextInput
          value={name}
          maxLength={NAME_MAX}
          autoComplete="given-name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) void onContinue();
          }}
        />
      </Field>
      <StepFooter
        note={save.error ? <InlineError>{save.error}</InlineError> : null}
        primary={(
          <Button variant="accent" size="lg" iconEnd={ArrowRight} loading={save.pending} onClick={() => void onContinue()}>
            Get started
          </Button>
        )}
      />
    </>
  );
}
