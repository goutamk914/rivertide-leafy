import { Check, CircleAlert, CloudCheck } from 'lucide-react';
import { ICON_STROKE, Spinner, cx } from '../../../../ui/components';
import { useSettingsStore } from '../../../state/settings-store';
import { saveStatus, type SaveTone } from '../model/settings-model';

const ICONS: Readonly<Record<Exclude<SaveTone, 'saving'>, typeof Check>> = {
  idle: CloudCheck,
  saved: Check,
  error: CircleAlert,
};

/**
 * Quiet save status for the whole page. The inner node is keyed by `saveCount`, so a second
 * "Saved" in a row is announced again by screen readers.
 */
export function SavedIndicator() {
  const saveState = useSettingsStore((s) => s.saveState);
  const saveCount = useSettingsStore((s) => s.saveCount);
  const saveError = useSettingsStore((s) => s.saveError);
  const status = saveStatus(saveState, saveError);
  const Icon = status.tone === 'saving' ? null : ICONS[status.tone];
  return (
    <p className={cx('settings-saved', `settings-saved--${status.tone}`)} role="status" aria-live="polite">
      <span key={`${status.tone}-${saveCount}`} className="settings-saved__inner">
        {Icon ? <Icon size={18} strokeWidth={ICON_STROKE} aria-hidden /> : <Spinner />}
        {status.text}
      </span>
    </p>
  );
}
