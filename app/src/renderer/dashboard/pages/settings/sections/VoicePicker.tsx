import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Button, Field, Select, Slider } from '../../../../ui/components';
import { formatRate, roundTo, voiceOptions } from '../model/settings-model';
import { useDraft } from '../parts/TextSetting';

const RATE = { min: 0.6, max: 1.4, step: 0.05 } as const;
const SAMPLE_TEXT = 'Hi, I’m Leafy. This is how I sound when I read answers to you.';
const PREVIEW_FAILED = 'The sample didn’t play. Check that your sound is on, then try again.';

function speechSynthesisOrNull(): SpeechSynthesis | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return typeof SpeechSynthesisUtterance === 'function' ? window.speechSynthesis : null;
}

/** Voices this window can see; refreshes when the OS finishes loading them. */
function useSpeechVoices(): { readonly synth: SpeechSynthesis | null; readonly voices: readonly SpeechSynthesisVoice[] } {
  const [synth] = useState(speechSynthesisOrNull);
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>(() => synth?.getVoices() ?? []);
  useEffect(() => {
    if (!synth) return undefined;
    const refresh = () => setVoices(synth.getVoices());
    refresh();
    synth.addEventListener('voiceschanged', refresh);
    return () => {
      synth.removeEventListener('voiceschanged', refresh);
      synth.cancel();
    };
  }, [synth]);
  return { synth, voices };
}

export interface VoicePickerProps {
  readonly voiceName: string | null;
  readonly rate: number;
  readonly onVoice: (voiceName: string | null) => void;
  readonly onRate: (rate: number) => void;
}

/** Leafy's speaking voice and speed, with a sample to hear the choice before relying on it. */
export function VoicePicker({ voiceName, rate, onVoice, onRate }: VoicePickerProps) {
  const { synth, voices } = useSpeechVoices();
  const [draftRate, setDraftRate] = useDraft(rate);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const preview = () => {
    if (!synth) return;
    setPreviewError(null);
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(SAMPLE_TEXT);
    utterance.rate = draftRate;
    const voice = voices.find((v) => v.name === voiceName);
    if (voice) utterance.voice = voice;
    utterance.onerror = (event) => {
      if (event.error !== 'canceled' && event.error !== 'interrupted') setPreviewError(PREVIEW_FAILED);
    };
    synth.speak(utterance);
  };

  return (
    <div className="settings-voice">
      <Field
        label="Voice"
        help={synth ? 'System default uses the voice chosen in your computer’s settings.' : 'Voices can’t be listed in this window. Leafy uses the system default.'}
      >
        <Select
          options={voiceOptions(voices, voiceName)}
          value={voiceName ?? ''}
          onChange={(name) => onVoice(name === '' ? null : name)}
        />
      </Field>
      <Slider
        label="Speaking speed"
        value={draftRate}
        min={RATE.min}
        max={RATE.max}
        step={RATE.step}
        format={formatRate}
        minLabel="Slower"
        maxLabel="Faster"
        onChange={(next) => setDraftRate(roundTo(next, 2))}
        onCommit={(next) => {
          const value = roundTo(next, 2);
          if (value !== rate) onRate(value);
        }}
      />
      <div className="settings-voice__preview">
        <Button size="sm" icon={Play} disabled={!synth} onClick={preview}>Preview</Button>
        <p className="settings-note" role="status" aria-live="polite">
          {previewError ?? (synth ? 'Plays a short sample at this speed.' : 'Preview isn’t available in this window.')}
        </p>
      </div>
    </div>
  );
}
