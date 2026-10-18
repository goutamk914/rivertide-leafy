import { Check, CircleAlert, Globe, RotateCcw } from 'lucide-react';
import { DEFAULT_SETTINGS } from '@shared/settings';
import type { HotkeyStatus } from '@shared/types';
import { invoke } from '../../../../lib/ipc';
import { Badge, Button, ICON_STROKE, Keys, Toggle, cx, toast } from '../../../../ui/components';
import { useIpcQuery } from '../../../hooks/useIpc';
import { useSettings, useUpdateSettings } from '../../../state/settings-store';
import {
  HOTKEY_ACTIONS, actionLabel, findConflict, hotkeyStatusLine, usesOptionSpace, type HotkeyAction, type Platform,
} from '../model/accelerator';
import { currentPlatform } from '../parts/external';
import { KeyCapture } from '../parts/KeyCapture';
import { SectionFrame, SettingGroup, SettingNote } from '../parts/layout';

interface Gesture {
  readonly keys: readonly string[];
  readonly title: string;
  readonly text: string;
}

const FN_GESTURES: readonly Gesture[] = [
  { keys: ['fn'], title: 'Hold fn', text: 'Dictate. Let go and your words are pasted where you were typing.' },
  { keys: ['fn', 'fn'], title: 'Double-press fn', text: 'Hands-free. Talk as long as you like, then press fn again to finish.' },
  { keys: ['⌃', 'fn'], title: 'Control + fn', text: 'Ask a question. The answer is pasted at your cursor.' },
  { keys: ['⇧', 'fn'], title: 'Shift + fn', text: 'Leafy command. Say what you want done, like “set a timer for ten minutes”.' },
];

const ESC_GESTURE: Gesture = { keys: ['Esc'], title: 'Esc', text: 'Cancels whatever is in progress.' };

function GestureList({ gestures }: { readonly gestures: readonly Gesture[] }) {
  return (
    <dl className="settings-gestures">
      {gestures.map((g) => (
        <div key={g.title} className="settings-gestures__row">
          <dt>
            <span aria-hidden className="settings-gestures__keys"><Keys keys={g.keys} /></span>
            <span className="settings-gestures__title">{g.title}</span>
          </dt>
          <dd>{g.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusLine({ statuses, action, accelerator }: {
  readonly statuses: readonly HotkeyStatus[] | undefined;
  readonly action: HotkeyAction;
  readonly accelerator: string;
}) {
  const line = hotkeyStatusLine(statuses, action, accelerator);
  if (line.tone === 'ready') return <Badge tone="accent" icon={Check}>{line.text}</Badge>;
  if (line.tone === 'conflict') {
    return (
      <span className={cx('rt-status', 'rt-status--error')}>
        <CircleAlert size={16} strokeWidth={ICON_STROKE} aria-hidden className="settings-icon-inline" />
        {line.text}
      </span>
    );
  }
  return <span>{line.text}</span>;
}

function optionSpaceLabel(os: Platform): string {
  return os === 'darwin' ? 'Option+Space' : 'Alt+Space';
}

export function ShortcutsSection() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const status = useIpcQuery(() => invoke('hotkeys:status', undefined), []);
  const os = currentPlatform();
  const { hotkeys } = settings;

  const saveHotkey = async (action: HotkeyAction, accelerator: string) => {
    await update({ hotkeys: { [action]: accelerator } });
    status.reload();
  };

  const duplicateOf = (action: HotkeyAction) => (accelerator: string) => {
    const other = findConflict(accelerator, action, hotkeys);
    return other ? `That shortcut already does “${actionLabel(other)}”. Pick a different one.` : null;
  };

  const resetHotkey = (action: HotkeyAction) => {
    const fallback = DEFAULT_SETTINGS.hotkeys[action];
    const problem = duplicateOf(action)(fallback);
    if (problem) {
      toast.error(problem);
      return;
    }
    void saveHotkey(action, fallback);
  };

  return (
    <SectionFrame title="Shortcuts">
      <SettingGroup title="The fn key">
        <Toggle
          label="Use the fn key"
          description="Talk to Rivertide with the fn key at the bottom left of your keyboard. Turn this off if fn does something else for you."
          checked={hotkeys.useFn}
          onChange={(useFn) => void update({ hotkeys: { useFn } })}
        />
        <GestureList gestures={hotkeys.useFn ? [...FN_GESTURES, ESC_GESTURE] : [ESC_GESTURE]} />
        {hotkeys.useFn ? (
          <SettingNote>
            If pressing fn opens emoji or dictation, open System Settings, then Keyboard, and set “Press{' '}
            <Globe size={14} strokeWidth={ICON_STROKE} aria-hidden className="settings-icon-inline" />
            <span className="visually-hidden">globe</span> key to” to “Do Nothing”.
          </SettingNote>
        ) : null}
      </SettingGroup>

      <SettingGroup
        title="Keyboard shortcuts"
        description={`These work anywhere on your computer. Click a shortcut, then press the new keys. Avoid ${optionSpaceLabel(os)}: ChatGPT and Codex use it.`}
      >
        {status.error ? <SettingNote tone="warn">Rivertide couldn’t check your shortcuts. {status.error}</SettingNote> : null}
        {HOTKEY_ACTIONS.map(({ id, label, description }) => (
          <div key={id} className="settings-hotkey">
            <KeyCapture
              label={label}
              description={description}
              value={hotkeys[id]}
              platform={os}
              validate={duplicateOf(id)}
              onChange={(accelerator) => void saveHotkey(id, accelerator)}
              status={<StatusLine statuses={status.data} action={id} accelerator={hotkeys[id]} />}
            />
            {usesOptionSpace(hotkeys[id]) ? (
              <SettingNote tone="warn">ChatGPT and Codex use {optionSpaceLabel(os)}, so this shortcut may not work. Pick a different one.</SettingNote>
            ) : null}
            {hotkeys[id] !== DEFAULT_SETTINGS.hotkeys[id] ? (
              <Button
                size="sm"
                variant="quiet"
                icon={RotateCcw}
                aria-label={`Use the default for ${label}`}
                onClick={() => resetHotkey(id)}
              >
                Use the default
              </Button>
            ) : null}
          </div>
        ))}
      </SettingGroup>
    </SectionFrame>
  );
}
