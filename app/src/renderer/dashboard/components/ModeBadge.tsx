import { CircleHelp, Mic, Sprout } from 'lucide-react';
import type { VoiceMode } from '@shared/types';
import { Badge } from '../../ui/components';

export const MODE_LABELS: Readonly<Record<VoiceMode, string>> = {
  dictate: 'Dictation',
  ask: 'Ask',
  command: 'Leafy',
};

/** Mode as text + icon (never colour alone). */
export function ModeBadge({ mode }: { readonly mode: VoiceMode }) {
  if (mode === 'ask') return <Badge tone="ask" icon={CircleHelp}>{MODE_LABELS.ask}</Badge>;
  if (mode === 'command') return <Badge tone="accent" icon={Sprout}>{MODE_LABELS.command}</Badge>;
  return <Badge icon={Mic}>{MODE_LABELS.dictate}</Badge>;
}
