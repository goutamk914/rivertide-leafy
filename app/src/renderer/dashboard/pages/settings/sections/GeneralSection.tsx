import type { Settings } from '@shared/settings';
import { Slider, Toggle, type SegmentOption } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import { formatPercent, roundTo, validateName } from '../model/settings-model';
import { ChoiceRow, SectionFrame, SettingGroup } from '../parts/layout';
import { TextSetting, useDraft } from '../parts/TextSetting';

type Appearance = Settings['appearance'];

const TEXT_SCALE = { min: 0.9, max: 1.5, step: 0.05 } as const;

const THEME_OPTIONS: readonly SegmentOption<Appearance['theme']>[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match system' },
];

const CALM_OPTIONS: readonly SegmentOption<Appearance['calmMode']>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

const MOTION_OPTIONS: readonly SegmentOption<Appearance['reduceMotion']>[] = [
  { value: 'system', label: 'Match system' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];

/** Slider that previews the new size while dragging and saves when the person lets go. */
function TextSizeSetting({ value, onCommit }: { readonly value: number; readonly onCommit: (scale: number) => void }) {
  const [draft, setDraft] = useDraft(value);
  const commit = (next: number) => {
    const scale = roundTo(next, 2);
    if (scale !== value) onCommit(scale);
  };
  return (
    <div className="settings-text-size">
      <Slider
        label="Text size"
        value={draft}
        min={TEXT_SCALE.min}
        max={TEXT_SCALE.max}
        step={TEXT_SCALE.step}
        format={formatPercent}
        minLabel={formatPercent(TEXT_SCALE.min)}
        maxLabel={formatPercent(TEXT_SCALE.max)}
        onChange={(next) => setDraft(roundTo(next, 2))}
        onCommit={commit}
      />
      <p className="settings-preview" aria-hidden style={{ fontSize: `${draft / value}em` }}>
        This is how your words will look.
      </p>
    </div>
  );
}

export function GeneralSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const { appearance } = settings;
  const setAppearance = (patch: Partial<Appearance>) => void update({ appearance: patch });

  return (
    <SectionFrame title="General">
      <SettingGroup title="You">
        <TextSetting
          label="Your name"
          help="Leafy uses it to say hello. Leave it empty if you prefer."
          value={settings.profile.name}
          validate={validateName}
          autoComplete="given-name"
          optional
          onSave={(name) => void update({ profile: { name } })}
        />
      </SettingGroup>

      <SettingGroup title="Appearance">
        <ChoiceRow label="Theme" options={THEME_OPTIONS} value={appearance.theme} onChange={(theme) => setAppearance({ theme })} />
        <TextSizeSetting value={appearance.textScale} onCommit={(textScale) => setAppearance({ textScale })} />
        <ChoiceRow
          label="Calm mode"
          description="Shows only the essentials, with slightly larger text. Auto turns it on when your speech looks foggier than usual."
          options={CALM_OPTIONS}
          value={appearance.calmMode}
          onChange={(calmMode) => setAppearance({ calmMode })}
        />
        <ChoiceRow
          label="Reduce motion"
          description="Keeps movement to a minimum. Match system follows your computer’s setting."
          options={MOTION_OPTIONS}
          value={appearance.reduceMotion}
          onChange={(reduceMotion) => setAppearance({ reduceMotion })}
        />
      </SettingGroup>

      <SettingGroup title="Startup">
        <Toggle
          label="Open Rivertide when you log in"
          description="So fn and Leafy are ready as soon as your computer is."
          checked={settings.system.launchAtLogin}
          onChange={(launchAtLogin) => void update({ system: { launchAtLogin } })}
        />
      </SettingGroup>
    </SectionFrame>
  );
}
