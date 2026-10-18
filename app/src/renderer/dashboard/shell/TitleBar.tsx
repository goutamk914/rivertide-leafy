import { Square, X } from 'lucide-react';
import type { VoiceSnapshot } from '@shared/types';
import { errorMessage, invoke } from '../../lib/ipc';
import { IconButton, cx, toast } from '../../ui/components';
import { phaseLabel } from '../hooks/useVoice';

const ACTIVE_PHASES = new Set(['listening', 'transcribing', 'thinking', 'acting', 'confirming', 'speaking', 'error']);

/** Draggable strip above the page. Shows the live voice status (with stop / cancel) while a session runs. */
export function TitleBar({ voice }: { readonly voice: VoiceSnapshot | null }) {
  const active = voice !== null && ACTIVE_PHASES.has(voice.phase);
  const run = (channel: 'voice:stop' | 'voice:cancel') => {
    invoke(channel, undefined).catch((error: unknown) => toast.error(`Couldn’t stop listening. ${errorMessage(error)}`));
  };
  return (
    <div className="titlebar drag-region">
      {active && voice ? (
        <div
          className={cx('voice-pill', 'no-drag', voice.mode === 'ask' && 'voice-pill--ask', voice.phase === 'error' && 'voice-pill--error')}
          role="status"
        >
          <span className="voice-pill__dot" aria-hidden />
          <span>{voice.phase === 'error' && voice.error ? voice.error.message : voice.detail ?? phaseLabel(voice.phase)}</span>
          {voice.phase === 'listening' ? (
            <IconButton label="Stop and use what I said" icon={Square} size="sm" variant="plain" tooltipPlacement="below" onClick={() => run('voice:stop')} />
          ) : null}
          <IconButton label="Cancel" icon={X} size="sm" variant="plain" tooltipPlacement="below" onClick={() => run('voice:cancel')} />
        </div>
      ) : null}
    </div>
  );
}
