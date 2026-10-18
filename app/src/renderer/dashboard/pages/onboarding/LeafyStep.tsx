import { ArrowRight } from 'lucide-react';
import { platform } from '../../../lib/ipc';
import { Button, Keys, Toggle } from '../../../ui/components';
import { useSettings, useUpdateSettings } from '../../state/settings-store';
import { StepFooter, StepHeader, useStepNav } from './step-frame';
import { StepLeafy } from './StepLeafy';

const SHORTCUTS_TITLE_ID = 'onb-shortcuts-title';

interface Shortcut {
  /** Electron accelerator or key labels for <Keys>. */
  readonly keys: string | readonly string[];
  readonly does: string;
}

function shortcuts(palette: string): readonly Shortcut[] {
  return [
    { keys: 'fn', does: 'Hold to dictate. Let go to paste.' },
    { keys: ['fn', 'fn'], does: 'Press twice for hands-free. Press fn again to finish.' },
    { keys: 'Control+fn', does: 'Hold to ask a question. The answer appears at your cursor.' },
    { keys: 'Shift+fn', does: 'Hold to give Leafy a command.' },
    { keys: palette, does: 'Open Leafy’s palette.' },
    { keys: ['Esc'], does: 'Cancel what Rivertide is doing.' },
  ];
}

export function LeafyStep() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const { goNext } = useStepNav();
  const os = platform();

  return (
    <>
      <StepHeader
        leading={<StepLeafy mood={settings.clap.enabled ? 'clap' : 'idle'} label="Leafy" />}
        lede="Leafy lives in the corner of your screen. Ask Leafy to open apps, set reminders or find a note."
      />
      <div className="onb-card">
        <Toggle
          label="Clap twice to call Leafy"
          description="While this is on, the microphone stays open and macOS shows its mic indicator. Audio never leaves this computer."
          checked={settings.clap.enabled}
          onChange={(enabled) => void update({ clap: { enabled } })}
        />
      </div>
      <section className="onb-shortcuts" aria-labelledby={SHORTCUTS_TITLE_ID}>
        <h2 id={SHORTCUTS_TITLE_ID} className="onb-section-title">Shortcuts</h2>
        <dl className="onb-shortcuts__list">
          {shortcuts(settings.hotkeys.palette).map((item) => (
            <div key={item.does} className="onb-shortcuts__row">
              <dt className="onb-shortcuts__keys">
                <Keys keys={item.keys} platform={os} />
              </dt>
              <dd className="onb-shortcuts__does">{item.does}</dd>
            </div>
          ))}
        </dl>
      </section>
      <StepFooter
        primary={(
          <Button variant="accent" size="lg" iconEnd={ArrowRight} onClick={goNext}>
            Continue
          </Button>
        )}
      />
    </>
  );
}
