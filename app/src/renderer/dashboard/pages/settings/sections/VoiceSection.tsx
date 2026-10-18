import type { Settings, SettingsPatch } from '@shared/settings';
import { Slider, Toggle, type SegmentOption } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import { formatSeconds, msFromSeconds, roundTo } from '../model/settings-model';
import { ChoiceRow, SectionFrame, SettingGroup } from '../parts/layout';
import { useDraft } from '../parts/TextSetting';
import { VoicePicker } from './VoicePicker';

type Voice = Settings['voice'];
type Polish = Voice['polish'];

const SILENCE_SECONDS = { min: 1, max: 5, step: 0.1 } as const;

const OUTPUT_OPTIONS: readonly SegmentOption<Voice['output']>[] = [
  { value: 'paste', label: 'Paste' },
  { value: 'type', label: 'Type' },
  { value: 'clipboard', label: 'Copy only' },
];

const TONE_OPTIONS: readonly SegmentOption<Polish['tone']>[] = [
  { value: 'natural', label: 'Natural' },
  { value: 'professional', label: 'Professional' },
  { value: 'casual', label: 'Casual' },
];

const POLISH_TOGGLES: readonly { readonly key: Exclude<keyof Polish, 'enabled' | 'tone'>; readonly label: string; readonly description: string }[] = [
  { key: 'removeFillers', label: 'Remove filler words', description: 'Takes out “um”, “uh” and “you know”.' },
  { key: 'fixRepetitions', label: 'Fix repeated words', description: '“I I think” becomes “I think”.' },
  { key: 'resolveSelfCorrections', label: 'Keep only my correction', description: '“Meet at 3, no, 4” becomes “Meet at 4”.' },
  { key: 'autoFormat', label: 'Format lists and paragraphs', description: 'Adds paragraphs and lists, and writes numbers and times as digits.' },
];

/** Hands-free silence slider in seconds; saves whole milliseconds when the person lets go. */
function SilenceSetting({ valueMs, onCommit }: { readonly valueMs: number; readonly onCommit: (ms: number) => void }) {
  const [draft, setDraft] = useDraft(valueMs / 1000);
  return (
    <Slider
      label="Pause before Rivertide stops listening"
      value={draft}
      min={SILENCE_SECONDS.min}
      max={SILENCE_SECONDS.max}
      step={SILENCE_SECONDS.step}
      format={(seconds) => formatSeconds(msFromSeconds(seconds))}
      minLabel="1 s"
      maxLabel="5 s"
      help="Only for hands-free listening: double-press fn, a clap, or Leafy’s mic button. Holding fn never stops early."
      onChange={(next) => setDraft(roundTo(next, 1))}
      onCommit={(next) => {
        const ms = msFromSeconds(roundTo(next, 1));
        if (ms !== valueMs) onCommit(ms);
      }}
    />
  );
}

function PolishGroup({ polish, onChange }: { readonly polish: Polish; readonly onChange: (patch: Partial<Polish>) => void }) {
  return (
    <SettingGroup title="Writing cleanup" description="What Rivertide tidies up before pasting your words.">
      <Toggle
        label="Clean up my writing"
        description="When this is off, Rivertide pastes exactly what it heard."
        checked={polish.enabled}
        onChange={(enabled) => onChange({ enabled })}
      />
      {POLISH_TOGGLES.map(({ key, label, description }) => (
        <Toggle
          key={key}
          label={label}
          description={description}
          checked={polish[key]}
          disabled={!polish.enabled}
          onChange={(checked) => onChange({ [key]: checked })}
        />
      ))}
      <ChoiceRow label="Tone" options={TONE_OPTIONS} value={polish.tone} onChange={(tone) => onChange({ tone })} />
    </SettingGroup>
  );
}

export function VoiceSection() {
  const { voice } = useSettings();
  const update = useUpdateSettings();
  const setVoice = (patch: NonNullable<SettingsPatch['voice']>) => void update({ voice: patch });

  return (
    <SectionFrame title="Voice">
      <SettingGroup title="Where your words go">
        <ChoiceRow
          label="After you speak"
          description="Paste is fastest. Type works in apps that block pasting. Copy only puts the text on the clipboard for you."
          options={OUTPUT_OPTIONS}
          value={voice.output}
          onChange={(output) => setVoice({ output })}
        />
        <Toggle
          label="Also copy to the clipboard"
          description="Keeps a copy so you can paste it again somewhere else."
          checked={voice.alsoCopy || voice.output === 'clipboard'}
          disabled={voice.output === 'clipboard'}
          onChange={(alsoCopy) => setVoice({ alsoCopy })}
        />
      </SettingGroup>

      <SettingGroup title="Listening">
        <Toggle
          label="Sounds"
          description="Short tones when Rivertide starts and stops listening."
          checked={voice.sounds}
          onChange={(sounds) => setVoice({ sounds })}
        />
        <SilenceSetting valueMs={voice.endSilenceMs} onCommit={(endSilenceMs) => setVoice({ endSilenceMs })} />
      </SettingGroup>

      <SettingGroup title="Leafy’s voice">
        <Toggle
          label="Speak responses"
          description="Leafy reads answers and command results out loud."
          checked={voice.speakResponses}
          onChange={(speakResponses) => setVoice({ speakResponses })}
        />
        <VoicePicker
          voiceName={voice.voiceName}
          rate={voice.speechRate}
          onVoice={(voiceName) => setVoice({ voiceName })}
          onRate={(speechRate) => setVoice({ speechRate })}
        />
      </SettingGroup>

      <PolishGroup polish={voice.polish} onChange={(polish) => setVoice({ polish })} />

      <SettingGroup title="Recordings and context">
        <Toggle
          label="Keep recordings"
          description="Saves the audio of each recording on this computer. When this is off, Rivertide doesn’t keep the audio."
          checked={voice.keepRecordings}
          onChange={(keepRecordings) => setVoice({ keepRecordings })}
        />
        <Toggle
          label="Use the app you’re in as a hint"
          description="Adds the name of the app you’re typing in, such as Mail, to the cleanup request so the tone fits."
          checked={voice.useAppContext}
          onChange={(useAppContext) => setVoice({ useAppContext })}
        />
      </SettingGroup>
    </SectionFrame>
  );
}
