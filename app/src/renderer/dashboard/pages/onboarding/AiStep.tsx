import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { invoke } from '../../../lib/ipc';
import { Button, SegmentedControl, type SegmentOption } from '../../../ui/components';
import { useIpcQuery } from '../../hooks/useIpc';
import { useSettings, useUpdateSettings } from '../../state/settings-store';
import { choiceFromSettings, presetPatch, providersFor, type AiChoice, type PrivateSpeech } from './ai-presets';
import { PresetCards } from './PresetCards';
import { ProviderRow } from './ProviderRow';
import { InlineError, StepFooter, StepHeader, useStepNav } from './step-frame';
import { useAsyncAction } from './use-async-action';

const SPEECH_OPTIONS: readonly SegmentOption<PrivateSpeech>[] = [
  { value: 'local', label: 'On this computer' },
  { value: 'groq', label: 'Groq (faster)' },
];

const PROVIDERS_TITLE_ID = 'onb-providers-title';

function SpeechChoice({ value, onChange }: { readonly value: PrivateSpeech; readonly onChange: (speech: PrivateSpeech) => void }) {
  return (
    <div className="onb-speech">
      <p className="onb-speech__label" aria-hidden>Speech-to-text</p>
      <SegmentedControl label="Speech-to-text" options={SPEECH_OPTIONS} value={value} onChange={onChange} />
    </div>
  );
}

export function AiStep() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const { goNext } = useStepNav();
  const [choice, setChoice] = useState<AiChoice>(() => choiceFromSettings(settings));
  const secrets = useIpcQuery(() => invoke('secrets:status', undefined), []);
  const save = useAsyncAction();
  const needs = providersFor(choice);

  const onContinue = async () => {
    const saved = await save.run(async () => {
      if (!(await update(presetPatch(choice)))) throw new Error('The save didn’t go through.');
      return true;
    }, () => 'Rivertide couldn’t save your AI choice. Try again in a moment.');
    if (saved && save.isMounted()) goNext();
  };

  return (
    <>
      <StepHeader lede="Rivertide uses an AI service to tidy your words and answer questions. You can change this later in Settings." />
      <PresetCards value={choice.preset} onChange={(preset) => setChoice((current) => ({ ...current, preset }))} />
      {choice.preset === 'private' ? (
        <SpeechChoice value={choice.speech} onChange={(speech) => setChoice((current) => ({ ...current, speech }))} />
      ) : null}
      <section className="onb-providers" aria-labelledby={PROVIDERS_TITLE_ID}>
        <h2 id={PROVIDERS_TITLE_ID} className="onb-section-title">What this setup uses</h2>
        <p className="onb-section-lede">Rivertide keeps keys encrypted on this computer and never shows them again.</p>
        {secrets.error ? (
          <div className="onb-retry">
            <InlineError>{`Rivertide couldn’t check your saved keys. ${secrets.error}`}</InlineError>
            <Button icon={RotateCcw} onClick={secrets.reload}>Try again</Button>
          </div>
        ) : null}
        {needs.map((item) => (
          <ProviderRow
            key={`${item.providerId}-${item.testKind}`}
            need={item}
            secrets={secrets.data}
            onSecrets={(next) => secrets.mutate(() => next)}
          />
        ))}
      </section>
      <StepFooter
        note={save.error ? <InlineError>{save.error}</InlineError> : <p className="onb-foot__hint">You can add keys later in Settings.</p>}
        primary={(
          <Button variant="accent" size="lg" iconEnd={ArrowRight} loading={save.pending} onClick={() => void onContinue()}>
            Continue
          </Button>
        )}
      />
    </>
  );
}
