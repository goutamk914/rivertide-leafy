import { Mic } from 'lucide-react';
import type { Settings, SettingsPatch } from '@shared/settings';
import { ICON_STROKE, Toggle, type SegmentOption } from '../../../../ui/components';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import { ChoiceRow, SectionFrame, SettingGroup } from '../parts/layout';

type Leafy = Settings['leafy'];
type Clap = Settings['clap'];

const SIZE_OPTIONS: readonly SegmentOption<Leafy['size']>[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const SENSITIVITY_OPTIONS: readonly SegmentOption<Clap['sensitivity']>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const CLAP_ACTION_OPTIONS: readonly SegmentOption<Clap['action']>[] = [
  { value: 'command', label: 'Start a voice command' },
  { value: 'palette', label: 'Open the palette' },
];

export const WAKE_PRIVACY_NOTE =
  'While “Hey Leafy” is on, the microphone stays on and macOS shows its mic indicator. Listening happens entirely on this computer: audio never leaves it, is never saved, and nothing it hears is written down.';

export const CLAP_PRIVACY_NOTE =
  'While clap detection is on, the microphone stays open and macOS shows its mic indicator. Audio never leaves this computer and is never saved.';

export function LeafySection() {
  const { leafy, clap, wakeWord } = useSettings();
  const update = useUpdateSettings();
  const setLeafy = (patch: NonNullable<SettingsPatch['leafy']>) => void update({ leafy: patch });
  const setClap = (patch: NonNullable<SettingsPatch['clap']>) => void update({ clap: patch });
  const setWake = (patch: NonNullable<SettingsPatch['wakeWord']>) => void update({ wakeWord: patch });

  return (
    <SectionFrame title="Leafy">
      <SettingGroup title="On your screen">
        <Toggle
          label="Show Leafy"
          description="Leafy floats in a corner of your screen. Click Leafy to open the palette."
          checked={leafy.visible}
          onChange={(visible) => setLeafy({ visible })}
        />
        <ChoiceRow label="Size" options={SIZE_OPTIONS} value={leafy.size} onChange={(size) => setLeafy({ size })} />
        <Toggle
          label="Sleep at night"
          description="Between 10 PM and 7 AM, Leafy naps after ten quiet minutes."
          checked={leafy.sleepAtNight}
          onChange={(sleepAtNight) => setLeafy({ sleepAtNight })}
        />
        <Toggle
          label="Tips"
          description="Leafy’s greeting includes a short tip, such as your command shortcut."
          checked={leafy.tips}
          onChange={(tips) => setLeafy({ tips })}
        />
      </SettingGroup>

      <SettingGroup
        title="Clap to call Leafy"
        description="Clap twice and Leafy says hello and listens for a command. A double clap only calls Leafy; it never runs an action by itself."
      >
        <Toggle label="Listen for a double clap" checked={clap.enabled} onChange={(enabled) => setClap({ enabled })} />
        {clap.enabled ? (
          <>
            <ChoiceRow
              label="Sensitivity"
              description="Higher catches softer claps but may react to other sharp sounds."
              options={SENSITIVITY_OPTIONS}
              value={clap.sensitivity}
              onChange={(sensitivity) => setClap({ sensitivity })}
            />
            <ChoiceRow label="When you clap" options={CLAP_ACTION_OPTIONS} value={clap.action} onChange={(action) => setClap({ action })} />
          </>
        ) : null}
        <p className="settings-callout">
          <Mic size={18} strokeWidth={ICON_STROKE} aria-hidden />
          <span>{CLAP_PRIVACY_NOTE}</span>
        </p>
      </SettingGroup>

      <SettingGroup
        title="Say “Hey Leafy”"
        description="Say “Hey Leafy” and Leafy says hello and listens for a command. Saying it only calls Leafy; it never runs an action by itself. English only for now."
      >
        <Toggle label="Listen for “Hey Leafy”" checked={wakeWord.enabled} onChange={(enabled) => setWake({ enabled })} />
        {wakeWord.enabled ? (
          <ChoiceRow
            label="How easily Leafy wakes"
            description="Higher answers softer or less clear voices, but may wake up by mistake more often."
            options={SENSITIVITY_OPTIONS}
            value={wakeWord.sensitivity}
            onChange={(sensitivity) => setWake({ sensitivity })}
          />
        ) : null}
        <p className="settings-callout">
          <Mic size={18} strokeWidth={ICON_STROKE} aria-hidden />
          <span>{WAKE_PRIVACY_NOTE}</span>
        </p>
      </SettingGroup>
    </SectionFrame>
  );
}
