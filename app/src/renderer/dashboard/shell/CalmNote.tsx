import { Leaf, X } from 'lucide-react';
import { ICON_STROKE, IconButton } from '../../ui/components';

/** Shown while calm mode trims the dashboard. Dismissing hides it until the next launch. */
export function CalmNote({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <div className="calm-note" role="status">
      <Leaf size={18} strokeWidth={ICON_STROKE} aria-hidden />
      <p>
        Calm mode is on — showing just the essentials. <a href="#/settings/general">Change in Settings</a>
      </p>
      <IconButton label="Dismiss" icon={X} size="sm" variant="plain" tooltip={false} onClick={onDismiss} />
    </div>
  );
}
